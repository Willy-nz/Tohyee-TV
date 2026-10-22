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
    AudioContext: class { constructor(){this.state='running';} createMediaStreamSource() { return {connect() {}}; } createMediaStreamDestination() { return {stream: {getAudioTracks: () => [{kind: 'audio', stop() {}}]}}; } createConstantSource() { return {offset: {value: 1}, connect() {}, start() {}}; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(t => t.kind !== 'audio'); } },
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
  assert.equal(h.sockets[0].url, 'ws://127.0.0.1:34500/source/1');
  h.sockets[0].open();
  assert.deepEqual(h.sockets[0].json()[0], {type: 'hello', version: '0.3.0', tabTitle: 'Sky Go', reloadOnWatch: true, idleAction: 'standby', frameRate: 50, captureSize: ''});
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
  const session = ws.json().find(m => m.type === 'session');
  assert.deepEqual(session, {type: 'session', session: 3, mimeType: 'video/webm;codecs=vp8,opus', encoder: "Chrome's recorder"});
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
  await h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', port: 34500, reloadOnWatch: false, idleAction: 'pause'});
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

test('With "Keep playing", the video is left alone', async () => {
  const h = harness({workerReplies: {pauseVideo: () => ({paused: true})}});
  await h.send('arm', {streamId: 'sid', tabId: 7, port: 34500, reloadOnWatch: false, idleAction: 'none'});
  const ws = h.sockets[0]; ws.open();
  ws.message({type: 'start', session: 1}); ws.message({type: 'stop'}); await tick();
  assert.equal(h.toWorker.filter(m => m.type === 'pauseVideo').length, 0);
  ws.message({type: 'viewers', count: 1}); await tick();
  assert.equal(h.timers.size, 0, 'no Play presses either');
});

test('Without site permission, it says it could not pause', async () => {
  const h = harness({workerReplies: {pauseVideo: () => ({permission: false})}});
  await h.send('arm', {streamId: 'sid', tabId: 7, port: 34500, reloadOnWatch: false, idleAction: 'pause'});
  const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick();
  assert.match((await h.send('status')).message, /Couldn’t pause/);
});

// ---- Standby: leave the video page so it stops using a stream --------------
const standbyArm = (h, extra = {}) => h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', tabUrl: 'https://www.skygo.co.nz/watch/live/1', port: 34500, reloadOnWatch: true, idleAction: 'standby', standbySeconds: 60, ...extra});
const standbyReplies = (more = {}) => ({pauseVideo: () => ({paused: true}), standbyTab: () => ({ok: true, url: null}), returnTab: () => ({ok: true}), ensurePlaying: () => ({playing: true}), reloadTab: () => ({ok: true}), ...more});

test('Nobody watching: pause now, leave the video page after the set time', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'viewers', count: 1}); await tick();
  await h.runTimers(); // reload/play checks from someone starting to watch
  ws.message({type: 'viewers', count: 0}); ws.message({type: 'stop'}); await tick();
  assert.ok(h.toWorker.some(m => m.type === 'pauseVideo'), 'pauses straight away');
  assert.match((await h.send('status')).message, /Leaving the video page in 1 minute/);
  assert.equal(h.toWorker.filter(m => m.type === 'standbyTab').length, 0, 'not yet');
  const standbyTimer = [...h.timers.values()].find(t => t.ms === 60000);
  assert.ok(standbyTimer, 'waits the chosen 60 s');
  await h.runTimers(t => t.ms === 60000);
  const leave = h.toWorker.find(m => m.type === 'standbyTab');
  assert.equal(leave.tabId, 7); assert.equal(leave.channelNumber, '1');
  const status = await h.send('status');
  assert.equal(status.inStandby, true);
  assert.match(status.message, /Standby/);
  assert.equal(status.returnUrl, 'https://www.skygo.co.nz/watch/live/1');
});

test('A channel that is broadcast but never watched also leaves the video page after the set time', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open(); await tick();
  assert.match((await h.send('status')).message, /Nobody is watching yet: leaving the video page in 1 minute/);
  assert.equal([...h.timers.values()].filter(t => t.ms === 60000).length, 1, 'one 60 s wait from the start');
  await h.runTimers(t => t.ms === 60000);
  const leave = h.toWorker.find(m => m.type === 'standbyTab');
  assert.equal(leave.tabId, 7);
  assert.equal((await h.send('status')).inStandby, true);
  ws.message({type: 'viewers', count: 1}); await tick();
  assert.ok(h.toWorker.some(m => m.type === 'returnTab' && m.url === 'https://www.skygo.co.nz/watch/live/1'), 'goes back when someone watches');
});

test('Watching before the wait is up cancels the never-watched standby', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'viewers', count: 1}); await tick();
  assert.ok(![...h.timers.values()].some(t => t.ms === 60000));
  assert.equal(h.toWorker.filter(m => m.type === 'standbyTab').length, 0);
});

test('With Pause or Keep playing, an unwatched channel is left alone', async () => {
  for (const idleAction of ['pause', 'none']) {
    const h = harness({workerReplies: standbyReplies()});
    await standbyArm(h, {idleAction}); h.sockets[0].open();
    assert.ok(![...h.timers.values()].some(t => t.ms === 60000), idleAction);
    assert.match((await h.send('status')).message, /^Ready\. Waiting for someone/);
  }
});

test('Each channel has its own never-watched wait', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); await standbyArm(h, {channelNumber: '2', tabId: 8});
  assert.equal(h.sockets.length, 2);
  for (const ws of h.sockets) ws.open();
  assert.equal([...h.timers.values()].filter(t => t.ms === 60000).length, 2);
  h.sockets[0].message({type: 'viewers', count: 1}); await tick();
  await h.runTimers(t => t.ms === 60000);
  const left = h.toWorker.filter(m => m.type === 'standbyTab');
  assert.deepEqual(left.map(m => [m.tabId, m.channelNumber]), [[8, '2']], 'only the unwatched channel leaves');
});

test('Someone starts watching on standby: go back to the same video page and press Play', async () => {
  const h = harness({workerReplies: standbyReplies({standbyTab: () => ({ok: true, url: 'https://www.skygo.co.nz/watch/live/5'})})});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick();
  await h.runTimers(t => t.ms === 60000);
  ws.message({type: 'viewers', count: 1}); await tick();
  const back = h.toWorker.find(m => m.type === 'returnTab');
  assert.equal(back.url, 'https://www.skygo.co.nz/watch/live/5', 'uses the page as it was when it left');
  assert.equal(h.toWorker.filter(m => m.type === 'reloadTab').length, 0, 'going back already loads the page; no extra reload');
  assert.equal((await h.send('status')).inStandby, false);
  await h.runTimers(t => t.ms === 6000);
  assert.ok(h.toWorker.some(m => m.type === 'ensurePlaying'));
  assert.match((await h.send('status')).message, /Playing/);
});

test('Someone starts watching before the standby time: the page is never left', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick();
  assert.ok([...h.timers.values()].some(t => t.ms === 60000));
  ws.message({type: 'viewers', count: 1}); await tick();
  assert.ok(![...h.timers.values()].some(t => t.ms === 60000), 'standby cancelled');
  assert.equal(h.toWorker.filter(m => m.type === 'standbyTab').length, 0);
  assert.ok(h.toWorker.some(m => m.type === 'reloadTab'), 'carries on as normal (reload is on)');
});

test('The standby time can be changed, and switching to Pause cancels a pending standby', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h, {standbySeconds: 300}); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick();
  assert.ok([...h.timers.values()].some(t => t.ms === 300000));
  assert.match((await h.send('status')).message, /5 minutes/);
  await h.send('settings', {idleAction: 'pause'});
  assert.ok(![...h.timers.values()].some(t => t.ms === 300000));
});

test('The standby page’s title is not reported as the programme', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick(); await h.runTimers(t => t.ms === 60000);
  await h.send('title', {tabId: 7, title: 'Tohyee TV · standby'});
  assert.equal((await h.send('status')).tabTitle, 'Sky Go');
});

test('Stopping the broadcast while on standby gives the video page back', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick(); await h.runTimers(t => t.ms === 60000);
  await h.send('disarm', {message: 'Broadcast stopped.'});
  assert.ok(h.toWorker.some(m => m.type === 'returnTab' && m.url === 'https://www.skygo.co.nz/watch/live/1'));
  assert.equal((await h.send('status')).state, 'idle');
});

test('"Go back to the video now" on the standby page returns without waiting for Plex', async () => {
  const h = harness({workerReplies: standbyReplies()});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick(); await h.runTimers(t => t.ms === 60000);
  await h.send('leaveStandby'); await tick();
  assert.ok(h.toWorker.some(m => m.type === 'returnTab'));
  const status = await h.send('status');
  assert.equal(status.inStandby, false);
  assert.match(status.message, /Back on the video page/);
});

test('If the page can’t be left, it says so and stays put', async () => {
  const h = harness({workerReplies: standbyReplies({standbyTab: () => ({ok: false, error: 'No tab with id: 7'})})});
  await standbyArm(h); const ws = h.sockets[0]; ws.open();
  ws.message({type: 'stop'}); await tick(); await h.runTimers(t => t.ms === 60000);
  const status = await h.send('status');
  assert.equal(status.inStandby, false);
  assert.match(status.message, /couldn’t be closed: No tab/);
});

test('Popup and worker offer the new choices; the standby page exists', () => {
  const popup = fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
  for (const v of ['standby', 'pause', 'none']) assert.match(popup, new RegExp(`<option value="${v}"`));
  assert.ok(!/id="pause"/.test(popup), 'old tickbox removed');
  const worker = fs.readFileSync(new URL('../extension/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /idleAction: 'standby', standbySeconds: 60/);
  assert.match(worker, /stored\.pauseWhenIdle === false\) result\.idleAction = 'none'/, 'old "pause off" setting carries over');
  assert.ok(fs.existsSync(new URL('../extension/standby.html', import.meta.url)));
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
  assert.deepEqual(m.host_permissions, ['http://127.0.0.1/*'], 'only local tuner access is installed; website playback permissions remain optional');
  assert.match(m.content_security_policy.extension_pages, /connect-src ws:\/\/127\.0\.0\.1:\* http:\/\/127\.0\.0\.1:\*$/);
});

test('Desktop Stop disarms the extension and stops all tracks',async()=>{
 const h=harness();await arm(h);const ws=h.sockets[0];ws.open();ws.message({type:'shutdown'});
 assert.equal((await h.send('status')).armed,false);assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});
test('Fast Plex reconnect does not reload the source twice',async()=>{
 const h=harness({workerReplies:{reloadTab:()=>({ok:true})}});await arm(h);const ws=h.sockets[0];ws.open();
 ws.message({type:'viewers',count:1});await tick();ws.message({type:'viewers',count:0});ws.message({type:'viewers',count:1});await tick();
 assert.equal(h.toWorker.filter(m=>m.type==='reloadTab').length,1);
});
test('Recorder failure closes transport and remains stoppable',async()=>{
 const h=harness();await arm(h);const ws=h.sockets[0];ws.open();ws.message({type:'start',session:1});h.recorders[0].onerror();
 assert.equal(ws.readyState,3);assert.equal((await h.send('status')).armed,true);
 await h.send('disarm');assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});

 test('Two channel captures keep independent sockets, recorders and stop controls',async()=>{
 const h=harness();await arm(h);await h.send('arm',{channelNumber:'2',streamId:'two',tabId:8,tabTitle:'Second tab',port:34500,reloadOnWatch:false});
 assert.equal(h.sockets.length,2);assert.equal(h.sockets[1].url,'ws://127.0.0.1:34500/source/2');
 for(const ws of h.sockets){ws.open();ws.message({type:'start',session:1});}
 assert.equal(h.recorders.length,2);await h.send('disarm',{channelNumber:'2'});
 assert.equal(h.recorders[0].state,'recording');assert.equal(h.recorders[1].state,'inactive');assert.equal((await h.send('status')).armed,true);
 });
 test('A tab cannot be assigned to two channels simultaneously',async()=>{
 const h=harness();await arm(h);const r=await h.send('arm',{channelNumber:'2',streamId:'two',tabId:7,port:34500});assert.match(r.error,/already assigned/);assert.equal(h.sockets.length,1);
 });

test('Reusable tab acknowledges navigation before starting capture and never reloads on viewer count',async()=>{
 const h=harness({workerReplies:{navigatePool:()=>({ok:true}),parkPool:()=>({ok:true})}});
 await h.send('arm',{channelNumber:'@1',streamId:'sid',tabId:7,tabUrl:'https://example.com/live',port:34500,reloadOnWatch:true});const ws=h.sockets[0];assert.match(ws.url,/\/slot\/1$/);ws.open();ws.message({type:'tune',token:9,url:'https://example.com/espn',channelName:'ESPN'});await tick();
 assert.ok(ws.json().some(m=>m.type==='tuned'&&m.token===9&&m.ok));assert.equal(h.recorders.length,0);ws.message({type:'start',session:1});ws.message({type:'viewers',count:1});assert.equal(h.recorders.length,1);assert.ok(!h.toWorker.some(m=>m.type==='reloadTab'));ws.message({type:'park'});await tick();assert.equal(h.recorders[0].state,'inactive');
});
test('Late navigation completion cannot acknowledge an obsolete tune',async()=>{
 let finish;const h=harness({workerReplies:{navigatePool:()=>new Promise(r=>finish=r),parkPool:()=>({ok:true})}});await h.send('arm',{channelNumber:'@1',streamId:'sid',tabId:7,tabUrl:'https://example.com/live',port:34500});const ws=h.sockets[0];ws.open();ws.message({type:'tune',token:1,url:'https://example.com/one',channelName:'One'});ws.message({type:'park'});finish({ok:true});await tick();assert.ok(!ws.json().some(m=>m.type==='tuned'));
});

test('A reusable tab with no known address refuses a channel switch straight away', async () => {
  const h = harness({workerReplies: {navigatePool: () => ({ok: true})}});
  await h.send('arm', {channelNumber: '@1', streamId: 'sid', tabId: 7, tabTitle: 'x', tabUrl: 'chrome://newtab/', port: 34500});
  const ws = h.sockets[0]; ws.open();
  ws.message({type: 'tune', token: 5, url: 'https://www.skygo.co.nz/live/2', channelName: 'Sky Sport 2'}); await tick();
  const reply = ws.json().find(m => m.type === 'tuned');
  assert.deepEqual([reply.token, reply.ok], [5, false]);
  assert.match(reply.error, /web address isn’t known/);
  assert.equal(h.toWorker.filter(m => m.type === 'navigatePool').length, 0);
});

test('The standby page is completely still, so idle captured tabs cost almost nothing', () => {
  const css = fs.readFileSync(new URL('../extension/standby.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../extension/standby.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../extension/standby.js', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /animation|@keyframes|transition/);
  assert.doesNotMatch(html, /\.gif|<video|<marquee/i);
  assert.doesNotMatch(js, /setInterval|requestAnimationFrame/);
  for (const page of ['../tuner/src/autostart.js']) assert.doesNotMatch(fs.readFileSync(new URL(page, import.meta.url), 'utf8'), /animation|@keyframes/);
});


test('Capture matches Sky: 50 frames a second by default, 25 when chosen', async () => {
  for (const [chosen, expected] of [[undefined, 50], [25, 25], [30, 50]]) {
    let constraints;
    const tracks = [new EventTarget(), new EventTarget()];
    for (const t of tracks) { t.readyState = 'live'; t.stop = () => {}; t.getSettings = () => ({width: 1920, height: 1080}); }
    const media = {getTracks: () => tracks, getAudioTracks: () => [tracks[1]], getVideoTracks: () => [tracks[0]]};
    const h = harness({getUserMedia: async c => { constraints = c; return media; }});
    await h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', port: 34500, ...(chosen ? {frameRate: chosen} : {})});
    assert.equal(constraints.video.mandatory.maxFrameRate, expected, `chosen ${chosen}`);
    h.sockets[0].open();
    const hello = h.sockets[0].json()[0];
    assert.deepEqual([hello.frameRate, hello.captureSize], [expected, '1920×1080']);
    assert.equal((await h.send('status')).sizeNote, '', 'a full-size tab needs no warning');
  }
});

test('A small or wide tab is pointed out, judged by the tab itself (Chrome pads the capture to 1920×1080)', async () => {
  for (const [w, h0, word, expect] of [[945, 955, 'small', '945×955'], [1920, 937, 'not TV-shaped', '1920×937'], [2560, 1249, 'not TV-shaped', '1920×937']]) {
    const tracks = [new EventTarget(), new EventTarget()];
    for (const t of tracks) { t.readyState = 'live'; t.stop = () => {}; t.getSettings = () => ({width: 1920, height: 1080}); }
    const h = harness({getUserMedia: async () => ({getTracks: () => tracks, getAudioTracks: () => [tracks[1]], getVideoTracks: () => [tracks[0]]})});
    await h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', port: 34500, tabWidth: w, tabHeight: h0});
    const status = await h.send('status');
    assert.equal(status.captureSize, expect);
    assert.match(status.sizeNote, new RegExp(`${expect} picture because this tab is ${word}`));
  }
  const tracks = [new EventTarget(), new EventTarget()];
  for (const t of tracks) { t.readyState = 'live'; t.stop = () => {}; t.getSettings = () => ({width: 1920, height: 1080}); }
  const h = harness({getUserMedia: async () => ({getTracks: () => tracks, getAudioTracks: () => [tracks[1]], getVideoTracks: () => [tracks[0]]})});
  await h.send('arm', {streamId: 'sid', tabId: 7, tabTitle: 'Sky Go', port: 34500, tabWidth: 1920, tabHeight: 1080});
  assert.equal((await h.send('status')).sizeNote, '', 'a full 1920×1080 tab: no warning');
});
