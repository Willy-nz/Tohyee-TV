// Keyframe request and automatic switch to compatibility encoding
// (ported from PR #6 onto the multi-channel tuner).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import {TsTracker, PACKET} from '../tuner/src/ts.js';
import {Broadcaster} from '../tuner/src/broadcaster.js';
import {chromeInputArgs} from '../tuner/src/ffmpeg.js';
import {sourceEncoder} from '../tuner/src/media.js';

function packet(pid, {start = false, randomAccess = false, payload = []} = {}) {
  const p = Buffer.alloc(PACKET, 0xff);
  p[0] = 0x47; p[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f); p[2] = pid & 0xff;
  if (randomAccess) { p[3] = 0x30; p[4] = 1; p[5] = 0x40; Buffer.from(payload).copy(p, 6); }
  else { p[3] = 0x10; Buffer.from(payload).copy(p, 4); }
  return p;
}
const PMT_PID = 0x1000, VIDEO = 0x100, AUDIO = 0x101;
const pat = packet(0, {start: true, payload: [0, 0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff, 1, 2, 3, 4]});
const pmt = packet(PMT_PID, {start: true, payload: [0, 0x02, 0xb0, 23, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0,
  0x0f, 0xe0 | (AUDIO >> 8), AUDIO & 0xff, 0xf0, 0, 0x1b, 0xe0 | (VIDEO >> 8), VIDEO & 0xff, 0xf0, 0, 1, 2, 3, 4]});
const audio = packet(AUDIO, {start: true, randomAccess: true});
const videoKey = packet(VIDEO, {start: true, randomAccess: true});
const videoFrame = packet(VIDEO, {start: true});
const videoMid = packet(VIDEO);

function fakeEncoder() {
  const e = new EventEmitter();
  e.stdout = new PassThrough(); e.stderr = new PassThrough();
  e.killed = false; e.kill = () => { e.killed = true; };
  return e;
}
function fakeClient() {
  const c = new PassThrough(); c.received = []; c.on('data', d => c.received.push(d)); return c;
}
const tick = () => new Promise(r => setImmediate(r));

test('The extension asks Chrome for a keyframe every 2 seconds', () => {
  const src = fs.readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
  assert.match(src, /const KEYFRAME_INTERVAL_MS = 2000;/);
  assert.match(src, /new MediaRecorder\(s\.recordStream \?\? s\.stream, \{[^}]*videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS/);
});

test('The frame tracker counts pictures since the last keyframe', () => {
  const t = new TsTracker();
  t.scan(Buffer.concat([pat, pmt, videoKey, videoFrame, videoMid, videoFrame, audio]));
  assert.equal(t.videoFrames, 3);
  assert.equal(t.framesSinceKey, 2, 'continuation and audio packets are not pictures');
  t.scan(videoKey);
  assert.equal(t.framesSinceKey, 0);
});

test('A long run of pictures without a keyframe is reported once', async () => {
  let time = 0; let enc; const gaps = [];
  const b = new Broadcaster({now: () => time, maxKeyframeGapMs: 6000, minFramesForGap: 3,
    onKeyframeGap: ms => gaps.push(ms), spawnEncoder: () => (enc = fakeEncoder())});
  b.subscribe(fakeClient());
  enc.stdout.write(Buffer.concat([pat, pmt, videoKey])); await tick();
  for (let i = 0; i < 6; i++) { time += 2000; enc.stdout.write(videoFrame); await tick(); }
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0] > 6000);
  b.stop();
});

test('A still picture (no new frames) is not mistaken for missing keyframes', async () => {
  let time = 0; let enc; const gaps = [];
  const b = new Broadcaster({now: () => time, maxKeyframeGapMs: 6000, minFramesForGap: 3,
    onKeyframeGap: ms => gaps.push(ms), spawnEncoder: () => (enc = fakeEncoder())});
  b.subscribe(fakeClient());
  enc.stdout.write(Buffer.concat([pat, pmt, videoKey])); await tick();
  time += 30000; enc.stdout.write(audio); await tick();
  assert.equal(gaps.length, 0);
  b.stop();
});

test('Restarting the encoder keeps viewers connected, resyncs at a keyframe and continues the clock', async () => {
  let time = 1000; const encoders = []; const options = []; let stops = 0;
  const b = new Broadcaster({now: () => time, onEncoderStop: () => { stops++; },
    spawnEncoder: o => { options.push(o); const e = fakeEncoder(); encoders.push(e); return e; }});
  const viewer = fakeClient(); let ended = false; viewer.on('end', () => { ended = true; });
  b.subscribe(viewer);
  encoders[0].stdout.write(Buffer.concat([pat, pmt, videoKey, videoMid])); await tick();
  const before = Buffer.concat(viewer.received).length;
  time += 30000;
  b.restart('test');
  assert.equal(encoders[0].killed, true);
  assert.ok(Math.abs(options[1].tsOffset - 31) < 0.01, 'timestamps carry on about 31 s in');
  encoders[0].emit('exit', null, 'SIGTERM'); await tick();
  assert.equal(ended, false, 'old encoder exiting does not disconnect the viewer');
  assert.equal(stops, 0, 'the extension is not told nobody is watching (so it does not pause or go to standby)');
  encoders[1].stdout.write(Buffer.concat([videoMid, pat, pmt, videoKey, videoMid])); await tick();
  assert.deepEqual(Buffer.concat(viewer.received).subarray(before), Buffer.concat([pat, pmt, videoKey, videoMid]));
  b.stop();
});

test('FFmpeg gets the timestamp offset in both passthrough and encoding', () => {
  const copy = chromeInputArgs({copyVideo: true, tsOffset: 12.5});
  assert.equal(copy[copy.indexOf('-output_ts_offset') + 1], '12.500');
  assert.ok(copy.indexOf('-output_ts_offset') < copy.lastIndexOf('-f')); // the output format, after the silent input's '-f lavfi'
  const enc = chromeInputArgs({tsOffset: 3});
  assert.ok(enc.includes('libx264') && enc.includes('3.000'));
  assert.ok(!chromeInputArgs({copyVideo: true}).includes('-output_ts_offset'));
});

test('The source encoder passes the offset to FFmpeg and reports passthrough vs encoding', async () => {
  const calls = []; const modes = [];
  const source = {attach(sink, onSession) { this.onSession = onSession; }};
  const spawnProcess = (cmd, args) => { calls.push(args); const c = fakeEncoder(); c.stdin = new PassThrough(); return c; };
  const p1 = sourceEncoder({source, ffmpeg: 'ffmpeg', tsOffset: 7, spawnProcess, onMode: m => modes.push(m)});
  source.onSession('video/webm;codecs=h264,opus');
  assert.ok(calls[0].includes('copy') && calls[0].includes('7.000'));
  p1.kill();
  const p2 = sourceEncoder({source, ffmpeg: 'ffmpeg', compatibility: true, spawnProcess, onMode: m => modes.push(m)});
  source.onSession('video/webm;codecs=h264,opus');
  assert.ok(calls[1].includes('libx264'));
  p2.kill();
  assert.match(modes[0], /^Video passthrough/);
  assert.doesNotMatch(modes[1], /^Video passthrough/);
});

test('Compatibility encoding keeps the frame rate Chrome sends (50 from Sky), and falls back to 30', async () => {
  const {sourceEncoder} = await import('../tuner/src/media.js');
  const {EventEmitter} = await import('node:events');
  const {PassThrough} = await import('node:stream');
  for (const [fps, expected] of [[50, '50'], [25, '25'], [undefined, '30'], [999, '30']]) {
    let args;
    const source = {attach(input, onMime) { onMime('video/webm;codecs=vp8,opus'); }, detach() {}};
    const fake = () => { const c = new EventEmitter(); c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => {}; return c; };
    const enc = sourceEncoder({source, ffmpeg: 'ffmpeg', getFps: () => fps, spawnProcess: (cmd, a) => { args = a; return fake(); }});
    const vf = args[args.indexOf('-vf') + 1];
    assert.match(vf, new RegExp(`^fps=${expected},`), `fps ${fps}`);
    assert.equal(args[args.indexOf('-g') + 1], String(Number(expected) * 2), 'a keyframe every 2 seconds');
    enc.kill();
  }
});

test('Plex always gets real sound data, even from a silent or muted tab', () => {
  const src = fs.readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
  assert.match(src, /createMediaStreamDestination\(\)/);
  assert.match(src, /createConstantSource\(\)[\s\S]{0,80}offset\.value = 0[\s\S]{0,60}connect\(toPlex\)[\s\S]{0,30}start\(\)/);
  assert.match(src, /new MediaStream\(\[\.\.\.media\.getVideoTracks\(\), \.\.\.toPlex\.stream\.getAudioTracks\(\)\]\)/);
});

test('Every Chrome stream gets a steady silent track mixed in, and stops with the picture', () => {
  for (const copyVideo of [true, false]) {
    const args = chromeInputArgs({copyVideo});
    assert.deepEqual(args.slice(args.indexOf('-re'), args.indexOf('-re') + 5), ['-re', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo,aformat=sample_fmts=s16']);
    assert.match(args[args.indexOf('-filter_complex') + 1], /\[0:a:0\]aresample=48000:async=1000:first_pts=0.*\[1:a\]\[tab\]amix=inputs=2:duration=first/);
    assert.ok(args.includes('-shortest'));
  }
  const silentOnly = chromeInputArgs({chromeAudio: false});
  assert.ok(!silentOnly.includes('-filter_complex'));
  assert.equal(silentOnly[silentOnly.indexOf('1:a') - 1], '-map');
});
