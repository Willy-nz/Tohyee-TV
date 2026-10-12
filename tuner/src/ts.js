// Just enough MPEG-TS parsing to start each new viewer cleanly: split the
// encoder output into whole 188-byte packets, remember the latest program
// tables (PAT/PMT), and find where a video keyframe begins.

export const PACKET = 188;
const VIDEO_STREAM_TYPES = new Set([0x01, 0x02, 0x1b, 0x24]); // MPEG-1/2, H.264, HEVC

export function packetInfo(pkt) {
  const pid = ((pkt[1] & 0x1f) << 8) | pkt[2];
  const start = (pkt[1] & 0x40) !== 0;
  const afc = (pkt[3] >> 4) & 3;
  let offset = 4;
  let randomAccess = false;
  if (afc & 2) {
    const len = pkt[4];
    randomAccess = len > 0 && (pkt[5] & 0x40) !== 0;
    offset = 5 + len;
  }
  return {pid, start, randomAccess, payload: (afc & 1) && offset < PACKET ? offset : -1};
}

// Returns the PSI section inside a packet that starts one, or null.
function section(pkt, info) {
  if (!info.start || info.payload < 0) return null;
  const at = info.payload + 1 + pkt[info.payload];
  if (at + 3 > PACKET) return null;
  const length = ((pkt[at + 1] & 0x0f) << 8) | pkt[at + 2];
  const end = Math.min(at + 3 + length, PACKET);
  return {table: pkt[at], body: pkt.subarray(at, end)};
}

export class TsTracker {
  constructor() {
    this.remainder = Buffer.alloc(0);
    this.pat = null;
    this.pmt = null;
    this.pmtPid = -1;
    this.videoPid = -1;
    this.videoFrames = 0;    // video frames seen so far
    this.framesSinceKey = 0; // video frames since the last keyframe
  }

  // Returns a buffer of whole packets, keeping any partial packet for next time.
  // Re-synchronises on the 0x47 sync byte if the data is ever misaligned.
  align(chunk) {
    let data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    let skip = 0;
    while (skip < data.length && data[skip] !== 0x47) skip++;
    data = data.subarray(skip);
    const whole = data.length - (data.length % PACKET);
    this.remainder = Buffer.from(data.subarray(whole));
    return data.subarray(0, whole);
  }

  // Updates the stored tables from `packets` and returns the index (in
  // packets) of the first video keyframe start, or -1.
  scan(packets) {
    let keyframe = -1;
    for (let i = 0; i * PACKET < packets.length; i++) {
      const pkt = packets.subarray(i * PACKET, (i + 1) * PACKET);
      if (pkt[0] !== 0x47) continue;
      const info = packetInfo(pkt);
      if (info.pid === 0) {
        const s = section(pkt, info);
        if (s && s.table === 0x00) {
          this.pat = Buffer.from(pkt);
          for (let j = 8; j + 4 <= s.body.length - 4; j += 4) {
            const program = (s.body[j] << 8) | s.body[j + 1];
            if (program !== 0) { this.pmtPid = ((s.body[j + 2] & 0x1f) << 8) | s.body[j + 3]; break; }
          }
        }
      } else if (info.pid === this.pmtPid) {
        const s = section(pkt, info);
        if (s && s.table === 0x02) {
          this.pmt = Buffer.from(pkt);
          const infoLength = ((s.body[10] & 0x0f) << 8) | s.body[11];
          for (let j = 12 + infoLength; j + 5 <= s.body.length - 4;) {
            const type = s.body[j];
            const pid = ((s.body[j + 1] & 0x1f) << 8) | s.body[j + 2];
            if (VIDEO_STREAM_TYPES.has(type)) { this.videoPid = pid; break; }
            j += 5 + (((s.body[j + 3] & 0x0f) << 8) | s.body[j + 4]);
          }
        }
      } else if (info.pid === this.videoPid && info.start) {
        this.videoFrames++;
        if (info.randomAccess) {
          this.framesSinceKey = 0;
          if (keyframe < 0) keyframe = i;
        } else {
          this.framesSinceKey++;
        }
      }
    }
    return keyframe;
  }

  // Program tables to send ahead of a keyframe so a new viewer can decode.
  tables() {
    return this.pat && this.pmt ? Buffer.concat([this.pat, this.pmt]) : Buffer.alloc(0);
  }
}
