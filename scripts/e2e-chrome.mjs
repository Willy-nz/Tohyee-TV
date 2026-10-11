// End-to-end check without Chrome: runs the real extension/offscreen.js
// against a running tuner. Only Chrome's tab capture and MediaRecorder are
// simulated — FFmpeg generates live WebM (VP8 + Opus) the way MediaRecorder
// would. Usage: node scripts/e2e-chrome.mjs [seconds] [port]
import vm from 'node:vm';
import fs from 'node:fs';
import {spawn} from 'node:child_process';

const seconds = Number(process.argv[2] ?? 30);
const port = Number(process.argv[3] ?? 34500);
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const code = fs.readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
const log = (...a) => console.log('[extension]', ...a);

class ChromeWebSocket extends WebSocket {
  constructor(url) { super(url, {headers: {Origin: 'chrome-extension://e2e-test'}}); }
}
class SimulatedRecorder {
  static isTypeSupported(type) { return type === 'video/webm;codecs=vp8,opus'; }
  constructor() { this.state = 'inactive'; }
  start(sliceMs) {
    this.state = 'recording';
    this.generator = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error',
      '-re', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-re', '-f', 'lavfi', '-i', 'sine=frequency=550:sample_rate=48000',
      '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '3M', '-c:a', 'libopus',
      '-f', 'webm', '-live', '1', '-cluster_time_limit', String(sliceMs), 'pipe:1'], {windowsHide: true});
    this.generator.stdout.on('data', d => this.ondataavailable?.({data: new Blob([d])}));
    this.generator.stderr.on('data', d => log('ffmpeg:', String(d).trim()));
    log('recorder started');
  }
  stop() { this.state = 'inactive'; this.generator?.kill(); log('recorder stopped'); }
}

let listener;
const track = new EventTarget(); track.stop = () => {};
const media = {getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [track]};
vm.runInNewContext(code, {
  chrome: {runtime: {
    id: 'e2e', getManifest: () => ({version: 'e2e'}),
    onMessage: {addListener(fn) { listener = fn; }},
    sendMessage: async m => {
      if (m.type !== 'badge') log('asks worker:', m.type);
      return m.type === 'reloadTab' ? {ok: true} : m.type === 'ensurePlaying' ? {playing: true} : m.type === 'pauseVideo' ? {paused: true} : undefined;
    }
  }},
  navigator: {mediaDevices: {getUserMedia: async () => media}},
  MediaRecorder: SimulatedRecorder, WebSocket: ChromeWebSocket, Blob,
  AudioContext: class { createMediaStreamSource() { return {connect() {}}; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } },
  setTimeout, clearTimeout, JSON, Number, Math, URL, Promise, Error
});
const send = (type, extra = {}) => new Promise(r => listener({target: 'offscreen', type, ...extra}, {id: 'e2e'}, r));

await send('arm', {streamId: 'e2e', tabId: 1, tabTitle: 'End-to-end test tab', port, reloadOnWatch: true});
const status = setInterval(async () => { const s = await send('status'); log(`${s.state}: ${s.message}`); }, 3000);
setTimeout(async () => {
  clearInterval(status);
  await send('disarm');
  setTimeout(() => process.exit(0), 300);
}, seconds * 1000);
