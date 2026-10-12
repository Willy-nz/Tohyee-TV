import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {get as httpGet} from 'node:http';
import {discover, lineup, lineupStatus, deviceXml, baseUrl, escapeXml} from '../tuner/src/hdhr.js';
import {xmltv, xmltvTime} from '../tuner/src/guide.js';
import {loadConfig, validate, DEFAULTS, defaultConfigPath} from '../tuner/src/config.js';
import {findFfmpeg, testPatternArgs, chromeCopyArgs, chromeInputArgs, recorderCodec} from '../tuner/src/ffmpeg.js';
import {TsTracker, PACKET} from '../tuner/src/ts.js';
import {Broadcaster} from '../tuner/src/broadcaster.js';
import {createTunerServer} from '../tuner/src/server.js';

const config = {...DEFAULTS, deviceId: '1A2B3C4D'};
const base = 'http://192.168.1.20:34500';

// ---- Tuner description files ---------------------------------------------
test('discover.json points Plex at the address it used', () => {
  const d = discover(base, config);
  assert.equal(d.BaseURL, base);
  assert.equal(d.LineupURL, `${base}/lineup.json`);
  assert.equal(d.DeviceID, '1A2B3C4D');
  assert.equal(d.TunerCount, 1);
});
test('lineup has the one channel with a stream URL', () => {
  assert.deepEqual(lineup(base, config), [{GuideNumber: '1', GuideName: 'Tohyee TV', URL: `${base}/stream/1`}]);
  assert.equal(lineupStatus().ScanInProgress, 0);
});
test('device.xml escapes names', () => {
  const xml = deviceXml(base, {...config, deviceName: 'Jess & Will <TV>'});
  assert.match(xml, /Jess &amp; Will &lt;TV&gt;/);
  assert.match(xml, /<URLBase>http:\/\/192\.168\.1\.20:34500<\/URLBase>/);
});
test('Only plain host[:port] values are trusted from the Host header', () => {
  assert.equal(baseUrl('192.168.1.20:34500', 'x'), 'http://192.168.1.20:34500');
  assert.equal(baseUrl('my-pc.local:34500', 'x'), 'http://my-pc.local:34500');
  assert.equal(baseUrl('[fe80::1]:34500', 'x'), 'http://[fe80::1]:34500');
  for (const bad of ['', undefined, 'a b', 'evil.com/"><x', 'host:port']) assert.equal(baseUrl(bad, 'fallback'), 'fallback');
  assert.equal(escapeXml(`<'&">`), '&lt;&apos;&amp;&quot;&gt;');
});

// ---- Guide ---------------------------------------------------------------
test('XMLTV times include the local UTC offset', () => {
  assert.match(xmltvTime(new Date(2026, 9, 11, 21, 5, 0)), /^20261011210500 [+-]\d{4}$/);
});
test('Guide covers 2 hours back and 48 ahead in hour blocks, escaped', () => {
  const xml = xmltv({...config, channelName: 'A&B'}, new Date(2026, 9, 11, 21, 30));
  assert.equal((xml.match(/<programme /g) ?? []).length, 50);
  assert.match(xml, /<display-name>A&amp;B<\/display-name>/);
  assert.match(xml, /start="20261011190000 /);
});

// ---- Settings ------------------------------------------------------------
function memoryFs(initial) {
  const files = new Map(initial ? [['/c/tuner.json', initial]] : []);
  return {files, readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error('missing'), {code: 'ENOENT'}); return files.get(p); },
    writeFileSync(p, d) { files.set(p, d); }, mkdirSync() {}};
}
test('First run creates settings with a stable device ID', () => {
  const fs = memoryFs();
  const first = loadConfig('/c/tuner.json', fs);
  assert.match(first.deviceId, /^[0-9A-F]{8}$/);
  const second = loadConfig('/c/tuner.json', fs);
  assert.equal(second.deviceId, first.deviceId);
});
test('Bad settings give a clear error', () => {
  assert.throws(() => loadConfig('/c/tuner.json', memoryFs('{"port": 99999}')), /port must be/);
  assert.throws(() => loadConfig('/c/tuner.json', memoryFs('not json')), /Could not read/);
  assert.deepEqual(validate(config), []);
});
test('Settings live in AppData on Windows', () => {
  assert.equal(defaultConfigPath({APPDATA: 'C:\\Users\\Jess\\AppData\\Roaming'}, 'win32').replaceAll('\\', '/'),
    'C:/Users/Jess/AppData/Roaming/Tohyee TV/tuner.json');
});

// ---- FFmpeg --------------------------------------------------------------
test('FFmpeg is found from settings, then the app folder, then PATH', () => {
  assert.equal(findFfmpeg({ffmpegPath: 'D:/ff.exe'}, '/app', () => true, 'win32'), 'D:/ff.exe');
  assert.match(findFfmpeg({ffmpegPath: ''}, '/app', () => true, 'win32'), /ffmpeg\.exe$/);
  assert.equal(findFfmpeg({ffmpegPath: ''}, '/app', () => false, 'win32'), 'ffmpeg');
  const inParent = findFfmpeg({ffmpegPath: ''}, ['/pkg', '/pkg/app'], p => p.replaceAll('\\', '/') === '/pkg/ffmpeg.exe', 'win32');
  assert.equal(inParent.replaceAll('\\', '/'), '/pkg/ffmpeg.exe');
});
test('Test pattern produces H.264 + AAC MPEG-TS on stdout', () => {
  const args = testPatternArgs();
  for (const want of ['libx264', 'aac', 'mpegts', 'pipe:1']) assert.ok(args.includes(want), want);
  assert.ok(args.every(a => typeof a === 'string'));
});

// ---- MPEG-TS -------------------------------------------------------------
// Builds 188-byte TS packets for tests.
function packet(pid, {start = false, randomAccess = false, payload = []} = {}) {
  const p = Buffer.alloc(PACKET, 0xff);
  p[0] = 0x47; p[1] = (start ? 0x40 : 0) | ((pid >> 8) & 0x1f); p[2] = pid & 0xff;
  if (randomAccess) {
    p[3] = 0x30; p[4] = 1; p[5] = 0x40; Buffer.from(payload).copy(p, 6);
  } else {
    p[3] = 0x10; Buffer.from(payload).copy(p, 4);
  }
  return p;
}
const PMT_PID = 0x1000, VIDEO = 0x100, AUDIO = 0x101;
const pat = packet(0, {start: true, payload: [0, 0x00, 0xb0, 13, 0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff, 1, 2, 3, 4]});
const pmt = packet(PMT_PID, {start: true, payload: [0, 0x02, 0xb0, 23, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0,
  0x0f, 0xe0 | (AUDIO >> 8), AUDIO & 0xff, 0xf0, 0, // AAC first, to check we skip it
  0x1b, 0xe0 | (VIDEO >> 8), VIDEO & 0xff, 0xf0, 0, 1, 2, 3, 4]});
const audioKey = packet(AUDIO, {start: true, randomAccess: true});
const videoKey = packet(VIDEO, {start: true, randomAccess: true});
const videoMid = packet(VIDEO);
const videoFrame = packet(VIDEO, {start: true}); // start of a non-key picture

test('TS tracker reassembles packets split across chunks and skips junk', () => {
  const t = new TsTracker();
  const all = Buffer.concat([Buffer.from([1, 2, 3]), pat, pmt]);
  const a = t.align(all.subarray(0, 100));
  const b = t.align(all.subarray(100));
  assert.equal(a.length + b.length, 2 * PACKET);
  assert.equal(Buffer.concat([a, b])[0], 0x47);
});
test('TS tracker finds the video keyframe, not audio random-access points', () => {
  const t = new TsTracker();
  const index = t.scan(Buffer.concat([pat, pmt, audioKey, videoMid, videoKey]));
  assert.equal(t.videoPid, VIDEO);
  assert.equal(index, 4);
  assert.equal(t.tables().length, 2 * PACKET);
});

// ---- Shared encoder ------------------------------------------------------
function fakeEncoder() {
  const e = new EventEmitter();
  e.stdout = new PassThrough(); e.stderr = new PassThrough();
  e.killed = false; e.kill = () => { e.killed = true; };
  return e;
}
function fakeClient() {
  const c = new PassThrough();
  c.received = [];
  c.on('data', d => c.received.push(d));
  return c;
}
const tick = () => new Promise(r => setImmediate(r));

test('Viewers share one encoder; a late viewer starts at a keyframe with tables', async () => {
  let spawned = 0; let enc;
  const b = new Broadcaster({spawnEncoder: () => { spawned++; return (enc = fakeEncoder()); }});
  const first = fakeClient(); b.subscribe(first);
  enc.stdout.write(Buffer.concat([pat, pmt, videoKey, videoMid])); await tick();
  const late = fakeClient(); b.subscribe(late);
  enc.stdout.write(Buffer.concat([videoMid, audioKey])); await tick();
  assert.equal(Buffer.concat(late.received).length, 0, 'late viewer waits for a keyframe');
  enc.stdout.write(Buffer.concat([videoMid, videoKey, videoMid])); await tick();
  const got = Buffer.concat(late.received);
  assert.deepEqual(got, Buffer.concat([pat, pmt, videoKey, videoMid]));
  assert.equal(Buffer.concat(first.received).length, 9 * PACKET);
  assert.equal(spawned, 1);
  b.stop();
});
test('Encoder stops after the last viewer leaves, and restarts on return', async () => {
  let spawned = 0; let enc;
  const b = new Broadcaster({idleStopMs: 20, spawnEncoder: () => { spawned++; return (enc = fakeEncoder()); }});
  const c = fakeClient(); b.subscribe(c);
  c.destroy(); await new Promise(r => setTimeout(r, 40));
  assert.equal(enc.killed, true); assert.equal(b.running, false);
  b.subscribe(fakeClient()); assert.equal(spawned, 2);
  b.stop();
});
test('A viewer who returns within the idle delay keeps the same encoder', async () => {
  let spawned = 0;
  const b = new Broadcaster({idleStopMs: 50, spawnEncoder: () => { spawned++; return fakeEncoder(); }});
  const c = fakeClient(); b.subscribe(c); c.destroy(); await tick();
  b.subscribe(fakeClient()); await new Promise(r => setTimeout(r, 80));
  assert.equal(spawned, 1); assert.equal(b.running, true);
  b.stop();
});
test('A viewer who falls too far behind is disconnected; others continue', async () => {
  let enc;
  const b = new Broadcaster({maxBufferedBytes: 10, spawnEncoder: () => (enc = fakeEncoder())});
  const slow = new PassThrough({highWaterMark: 1}); // never read
  const ok = fakeClient();
  b.subscribe(slow); b.subscribe(ok);
  for (let i = 0; i < 3; i++) { enc.stdout.write(Buffer.concat([pat, pmt, videoKey])); await tick(); }
  assert.equal(slow.destroyed, true);
  assert.ok(Buffer.concat(ok.received).length >= 6 * PACKET);
  b.stop();
});
test('If FFmpeg exits, viewers are disconnected so Plex can retry', async () => {
  let enc; const logs = [];
  const b = new Broadcaster({log: m => logs.push(m), spawnEncoder: () => (enc = fakeEncoder())});
  const c = fakeClient(); let ended = false; c.on('end', () => { ended = true; });
  b.subscribe(c); enc.stderr.write('boom'); await tick();
  enc.emit('exit', 1, null); c.resume(); await tick();
  assert.equal(ended, true); assert.equal(b.running, false);
  assert.ok(logs.some(l => /unexpectedly.*boom/.test(l)));
});
test('Missing FFmpeg gives a helpful message', () => {
  let enc; const logs = [];
  const b = new Broadcaster({log: m => logs.push(m), spawnEncoder: () => (enc = fakeEncoder())});
  b.subscribe(fakeClient()); enc.emit('error', Object.assign(new Error('x'), {code: 'ENOENT'}));
  assert.ok(logs.some(l => /FFmpeg was not found/.test(l)));
});

// ---- HTTP server ---------------------------------------------------------
async function withServer(fn) {
  const subscribed = [];
  const broadcaster = {running: false, clients: new Set(), subscribe: res => { subscribed.push(res); res.end('TS'); }};
  const server = createTunerServer({config, broadcaster});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const {port} = server.address();
  try { await fn(`http://127.0.0.1:${port}`, subscribed); } finally { server.close(); }
}
test('Server answers every Plex request with the right content', () => withServer(async (url, subscribed) => {
  // fetch() won't set Host, so use a plain request to check it is honoured.
  const d = await new Promise((resolve, reject) => httpGet(`${url}/discover.json`, {headers: {host: '10.0.0.5:34500'}}, res => {
    let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve(JSON.parse(body)));
  }).on('error', reject));
  assert.equal(d.BaseURL, 'http://10.0.0.5:34500');
  const l = await (await fetch(`${url}/lineup.json`)).json();
  assert.equal(l[0].URL, `${url}/stream/1`);
  assert.equal((await fetch(`${url}/lineup_status.json`)).status, 200);
  assert.match(await (await fetch(`${url}/device.xml`)).text(), /<deviceType>/);
  assert.match(await (await fetch(`${url}/guide.xml`)).text(), /<tv /);
  assert.equal((await fetch(`${url}/lineup.post?scan=start`, {method: 'POST'})).status, 200);
  assert.match(await (await fetch(url)).text(), /Tohyee TV tuner is running/);
  assert.equal((await fetch(`${url}/nope`)).status, 404);
  assert.equal((await fetch(`${url}/stream/2`)).status, 404);
  const head = await fetch(`${url}/stream/1`, {method: 'HEAD'});
  assert.equal(head.headers.get('content-type'), 'video/mpeg');
  assert.equal(subscribed.length, 0, 'HEAD does not start the encoder');
  const get = await fetch(`${url}/stream/1`);
  assert.equal(await get.text(), 'TS');
  assert.equal(subscribed.length, 1);
}));

// ---- Chrome connection (real WebSocket client) ----------------------------
import {SourceHub} from '../tuner/src/source.js';
import {encodeFrame, acceptKey} from '../tuner/src/ws.js';
import {createConnection} from 'node:net';

async function withHub(fn) {
  const logs = [];
  const hub = new SourceHub({log: m => logs.push(m)});
  const broadcaster = {running: false, clients: new Set(), subscribe: res => res.end()};
  const server = createTunerServer({config, broadcaster, source: hub});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const {port} = server.address();
  try { await fn({hub, port, logs}); } finally { server.closeAllConnections?.(); server.close(); }
}
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};
function extensionSocket(port, origin = 'chrome-extension://abc') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/source`, {headers: {Origin: origin}});
  ws.binaryType = 'arraybuffer';
  ws.received = [];
  ws.addEventListener('message', e => ws.received.push(JSON.parse(e.data)));
  return ws;
}

test('WebSocket handshake key matches the RFC example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.deepEqual([...encodeFrame(1, Buffer.from('hi'))], [0x81, 2, 0x68, 0x69]);
  assert.equal(encodeFrame(2, Buffer.alloc(70000)).subarray(0, 2)[1], 127);
});

test('Chrome connects, is told when Plex watches, and its media reaches the encoder', () => withHub(async ({hub, port}) => {
  const ws = extensionSocket(port);
  await new Promise(r => ws.addEventListener('open', r));
  ws.send(JSON.stringify({type: 'hello', version: '0.3.0', tabTitle: 'Sky Go'}));
  await until(() => hub.status().tabTitle === 'Sky Go');
  assert.equal(hub.available, true);

  const sink = new PassThrough(); const got = []; sink.on('data', d => got.push(d));
  hub.setViewers(1);
  hub.attach(sink);
  await until(() => ws.received.some(m => m.type === 'start'));
  const start = ws.received.find(m => m.type === 'start');
  ws.send(new Uint8Array([9, 9])); // before the session marker: must be ignored
  ws.send(JSON.stringify({type: 'session', session: start.session, mimeType: 'video/webm'}));
  const big = new Uint8Array(200000).fill(7); // multi-frame-length payload
  ws.send(new Uint8Array([1, 2, 3])); ws.send(big);
  await until(() => Buffer.concat(got).length === 200003);
  assert.deepEqual([...Buffer.concat(got).subarray(0, 3)], [1, 2, 3]);
  assert.ok(ws.received.some(m => m.type === 'viewers' && m.count === 1));

  hub.detach();
  await until(() => ws.received.some(m => m.type === 'stop'));
  ws.close();
  await until(() => !hub.available);
}));

test('Media from an old session is ignored', () => withHub(async ({hub, port}) => {
  const ws = extensionSocket(port);
  await new Promise(r => ws.addEventListener('open', r));
  const sink = new PassThrough(); const got = []; sink.on('data', d => got.push(d));
  hub.attach(sink); hub.detach(); hub.attach(sink);
  await until(() => ws.received.filter(m => m.type === 'start').length === 2);
  ws.send(JSON.stringify({type: 'session', session: 1})); ws.send(new Uint8Array([5]));
  ws.send(JSON.stringify({type: 'session', session: 2})); ws.send(new Uint8Array([6]));
  await until(() => got.length > 0);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual([...Buffer.concat(got)], [6]);
  ws.close();
}));

test('If Chrome disconnects mid-stream, the encoder input is closed', () => withHub(async ({hub, port}) => {
  const ws = extensionSocket(port);
  await new Promise(r => ws.addEventListener('open', r));
  const sink = new PassThrough(); let ended = false; sink.on('end', () => { ended = true; }); sink.resume();
  hub.attach(sink);
  await until(() => ws.received.some(m => m.type === 'start'));
  ws.close();
  await until(() => ended);
  assert.equal(hub.available, false);
}));

test('Only a Chrome extension on this computer may connect as the source', () => withHub(async ({hub, port, logs}) => {
  const bad = extensionSocket(port, 'https://evil.example');
  const result = await new Promise(r => { bad.addEventListener('open', () => r('open')); bad.addEventListener('error', () => r('refused')); });
  assert.equal(result, 'refused');
  assert.equal(hub.available, false);
  assert.ok(logs.some(l => /Refused/.test(l)));
}));

test('A newer Chrome connection replaces the old one', () => withHub(async ({hub, port}) => {
  const first = extensionSocket(port); await new Promise(r => first.addEventListener('open', r));
  const closed = new Promise(r => first.addEventListener('close', r));
  const second = extensionSocket(port); await new Promise(r => second.addEventListener('open', r));
  await closed;
  assert.equal(hub.available, true);
  second.close();
}));

test('Unmasked or oversized client frames are rejected', async () => {
  const {WebSocketConnection} = await import('../tuner/src/ws.js');
  const socket = new PassThrough(); const out = []; socket.on('data', d => out.push(d));
  socket.setNoDelay = () => {};
  const conn = new WebSocketConnection(socket, {maxMessageBytes: 10});
  let closed = false; conn.on('close', () => { closed = true; });
  socket.emit('data', Buffer.from([0x82, 0x02, 1, 2])); // unmasked
  assert.equal(closed, true);
  const socket2 = new PassThrough(); socket2.setNoDelay = () => {}; socket2.resume();
  const conn2 = new WebSocketConnection(socket2, {maxMessageBytes: 10});
  let closed2 = false; conn2.on('close', () => { closed2 = true; });
  socket2.emit('data', Buffer.from([0x82, 0x80 | 50, 0, 0, 0, 0]));
  assert.equal(closed2, true);
});

test('With Chrome not connected, Plex gets a clear "not broadcasting" answer', () => withHub(async ({port}) => {
  const res = await fetch(`http://127.0.0.1:${port}/stream/1`);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /not broadcasting/);
}));

// ---- Pass-through (no re-encoding) ---------------------------------------
test('Pass-through copies the picture and only converts the sound', () => {
  const args = chromeCopyArgs();
  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'copy']);
  assert.ok(!args.includes('libx264') && !args.includes('-vf'));
  assert.ok(args.includes('aac') && args.at(-1) === 'pipe:1');
  assert.ok(!args.includes('-output_ts_offset'));
  const later = chromeInputArgs({tsOffset: 12.5});
  assert.equal(later[later.indexOf('-output_ts_offset') + 1], '12.500');
  assert.ok(later.includes('libx264'));
});
test('Recorder types map to codecs', () => {
  assert.equal(recorderCodec('video/webm;codecs=h264,opus'), 'h264');
  assert.equal(recorderCodec('video/webm;codecs=avc1.42E01F'), 'h264');
  assert.equal(recorderCodec('video/webm;codecs=vp8,opus'), 'vp8');
  assert.equal(recorderCodec('video/webm'), '');
  assert.equal(recorderCodec(undefined), '');
});
test('The video setting is checked', () => {
  assert.deepEqual(validate({...config, video: 'auto'}), []);
  assert.match(validate({...config, video: 'fast'}).join(), /video must be/);
});

test('A long run of pictures without a keyframe is reported once', async () => {
  let time = 0; let enc; const gaps = [];
  const b = new Broadcaster({now: () => time, maxKeyframeGapMs: 6000, minFramesForGap: 3,
    onKeyframeGap: ms => gaps.push(ms), spawnEncoder: () => (enc = fakeEncoder())});
  b.subscribe(fakeClient());
  enc.stdout.write(Buffer.concat([pat, pmt, videoKey])); await tick();
  for (let i = 0; i < 5; i++) { time += 2000; enc.stdout.write(videoFrame); await tick(); }
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0] > 6000);
  time += 2000; enc.stdout.write(videoFrame); await tick();
  assert.equal(gaps.length, 1, 'only reported once per encoder');
  b.stop();
});
test('No keyframe report while the picture is simply not changing (no frames)', async () => {
  let time = 0; let enc; const gaps = [];
  const b = new Broadcaster({now: () => time, maxKeyframeGapMs: 6000, minFramesForGap: 3,
    onKeyframeGap: ms => gaps.push(ms), spawnEncoder: () => (enc = fakeEncoder())});
  b.subscribe(fakeClient());
  enc.stdout.write(Buffer.concat([pat, pmt, videoKey])); await tick();
  time += 20000; enc.stdout.write(audioKey); await tick(); // audio only, no new pictures
  assert.equal(gaps.length, 0);
  b.stop();
});
test('Restarting the encoder keeps viewers connected and resyncs them at a keyframe', async () => {
  let time = 1000; const encoders = []; const options = [];
  const b = new Broadcaster({now: () => time, spawnEncoder: o => { options.push(o); const e = fakeEncoder(); encoders.push(e); return e; }});
  const viewer = fakeClient(); let ended = false; viewer.on('end', () => { ended = true; });
  b.subscribe(viewer);
  encoders[0].stdout.write(Buffer.concat([pat, pmt, videoKey, videoMid])); await tick();
  const before = Buffer.concat(viewer.received).length;
  time += 30000;
  b.restart('test');
  assert.equal(encoders[0].killed, true);
  assert.equal(encoders.length, 2);
  assert.ok(Math.abs(options[1].tsOffset - 31) < 0.01, 'timestamps continue ~31 s in');
  encoders[0].stdout.write(videoMid); encoders[0].emit('exit', null, 'SIGTERM'); await tick();
  assert.equal(ended, false, 'old encoder exiting does not disconnect the viewer');
  encoders[1].stdout.write(Buffer.concat([videoMid, pat, pmt, videoKey, videoMid])); await tick();
  const after = Buffer.concat(viewer.received).subarray(before);
  assert.deepEqual(after, Buffer.concat([pat, pmt, videoKey, videoMid]), 'resumes with tables then a keyframe');
  assert.equal(b.clients.size, 1);
  b.stop();
});

test('Chrome tells the tuner its recording codec, and confirms it per session', () => withHub(async ({hub, port}) => {
  const sessions = [];
  hub.onSession = codec => sessions.push(codec);
  const ws = extensionSocket(port);
  await new Promise(r => ws.addEventListener('open', r));
  ws.send(JSON.stringify({type: 'hello', version: 'x', tabTitle: 't', recorder: 'video/webm;codecs=h264,opus'}));
  await until(() => hub.codec === 'h264');
  const sink = new PassThrough(); sink.resume();
  hub.attach(sink);
  await until(() => ws.received.some(m => m.type === 'start'));
  ws.send(JSON.stringify({type: 'session', session: hub.session, mimeType: 'video/webm;codecs=h264,opus'}));
  await until(() => sessions.length === 1);
  assert.deepEqual(sessions, ['h264']);
  ws.close();
}));
