// A small live WebM (Matroska) writer for the hardware-encoder recorder
// (see recorder.js). Chrome's own recorder (MediaRecorder) writes WebM for
// us, but it uses Chrome's software H.264 encoder: "Constrained Baseline",
// at most 30 frames a second, and heavy on the CPU. With Chrome's video
// encoder (WebCodecs) we can ask for the computer's hardware encoder and the
// usual "High" type of H.264, but then we have to put the encoded pictures and
// sound into a stream ourselves. The tuner reads it exactly like Chrome's own
// recordings.
//
// The stream has no length (it's live): a header with the two tracks, then
// clusters of blocks. A new cluster starts at each keyframe, so someone
// joining gets a clean start.
(function (root) {
  const UNKNOWN_SIZE = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

  function concat(parts) {
    let length = 0;
    for (const p of parts) length += p.length;
    const out = new Uint8Array(length);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  // An element ID is written with its length marker already in it.
  function id(value) {
    const bytes = [];
    for (let v = value; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
    return Uint8Array.from(bytes);
  }

  // Element sizes: the shortest variable-length integer that fits.
  function size(n) {
    for (let length = 1; length <= 8; length++) {
      if (n < 2 ** (7 * length) - 1) {
        const out = new Uint8Array(length);
        let v = n;
        for (let i = length - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
        out[0] |= 0x80 >> (length - 1);
        return out;
      }
    }
    throw new Error('Element too large');
  }

  function uint(n) {
    const bytes = [];
    let v = Math.max(0, Math.floor(n));
    do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
    return Uint8Array.from(bytes);
  }

  function float(n) {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setFloat64(0, n);
    return out;
  }

  const text = value => new TextEncoder().encode(value);
  const element = (elementId, data) => concat([id(elementId), size(data.length), data]);
  const master = (elementId, children) => element(elementId, concat(children));

  // Opus in Matroska needs this small header (RFC 7845).
  function opusHead({channels = 2, sampleRate = 48000, preSkip = 0} = {}) {
    const out = new Uint8Array(19);
    out.set(text('OpusHead'), 0);
    const view = new DataView(out.buffer);
    out[8] = 1;
    out[9] = channels;
    view.setUint16(10, preSkip, true);
    view.setUint32(12, sampleRate, true);
    view.setInt16(16, 0, true);
    out[18] = 0;
    return out;
  }

  const VIDEO_CODECS = {avc1: 'V_MPEG4/ISO/AVC', vp09: 'V_VP9', vp8: 'V_VP8'};
  function videoCodecId(codec) {
    const key = Object.keys(VIDEO_CODECS).find(k => String(codec).startsWith(k));
    if (!key) throw new Error(`Unsupported video codec ${codec}`);
    return VIDEO_CODECS[key];
  }

  class LiveWebM {
    // video: {codec, width, height, description}  (description: avcC for H.264)
    // audio: {sampleRate, channels} or null
    constructor({video, audio = null}) {
      this.video = video;
      this.audio = audio;
      this.clusterStart = null;
      this.lastVideo = -Infinity;
    }

    header() {
      const ebml = master(0x1a45dfa3, [
        element(0x4286, uint(1)), element(0x42f7, uint(1)), element(0x42f2, uint(4)), element(0x42f3, uint(8)),
        element(0x4282, text('webm')), element(0x4287, uint(4)), element(0x4285, uint(2))
      ]);
      const info = master(0x1549a966, [
        element(0x2ad7b1, uint(1000000)), // timestamps in milliseconds
        element(0x4d80, text('Tohyee TV')), element(0x5741, text('Tohyee TV'))
      ]);
      const tracks = [master(0xae, [
        element(0xd7, uint(1)), element(0x73c5, uint(1)), element(0x83, uint(1)),
        element(0x86, text(videoCodecId(this.video.codec))),
        ...(this.video.description ? [element(0x63a2, new Uint8Array(this.video.description))] : []),
        master(0xe0, [element(0xb0, uint(this.video.width)), element(0xba, uint(this.video.height))])
      ])];
      if (this.audio) {
        tracks.push(master(0xae, [
          element(0xd7, uint(2)), element(0x73c5, uint(2)), element(0x83, uint(2)),
          element(0x86, text('A_OPUS')),
          element(0x63a2, opusHead(this.audio)),
          element(0x56aa, uint(6500000)), element(0x56bb, uint(80000000)), // Opus codec delay and pre-roll, in ns
          master(0xe1, [element(0xb5, float(this.audio.sampleRate)), element(0x9f, uint(this.audio.channels))])
        ]));
      }
      return concat([ebml, id(0x18538067), UNKNOWN_SIZE, info, master(0x1654ae6b, tracks)]);
    }

    block(track, data, timestamp, key) {
      const relative = Math.round(timestamp - this.clusterStart);
      const head = new Uint8Array(4);
      head[0] = 0x80 | track;
      new DataView(head.buffer).setInt16(1, relative);
      head[3] = key ? 0x80 : 0;
      return element(0xa3, concat([head, data]));
    }

    // Returns the bytes to send for one encoded picture (timestamp in ms).
    addVideo(data, timestamp, key) {
      const parts = [];
      const ms = Math.max(Math.round(timestamp), this.lastVideo === -Infinity ? 0 : this.lastVideo);
      if (this.clusterStart === null && !key) return null; // the stream must start on a keyframe
      if (this.clusterStart === null || key || ms - this.clusterStart > 30000) {
        this.clusterStart = ms;
        parts.push(id(0x1f43b675), UNKNOWN_SIZE, element(0xe7, uint(ms)));
      }
      this.lastVideo = ms;
      parts.push(this.block(1, data, ms, key));
      return concat(parts);
    }

    // Returns the bytes for one encoded piece of sound, or null before the
    // first picture (or if it's too far from the current cluster).
    addAudio(data, timestamp) {
      if (this.clusterStart === null || !this.audio) return null;
      const relative = Math.round(timestamp) - this.clusterStart;
      if (relative < -32768 || relative > 32767) return null;
      return this.block(2, data, Math.round(timestamp), true);
    }
  }

  const api = {LiveWebM, opusHead, videoCodecId};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TohyeeWebM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
