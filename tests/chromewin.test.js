import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import {startRuntime} from '../tuner/src/runtime.js';
const require = createRequire(import.meta.url);
const {windowScript, setChromeWindow, StallWatch} = require('../desktop/chromewin.cjs');

const PROFILE = String.raw`C:\Users\Will's\AppData\Roaming\Tohyee TV\chrome-profile`;

test('The window script only touches Chrome windows using Tohyee TV’s profile, and quotes the folder safely', () => {
  const hide = windowScript({profile: PROFILE, action: 'hide'});
  assert.match(hide, /\$tohyeeProfile = 'C:\\Users\\Will''s\\AppData\\Roaming\\Tohyee TV\\chrome-profile'/);
  assert.match(hide, /Contains\('--user-data-dir=' \+ \$tohyeeProfile\)/);
  assert.match(hide, /Chrome_WidgetWin_1/);
  assert.match(hide, /::Apply\(\[uint32\[\]\]\$pids, 6\)/); // SW_MINIMIZE
  assert.match(windowScript({profile: PROFILE, action: 'show'}), /::Apply\(\[uint32\[\]\]\$pids, 9\)/); // SW_RESTORE
  assert.doesNotMatch(hide, /HashSet/); // not available to Windows PowerShell 5.1's compiler by default
  assert.throws(() => windowScript({profile: PROFILE, action: 'close'}));
  assert.throws(() => windowScript({profile: 'C:\\x\nWrite-Host hi', action: 'hide'}));
  assert.throws(() => windowScript({profile: '', action: 'hide'}));
});

test('Windows’ answer is read back; failures and other systems are reported, not thrown', async () => {
  let ran;
  const ok = await setChromeWindow('hide', {profile: PROFILE, platform: 'win32', execFileFn: (file, args, opts, cb) => { ran = {file, args, opts}; cb(null, 'noise\r\n{"count":1}\r\n', ''); }});
  assert.deepEqual(ok, {count: 1});
  assert.equal(ran.file, 'powershell.exe');
  assert.equal(ran.opts.windowsHide, true);
  assert.equal(Buffer.from(ran.args.at(-1), 'base64').toString('utf16le'), windowScript({profile: PROFILE, action: 'hide'}));
  assert.deepEqual(await setChromeWindow('hide', {profile: PROFILE, platform: 'win32', execFileFn: (f, a, o, cb) => cb(Object.assign(new Error('x'), {code: 'ENOENT'}), '', '')}), {error: 'PowerShell was not found'});
  assert.deepEqual(await setChromeWindow('hide', {profile: PROFILE, platform: 'linux'}), {error: 'Only on Windows'});
  assert.deepEqual(await setChromeWindow('wiggle', {profile: PROFILE, platform: 'win32', execFileFn: () => assert.fail('should not run')}), {error: 'Unknown window action'});
});

test('A watched channel whose bytes stop is reported after the limit; unwatched or flowing ones never are', () => {
  const w = new StallWatch({limitMs: 30000});
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 0}, {key: 'tab 2', viewers: 0, bytes: 0}], 0), []);
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 0}, {key: 'tab 2', viewers: 0, bytes: 0}], 29000), []);
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 0}, {key: 'tab 2', viewers: 0, bytes: 0}], 30000), ['tab 1']);
  // Bytes moving again resets the clock.
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 500}], 31000), []);
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 900}], 70000), []);
  // A viewer leaving and coming back starts afresh.
  w.check([], 71000);
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 900}], 72000), []);
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 900}], 101000), []);
  assert.deepEqual(w.check([{key: 'tab 1', viewers: 1, bytes: 900}], 102000), ['tab 1']);
});

const get = (port, path) => new Promise((resolve, reject) => http.get({host: '127.0.0.1', port, path}, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject));

test('The tuner records when the extension has finished starting channels, and reports what each watched tab has sent', async () => {
  const config = {port: 0, listenAddress: '127.0.0.1', deviceId: '1234ABCD', captureMode: 'pool', tabCount: 2, channels: [{channelNumber: '1', channelName: 'One', programmeTitle: 'x', url: 'https://example.com/1'}]};
  const runtime = await startRuntime({config, ffmpeg: 'ffmpeg'});
  try {
    const port = runtime.server.address().port;
    assert.equal(runtime.autostartDone(), null);
    assert.equal(await get(port, '/autostart/done?started=2&total=3'), 204);
    const done = runtime.autostartDone();
    assert.deepEqual({started: done.started, total: done.total}, {started: 2, total: 3});
    assert.ok(Date.now() - done.at < 5000);
    assert.equal(await get(port, '/autostart/done?started=-5&total=abc'), 204);
    assert.deepEqual({started: runtime.autostartDone().started, total: runtime.autostartDone().total}, {started: 0, total: 0});
    assert.deepEqual(runtime.flow(), []); // no tab leased yet
    const slot = runtime.pool.slots[0];
    slot.lease = {viewers: 1}; slot.hub.receivedBytes = 1234;
    assert.deepEqual(runtime.flow(), [{key: 'tab 1', viewers: 1, bytes: 1234}]);
    slot.lease = null;
  } finally { await runtime.close(); }
});

test('Dedicated tabs report flow per channel', async () => {
  const config = {port: 0, listenAddress: '127.0.0.1', deviceId: '1234ABCD', channels: [{channelNumber: '7', channelName: 'Seven', programmeTitle: 'x'}]};
  const runtime = await startRuntime({config, ffmpeg: 'ffmpeg'});
  try { assert.deepEqual(runtime.flow(), [{key: 'channel 7', viewers: 0, bytes: 0}]); } finally { await runtime.close(); }
});

test('The app hides Chrome after the channels start, watches for a stopped picture, and offers the setting and buttons', () => {
  const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /if\(!setup\)afterChannelsStart\(Date\.now\(\)\)/);
  assert.match(main, /prefs\.hideChrome!==false\)await hideChrome\(\);else show\(\)/);
  assert.match(main, /prefs\.hideChrome=false;savePrefs\(\)/); // a stopped picture turns hiding off for good
  assert.match(main, /case 'showChrome'/);
  assert.match(main, /case 'hideChromeNow'/);
  const html = fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8');
  for (const id of ['id="hideChrome"', 'data-action="showChrome"', 'data-action="hideChromeNow"', 'id="extensionBanner"']) assert.ok(html.includes(id), id);
  const renderer = fs.readFileSync(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /action\('hideChrome',\$\('hideChrome'\)\.checked\)/);
});

test('The extension tells the tuner when it has finished, and setting up opens its chrome://extensions page', () => {
  const src = fs.readFileSync(new URL('../extension/autostart.js', import.meta.url), 'utf8');
  assert.match(src, /\/autostart\/done\?started=\$\{started\}&total=\$\{plan\.items\.length\}/);
  assert.match(src, /chrome:\/\/extensions\/\?id=\$\{chrome\.runtime\.id\}/);
});

test('The extension’s version matches the app’s, so the app can spot an old copy still running in Chrome', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const app = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, app.version.replace(/-.*/, ''));
});
