import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

await import('../extension/webm.js');
const {LiveWebM, opusHead, videoCodecId} = globalThis.TohyeeWebM;
const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

// Annex B H.264 (start codes) -> NAL units.
function nalUnits(buf) {
  const starts = [];
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const len = buf[i + 2] === 1 ? 3 : 4;
      starts.push([i, i + len]);
      i += len - 1;
    }
  }
  return starts.map(([, from], n) => buf.subarray(from, n + 1 < starts.length ? starts[n + 1][0] : buf.length));
}

// What Chrome's encoder gives us with avc:{format:'avc'}: an avcC description
// and length-prefixed pictures. Build the same from x264's output.
function chromeLikeH264(file) {
  const nals = nalUnits(fs.readFileSync(file));
  const sps = nals.find(n => (n[0] & 31) === 7), pps = nals.find(n => (n[0] & 31) === 8);
  const avcC = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1]), Buffer.from([sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
  const frames = [];
  let current = null;
  for (const nal of nals) {
    const type = nal[0] & 31;
    if (type === 7 || type === 8 || type === 6 || type === 9) continue;
    if (type === 5 || type === 1) {
      const firstSlice = (nal[1] & 0x80) !== 0; // first_mb_in_slice == 0
      if (firstSlice || !current) { current = {key: type === 5, parts: []}; frames.push(current); }
      current.parts.push(Buffer.concat([Buffer.from([nal.length >>> 24, (nal.length >> 16) & 255, (nal.length >> 8) & 255, nal.length & 255]), nal]));
    }
  }
  return {avcC, frames: frames.map(f => ({key: f.key, data: Buffer.concat(f.parts)}))};
}

// Ogg Opus -> raw Opus packets.
function opusPackets(file) {
  const buf = fs.readFileSync(file), packets = [];
  let at = 0, pending = [];
  while (at + 27 <= buf.length && buf.toString('latin1', at, at + 4) === 'OggS') {
    const segments = buf[at + 26], table = buf.subarray(at + 27, at + 27 + segments);
    let body = at + 27 + segments;
    for (const len of table) {
      pending.push(buf.subarray(body, body + len)); body += len;
      if (len < 255) { packets.push(Buffer.concat(pending)); pending = []; }
    }
    at = body;
  }
  return packets.slice(2); // skip OpusHead and OpusTags
}

test('Codec names map to Matroska codec IDs', () => {
  assert.equal(videoCodecId('avc1.64002A'), 'V_MPEG4/ISO/AVC');
  assert.equal(videoCodecId('vp09.00.10.08'), 'V_VP9');
  assert.equal(videoCodecId('vp8'), 'V_VP8');
  assert.throws(() => videoCodecId('hev1.1.6.L93'));
});

test('The Opus header follows RFC 7845', () => {
  const head = opusHead({channels: 2, sampleRate: 48000});
  assert.equal(Buffer.from(head.subarray(0, 8)).toString(), 'OpusHead');
  assert.equal(head[8], 1);
  assert.equal(head[9], 2);
  assert.equal(new DataView(head.buffer).getUint32(12, true), 48000);
});

test('Nothing is written before the first keyframe, and each keyframe starts a cluster', () => {
  const w = new LiveWebM({video: {codec: 'avc1.64002A', width: 1920, height: 1080, description: new Uint8Array([1, 100, 0, 42])}, audio: {sampleRate: 48000, channels: 2}});
  assert.equal(w.addVideo(new Uint8Array(10), 0, false), null);
  assert.equal(w.addAudio(new Uint8Array(10), 0), null);
  const first = w.addVideo(new Uint8Array(10), 0, true);
  assert.deepEqual([...first.subarray(0, 4)], [0x1f, 0x43, 0xb6, 0x75]);
  const next = w.addVideo(new Uint8Array(10), 20, false);
  assert.equal(next[0], 0xa3); // just a block
  assert.equal(w.addVideo(new Uint8Array(10), 2000, true)[0], 0x1f); // new cluster
  assert.ok(w.addAudio(new Uint8Array(10), 2010));
});

test('A stream built from H.264 pictures and Opus sound plays in FFmpeg and passes through to MPEG-TS untouched', {skip: !haveFfmpeg && 'FFmpeg not installed'}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohyee-webm-'));
  try {
    const h264 = path.join(dir, 'v.h264'), ogg = path.join(dir, 'a.ogg'), out = path.join(dir, 'live.webm'), ts = path.join(dir, 'out.ts');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=50', '-t', '4', '-c:v', 'libx264', '-profile:v', 'high', '-g', '100', '-bf', '0', '-f', 'h264', h264]).status, 0);
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-ac', '2', '-c:a', 'libopus', '-frame_duration', '20', ogg]).status, 0);
    const {avcC, frames} = chromeLikeH264(h264);
    const sound = opusPackets(ogg);
    const w = new LiveWebM({video: {codec: 'avc1.640028', width: 640, height: 360, description: avcC}, audio: {sampleRate: 48000, channels: 2}});
    const parts = [w.header()];
    let a = 0;
    frames.forEach((f, i) => {
      const t = i * 20;
      parts.push(w.addVideo(f.data, t, f.key));
      while (a < sound.length && a * 20 <= t) { const b = w.addAudio(sound[a], a * 20); if (b) parts.push(b); a++; }
    });
    fs.writeFileSync(out, Buffer.concat(parts));

    const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,profile,width,height,nb_read_frames,sample_rate,channels', '-of', 'json', out], {encoding: 'utf8'}).stdout);
    const video = probe.streams.find(s => s.codec_name === 'h264'), audio = probe.streams.find(s => s.codec_name === 'opus');
    assert.equal(video.profile, 'High');
    assert.equal(Number(video.nb_read_frames), frames.length);
    assert.equal(video.width, 640);
    assert.equal(Number(audio.sample_rate), 48000);
    assert.ok(Number(audio.nb_read_frames) > 150);

    // The tuner's passthrough: copy the pictures into MPEG-TS for Plex.
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-c:v', 'copy', '-c:a', 'aac', '-f', 'mpegts', ts]).status, 0);
    const tsProbe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-count_frames', '-show_entries', 'stream=profile,nb_read_frames,avg_frame_rate', '-of', 'csv=p=0', ts], {encoding: 'utf8'}).stdout.trim();
    assert.match(tsProbe, /^High,50\/1,200$/m);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('The recorder asks for hardware H.264 High first, and steps aside when there is none', async () => {
  const vm = await import('node:vm');
  const code = fs.readFileSync(new URL('../extension/recorder.js', import.meta.url), 'utf8');
  const make = supported => {
    const asked = [];
    const ctx = {VideoEncoder: Object.assign(function () {}, {isConfigSupported: async c => { asked.push(`${c.codec} ${c.hardwareAcceleration}`); return {supported: supported(c)}; }}),
      AudioEncoder: Object.assign(function () {}, {isConfigSupported: async () => ({supported: true})}), MediaStreamTrackProcessor: function () {}};
    ctx.globalThis = ctx; vm.runInNewContext(code, ctx);
    return {Recorder: ctx.TohyeeHardwareRecorder, asked};
  };
  const stream = {getVideoTracks: () => [{getSettings: () => ({width: 1920, height: 1080})}], getAudioTracks: () => [{}]};
  const none = make(() => false);
  const fallback = await none.Recorder.create(stream);
  assert.equal(fallback.recorder, null);
  assert.match(fallback.reason, /no hardware H\.264 encoder/);
  assert.deepEqual(none.asked, ['avc1.64002A prefer-hardware', 'avc1.640028 prefer-hardware']); // never software H.264
  const hw = make(c => c.codec === 'avc1.640028');
  const {recorder} = await hw.Recorder.create(stream, {frameRate: 50});
  assert.equal(recorder.mimeType, 'video/webm;codecs=avc1.640028,opus');
  assert.equal(recorder.encoderName, 'hardware');
  assert.equal(recorder.video.framerate, 50);
  assert.deepEqual({...recorder.video.avc}, {format: 'avc'});
});
