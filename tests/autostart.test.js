import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {autostartPlan, autostartPage} from '../tuner/src/autostart.js';
const require = createRequire(import.meta.url);
const {EXTENSION_ID, findChrome, chromeArgs, launchChrome} = require('../desktop/autostart.cjs');

const channels = [
  {channelNumber: '1', channelName: 'Sky Sport 1', programmeTitle: 'x', url: 'https://www.skygo.co.nz/live/1'},
  {channelNumber: '2', channelName: 'No link', programmeTitle: 'x'},
  {channelNumber: '3', channelName: 'Sky Sport 3', programmeTitle: 'x', url: 'https://www.skygo.co.nz/live/3'}
];

test('Dedicated tabs: one tab per channel that has a video page address', () => {
  const plan = autostartPlan({channels});
  assert.deepEqual(plan.items.map(i => [i.channelNumber, i.url]), [['1', 'https://www.skygo.co.nz/live/1'], ['3', 'https://www.skygo.co.nz/live/3']]);
});

test('Reusable tabs open on the website’s front page, so no player (or stream) is used until Plex tunes', () => {
  const plan = autostartPlan({channels, captureMode: 'pool', tabCount: 3});
  assert.deepEqual(plan.items, [1, 2, 3].map(n => ({channelNumber: `@${n}`, label: `Reusable tab ${n}`, url: 'https://www.skygo.co.nz/'})));
});

test('No addresses: nothing to open, and it says why', () => {
  const plan = autostartPlan({channels: [channels[1]]});
  assert.deepEqual(plan.items, []);
  assert.match(plan.message, /video page address/);
});

test('The starting page has a log for the extension, and a setup version', () => {
  assert.match(autostartPage(), /id="log"/);
  assert.match(autostartPage(true), /Load unpacked/);
});

test('The extension’s fixed ID matches its key, and the app allowlists exactly that ID', () => {
  const crypto = require('node:crypto');
  const {key} = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const id = [...crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)].map(x => String.fromCharCode(97 + parseInt(x, 16))).join('');
  assert.equal(id, EXTENSION_ID);
  const args = chromeArgs({profile: 'C:\\Users\\Jess\\AppData\\Roaming\\Tohyee TV\\chrome-profile', port: 34500});
  assert.ok(args.includes(`--allowlisted-extension-id=${EXTENSION_ID}`));
  assert.ok(args.includes('--user-data-dir=C:\\Users\\Jess\\AppData\\Roaming\\Tohyee TV\\chrome-profile'), 'its own profile, not the person’s usual Chrome');
  assert.equal(args.at(-1), 'http://127.0.0.1:34500/autostart');
  assert.equal(chromeArgs({profile: 'p', port: 34500, setup: true}).at(-1), 'http://127.0.0.1:34500/autostart?setup=1');
});

test('Chrome is found in the usual Windows places, and a missing Chrome is reported', () => {
  const env = {PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\J\\AppData\\Local'};
  const want = require('node:path').join('C:\\Users\\J\\AppData\\Local', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {value: 'win32'});
  try { assert.equal(findChrome({env, exists: p => p === want}), want); assert.equal(findChrome({env, exists: () => false}), null); }
  finally { Object.defineProperty(process, 'platform', original); }
  assert.match(launchChrome({profile: 'x', port: 1, chrome: null}).error, /wasn’t found/);
  const calls = [];
  const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'tohyee-chrome-'));
  assert.ok(launchChrome({profile: dir, port: 34500, chrome: 'chrome.exe', spawnFn: (cmd, args, opts) => { calls.push({cmd, args, opts}); return {on() {}, unref() {}}; }}).ok);
  assert.equal(calls[0].cmd, 'chrome.exe'); assert.equal(calls[0].opts.detached, true);
});

test('The app offers the setting, opens Chrome at start-up, and again after unlocking or waking', () => {
  const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  for (const action of ['autoBroadcast', 'chromeSetup', 'chromeStart']) assert.match(main, new RegExp(`case '${action}'`));
  assert.match(main, /if\(prefs\.autoBroadcast&&runtime\)setTimeout\(\(\)=>openChromeWindow\(false\),3000\)/);
  assert.match(main, /\['unlock-screen','resume'\]/);
  const html = fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="autoBroadcast"/);
  assert.match(fs.readFileSync(new URL('../extension/worker.js', import.meta.url), 'utf8'), /importScripts\('autostart\.js'\)/);
});
