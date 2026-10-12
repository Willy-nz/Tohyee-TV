import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const code = fs.readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');

function harness({workerReplies = {}, getUserMedia} = {}) {
  let listener;
  const timers = new Map(); let nextTimer = 0;
  const toWorker = [];
  const sockets = [];
  const recorders = [];
  const tracks = [new EventTarget(), new EventTarget()];
  for (const t of tracks) { t.readyState = 'live'; t.stop = () => { t.readyState = 'ended'; }; }
  const media = {getTracks: () => tracks, getAudioTracks: () => [tracks[1]], getVideoTracks: () => [tracks[0]]};

  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.closedByUs = true; }
    open() { this.readyState = 1; this.onopen?.(); }
    message(obj) { this.onmessage?.({data: JSON.stringify(obj)}); }
    drop() { this.readyState = 3; this.onclose?.(); }
    json() { return this.sent.filter(d => typeof d === 'string').map(d => JSON.parse(d)); }
  }
  class FakeRecorder {
    static isTypeSupported(t) { return t === 'video/webm;codecs=vp8,opus'; }
    constructor(stream, options) { this.options = options; this.state = 'inactive'; recorders.push(this); }
    start(slice) { this.slice = slice; this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    chunk(size) { this.ondataavailable({data: {size, id: `chunk${size}`}}); }
  }
  const context = {
    chrome: {
      runtime: {
        id: 'ext', getManifest: () => ({version: '0.3.0'}),
        onMessage: {addListener(fn) { listener = fn; }},
        sendMessage: async message => { toWorker.push(message); return workerReplies[message.type]?.(message); }
      }
    },
    navigator: {mediaDevices: {getUserMedia: getUserMedia ?? (async () => media)}},
    MediaRecorder: FakeRecorder,
    WebSocket: FakeSocket,
    AudioContext: class { createMediaStreamSource() { return {connect() {}}; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } },
    setTimeout(fn, ms) { timers.set(++nextTimer, {fn, ms}); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    JSON, Number, Math, URL, Promise, Error
  };
  vm.runInNewContext(code, context);
  const send = (type, extra = {}) => new Promise(resolve => listener({target: 'offscreen', type, ...extra}, {id: 'ext'}, resolve));
  const runTimers = async (filter = () => true) => {
    for (const [id, t] of [...timers]) if (filter(t)) { timers.delete(id); await t.fn(); }
  };
  return {send, sockets, recorders, tracks, timers, toWorker, runTimers};
}
const tick = () => new Promise(r => setImmediate(r));
const arm = h => h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', port: 34500, reloadOnWatch: true});

test('Broadcasting connects to the tuner on this computer and says hello', async () => {
  const h = harness();
  const state = await arm(h);
  assert.equal(state.state, 'connecting');
  assert.equal(h.sockets[0].url, 'ws://127.0.0.1:34500/source');
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].json()[0], {type: 'hello', version: '0.3.0', tabTitle: 'Sky Go', reloadOnWatch: true, pauseWhenIdle: true, recorder: 'video/webm;codecs=vp8,opus'});
  assert.equal((await h.send('status')).state, 'ready');
});

test('Media is only sent while Plex is watching, starting with the session marker', async () => {
  const h = harness();
  await arm(h); const ws = h.sockets[0]; ws.open();
  assert.equal(h.recorders.length, 0, 'nothing recorded before anyone watches');
  ws.message({type: 'start', session: 3});
  const rec = h.recorders[0];
  assert.equal(rec.state, 'recording');
  assert.equal(rec.slice, 250);
  assert.equal(rec.options.videoKeyFrameIntervalDuration, 2000, 'asks Chrome for a keyframe every 2 s');
  const session = ws.json().find(m => m.type === 'session');
  assert.deepEqual(session, {type: 'session', session: 3, mimeType: 'video/webm;codecs=vp8,opus'});
  rec.chunk(100); rec.chunk(0); rec.chunk(200);
  assert.deepEqual(ws.sent.filter(d => typeof d !== 'string').map(d => d.size), [100, 200]);
  assert.equal((await h.send('status')).state, 'live');
  ws.message({type: 'stop'}); await tick();
  assert.equal(rec.state, 'inactive');
  assert.equal((await h.send('status')).state, 'ready');
});

test('A new start replaces the previous recording so each session begins cleanly', async () => {
  const h = harness();
  await arm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'start', session: 1});
  ws.message({type: 'start', session: 2});
  assert.equal(h.recorders[0].state, 'inactive');
  assert.equal(h.recorders[1].state, 'recording');
  h.recorders[0].ondataavailable({data: {size: 50}});
  assert.equal(ws.sent.filter(d => typeof d !== 'string').length, 0, 'late data from the old recorder is dropped');
});

test('When someone starts watching, the tab is reloaded and playback checked', async () => {
  const h = harness({workerReplies: {reloadTab: () => ({ok: true}), ensurePlaying: () => ({playing: true})}});
  await arm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'viewers', count: 1});
  await tick();
  assert.ok(h.toWorker.some(m => m.type === 'reloadTab' && m.tabId === 7));
  assert.equal([...h.timers.values()].length, 3, 'three playback checks scheduled');
  await h.runTimers(t => t.ms === 6000);
  assert.ok(h.toWorker.some(m => m.type === 'ensurePlaying'));
  assert.match((await h.send('status')).message, /Playing/);
  assert.equal(h.timers.size, 0, 'remaining checks cancelled once playing');
});

test('A second viewer does not reload the tab again; reload can be switched off', async () => {
  const h = harness({workerReplies: {reloadTab: () => ({ok: true})}});
  await arm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'viewers', count: 1}); await tick();
  ws.message({type: 'viewers', count: 2}); await tick();
  assert.equal(h.toWorker.filter(m => m.type === 'reloadTab').length, 1);
  ws.message({type: 'viewers', count: 0});
  await h.send('settings', {reloadOnWatch: false});
  ws.message({type: 'viewers', count: 1}); await tick();
  assert.equal(h.toWorker.filter(m => m.type === 'reloadTab').length, 1);
});

test('Without permission to press Play, it says so instead of failing silently', async () => {
  const h = harness({workerReplies: {reloadTab: () => ({ok: true}), ensurePlaying: () => ({permission: false})}});
  await arm(h); h.sockets[0].open();
  h.sockets[0].message({type: 'viewers', count: 1}); await tick();
  await h.runTimers(t => t.ms === 6000);
  assert.match((await h.send('status')).message, /Press Play/);
});

test('When nobody is watching, the video is paused; when someone returns, Play is pressed', async () => {
  const h = harness({workerReplies: {pauseVideo: () => ({paused: true}), ensurePlaying: () => ({playing: true})}});
  await h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', port: 34500, reloadOnWatch: false, pauseWhenIdle: true});
  const ws = h.sockets[0]; ws.open();
  ws.message({type: 'start', session: 1});
  ws.message({type: 'viewers', count: 1}); await tick();
  ws.message({type: 'viewers', count: 0});
  ws.message({type: 'stop'}); await tick();
  assert.ok(h.toWorker.some(m => m.type === 'pauseVideo' && m.tabId === 7));
  assert.match((await h.send('status')).message, /paused the video/);
  assert.equal(h.toWorker.filter(m => m.type === 'reloadTab').length, 0, 'reload is off');
  ws.message({type: 'viewers', count: 1}); await tick();
  await h.runTimers(t => t.ms === 300);
  assert.ok(h.toWorker.some(m => m.type === 'ensurePlaying'), 'presses Play when someone starts watching');
  assert.match((await h.send('status')).message, /Playing/);
});

test('With pausing switched off, the video is left alone', async () => {
  const h = harness({workerReplies: {pauseVideo: () => ({paused: true})}});
  await h.send('arm', {streamId: 'sid', tabId: 7, port: 34500, reloadOnWatch: false, pauseWhenIdle: false});
  const ws = h.sockets[0]; ws.open();
  ws.message({type: 'start', session: 1}); ws.message({type: 'stop'}); await tick();
  assert.equal(h.toWorker.filter(m => m.type === 'pauseVideo').length, 0);
  ws.message({type: 'viewers', count: 1}); await tick();
  assert.equal(h.timers.size, 0, 'no Play presses either');
});

test('Without site permission, it says it could not pause', async () => {
  const h = harness({workerReplies: {pauseVideo: () => ({permission: false})}});
  await arm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick();
  assert.match((await h.send('status')).message, /Couldn’t pause/);
});

test('If the tuner goes away, it keeps retrying and stops sending', async () => {
  const h = harness();
  await arm(h); h.sockets[0].open();
  h.sockets[0].message({type: 'start', session: 1});
  h.sockets[0].drop();
  assert.equal(h.recorders[0].state, 'inactive');
  const status = await h.send('status');
  assert.equal(status.state, 'connecting');
  assert.match(status.message, /Start Tohyee TV Tuner/);
  await h.runTimers();
  assert.equal(h.sockets.length, 2, 'reconnected');
});

test('Closing the tab or Chrome stopping the share ends the broadcast', async () => {
  const h = harness();
  await arm(h); h.sockets[0].open();
  h.tracks[0].dispatchEvent(new Event('ended'));
  const status = await h.send('status');
  assert.equal(status.state, 'idle');
  assert.match(status.message, /closed|stopped/);
  assert.equal(h.sockets[0].closedByUs, true);
  assert.ok(h.tracks.every(t => t.readyState === 'ended'));
});

test('Stop releases the capture and does not reconnect', async () => {
  const h = harness();
  await arm(h); h.sockets[0].open();
  const status = await h.send('disarm', {message: 'Broadcast stopped.'});
  assert.equal(status.state, 'idle');
  assert.ok(h.tracks.every(t => t.readyState === 'ended'));
  assert.equal(h.timers.size, 0);
});

test('A capture failure is reported, not left hanging', async () => {
  const h = harness({getUserMedia: async () => { throw Object.assign(new Error('Permission denied'), {name: 'NotAllowedError'}); }});
  const status = await arm(h);
  assert.equal(status.state, 'error');
  assert.match(status.message, /Permission denied/);
  assert.equal(h.sockets.length, 0);
});

test('Extension manifest asks only for what it needs', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.permissions.sort(), ['activeTab', 'offscreen', 'scripting', 'storage', 'tabCapture']);
  assert.equal(m.host_permissions, undefined, 'site access is only requested per site, when needed');
  assert.match(m.content_security_policy.extension_pages, /connect-src ws:\/\/127\.0\.0\.1:\*$/);
});
