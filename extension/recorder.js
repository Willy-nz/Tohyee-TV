// Records the captured tab with the computer's hardware video encoder (for
// example Intel Quick Sync) through Chrome's video encoder (WebCodecs), instead
// of Chrome's own recorder. Chrome's recorder encodes H.264 in software: it's
// heavy on the CPU, gives only the simple "Constrained Baseline" type (which
// Fire TV and some smart-TV Plex apps won't play as it is, so Plex has to
// convert it) and tops out at 30 frames a second. The hardware encoder gives
// the usual "High" type at the full frame rate, with very little CPU.
//
// Behaves like a MediaRecorder for offscreen.js: start(), stop(), state,
// ondataavailable({data}), onerror. The output is a live WebM stream (webm.js),
// which the tuner passes straight through to Plex.
//
// If the computer has no hardware H.264 encoder Chrome can use, create()
// returns {recorder: null, reason} and offscreen.js uses Chrome's recorder.
(function (root) {
  const H264_CODECS = ['avc1.64002A', 'avc1.640028']; // High profile, level 4.2 (1080p at 50) then 4.0
  const VIDEO_BITRATE = 8000000;
  const MAX_QUEUED_FRAMES = 3; // drop pictures rather than fall behind

  function videoConfig(codec, width, height, frameRate, hardwareAcceleration) {
    return {codec, width, height, framerate: frameRate, bitrate: VIDEO_BITRATE, bitrateMode: 'variable',
      latencyMode: 'realtime', hardwareAcceleration, ...(codec.startsWith('avc1') ? {avc: {format: 'avc'}} : {})};
  }
  const AUDIO_CONFIG = {codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000};

  // Picks the first H.264 High setting the hardware encoder accepts.
  async function chooseVideo(width, height, frameRate) {
    // For testing in a browser without an H.264 encoder: a codec to use in software.
    const test = root.TOHYEE_TEST_CODEC;
    const candidates = test ? [[test, 'no-preference']] : H264_CODECS.map(codec => [codec, 'prefer-hardware']);
    for (const [codec, acceleration] of candidates) {
      try {
        const config = videoConfig(codec, width, height, frameRate, acceleration);
        const {supported} = await VideoEncoder.isConfigSupported(config);
        if (supported) return config;
      } catch { /* try the next one */ }
    }
    return null;
  }

  class HardwareRecorder {
    static available() {
      return typeof VideoEncoder === 'function' && typeof MediaStreamTrackProcessor === 'function';
    }

    // stream: the MediaStream to record (picture, plus sound if it has some).
    static async create(stream, {frameRate = 50, keyframeMs = 2000} = {}) {
      if (!HardwareRecorder.available()) return {recorder: null, reason: 'this Chrome has no video encoder interface'};
      const track = stream.getVideoTracks()[0];
      if (!track) return {recorder: null, reason: 'no picture'};
      const settings = track.getSettings?.() ?? {};
      const width = even(settings.width || 1920), height = even(settings.height || 1080);
      const video = await chooseVideo(width, height, frameRate);
      if (!video) return {recorder: null, reason: 'no hardware H.264 encoder available to Chrome'};
      let audio = null;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack && typeof AudioEncoder === 'function') {
        try { if ((await AudioEncoder.isConfigSupported(AUDIO_CONFIG)).supported) audio = AUDIO_CONFIG; } catch { /* no sound encoder */ }
      }
      return {recorder: new HardwareRecorder({track, audioTrack: audio ? audioTrack : null, video, audio, keyframeMs})};
    }

    constructor({track, audioTrack, video, audio, keyframeMs}) {
      this.track = track; this.audioTrack = audioTrack;
      this.video = video; this.audio = audio; this.keyframeMs = keyframeMs;
      this.state = 'inactive';
      this.mimeType = `video/webm;codecs=${video.codec}${audio ? ',opus' : ''}`;
      this.encoderName = video.hardwareAcceleration === 'prefer-hardware' ? 'hardware' : 'software (test)';
      this.ondataavailable = null; this.onerror = null;
      this.clones = [];
    }

    emit(bytes) {
      if (bytes && this.state === 'recording') this.ondataavailable?.({data: new Blob([bytes])});
    }

    fail(error) {
      if (this.state !== 'recording') return;
      this.stop();
      this.onerror?.(error);
    }

    // Each track's own clock is turned into milliseconds since start(), lined
    // up by when its first sample arrived, so picture and sound stay in step
    // even if Chrome's clocks for them differ.
    clock(name, timestampUs) {
      if (this.offsets[name] === undefined) this.offsets[name] = timestampUs / 1000 - (performance.now() - this.startedAt);
      return timestampUs / 1000 - this.offsets[name];
    }

    start() {
      if (this.state === 'recording') return;
      this.state = 'recording';
      this.startedAt = performance.now();
      this.offsets = {};
      this.writer = null;
      this.lastKey = -Infinity;
      this.size = null;
      this.encoder = new VideoEncoder({
        output: (chunk, meta) => this.onVideo(chunk, meta),
        error: error => this.fail(error)
      });
      this.pump(this.track, frame => this.onFrame(frame));
      if (this.audio) {
        this.audioEncoder = new AudioEncoder({
          output: chunk => this.onSound(chunk),
          error: () => { this.audio = null; } // keep the picture going without sound
        });
        this.pump(this.audioTrack, data => this.onAudioData(data));
      }
    }

    // Reads frames from a copy of the track (so stopping never ends the capture itself).
    async pump(track, handle) {
      const copy = track.clone();
      this.clones.push(copy);
      const reader = new MediaStreamTrackProcessor({track: copy}).readable.getReader();
      try {
        while (this.state === 'recording') {
          const {value, done} = await reader.read();
          if (done) break;
          if (this.state !== 'recording') { value.close(); break; }
          handle(value);
        }
      } catch (error) {
        if (this.state === 'recording' && track.kind === 'video') this.fail(error);
      } finally {
        reader.cancel().catch(() => {});
      }
    }

    onFrame(frame) {
      try {
        const width = even(frame.displayWidth), height = even(frame.displayHeight);
        if (!this.size || this.size.width !== width || this.size.height !== height) {
          this.size = {width, height};
          this.encoder.configure({...this.video, width, height});
          this.lastKey = -Infinity;
        }
        if (this.encoder.encodeQueueSize > MAX_QUEUED_FRAMES) return; // behind: skip this picture
        const ms = this.clock('video', frame.timestamp);
        const keyFrame = ms - this.lastKey >= this.keyframeMs;
        if (keyFrame) this.lastKey = ms;
        this.encoder.encode(frame, {keyFrame});
      } catch (error) {
        this.fail(error);
      } finally {
        frame.close();
      }
    }

    onVideo(chunk, meta) {
      if (this.state !== 'recording') return;
      const description = meta?.decoderConfig?.description;
      if (!this.writer) {
        if (chunk.type !== 'key') return;
        this.writer = new root.TohyeeWebM.LiveWebM({
          video: {codec: this.video.codec, width: this.size.width, height: this.size.height, description: description ? toBytes(description) : undefined},
          audio: this.audio ? {sampleRate: 48000, channels: 2} : null
        });
        this.emit(this.writer.header());
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this.emit(this.writer.addVideo(data, this.clock('video', chunk.timestamp), chunk.type === 'key'));
    }

    onAudioData(data) {
      try {
        if (!this.audio) return;
        this.clock('audio', data.timestamp); // line the sound's clock up when it first arrives
        if (this.audioEncoder.state === 'unconfigured') this.audioEncoder.configure({...this.audio, sampleRate: data.sampleRate, numberOfChannels: data.numberOfChannels});
        this.audioEncoder.encode(data);
      } catch {
        this.audio = null;
      } finally {
        data.close();
      }
    }

    onSound(chunk) {
      if (this.state !== 'recording' || !this.writer) return;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      this.emit(this.writer.addAudio(data, this.clock('audio', chunk.timestamp)));
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      for (const encoder of [this.encoder, this.audioEncoder]) {
        try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* already closed */ }
      }
      for (const copy of this.clones) { try { copy.stop(); } catch { /* already stopped */ } }
      this.clones = [];
    }
  }

  function even(n) { return Math.max(2, Math.round(Number(n) / 2) * 2); }
  function toBytes(source) {
    if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
    return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }

  root.TohyeeHardwareRecorder = HardwareRecorder;
})(globalThis);
