import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const display = require('../desktop/display.cjs');
const {chromeArgs} = require('../desktop/autostart.cjs');

test('Only a screen smaller than 1920×1080 needs fixing; bigger ones are left alone', () => {
  assert.equal(display.needsFix({width: 1280, height: 720}), true);
  assert.equal(display.needsFix({width: 1920, height: 1080}), false);
  assert.equal(display.needsFix({width: 2560, height: 1440}), false);
  assert.equal(display.needsFix({width: 1920, height: 1050}), true);
  assert.equal(display.needsFix({width: 0, height: 0}), false, 'no answer from Windows: do nothing');
  assert.deepEqual(display.physicalSize({size: {width: 1280, height: 720}, scaleFactor: 1.5}), {width: 1920, height: 1080}, 'scaled sizes are converted to real pixels');
});

test('The Windows script only raises the size, tests it first, keeps it after a restart, and refuses odd sizes', () => {
  const s = display.powershellScript({width: 1920, height: 1080});
  assert.match(s, /if \(d\.dmPelsWidth >= w && d\.dmPelsHeight >= h\) return .*already/);
  assert.match(s, /if \(!Offered\(w, h\)\) return .*unsupported/);
  assert.match(s, /ChangeDisplaySettings\(ref d, 2\); \/\/ CDS_TEST/);
  assert.match(s, /ChangeDisplaySettings\(ref d, 1\) : test; \/\/ CDS_UPDATEREGISTRY/);
  assert.match(s, /\[TohyeeDisplay\]::Set\(1920, 1080\)\s*$/);
  assert.throws(() => display.powershellScript({width: '1920; Remove-Item', height: 1080}), /Unsupported/);
  assert.throws(() => display.powershellScript({width: 100000, height: 1080}), /Unsupported/);
});

test('Windows’ answer is read back and described plainly', async () => {
  const fake = (stdout, stderr = '', error = null) => ({execFileFn: (cmd, args, opts, cb) => { assert.equal(cmd, 'powershell.exe'); assert.ok(args.includes('-EncodedCommand')); assert.equal(opts.windowsHide, true); cb(error, stdout, stderr); }, platform: 'win32'});
  const changed = await display.setResolution(undefined, fake('noise\r\n{"before":"1280x720","after":"1920x1080","result":"changed"}\r\n'));
  assert.equal(display.describe(changed), 'Screen set to 1920×1080 (was 1280×720).');
  assert.match(display.describe(await display.setResolution(undefined, fake('{"before":"1280x720","after":"1280x720","result":"unsupported"}'))), /dummy display plug/);
  assert.match(display.describe(await display.setResolution(undefined, fake('{"before":"1280x720","after":"1280x720","result":"failed:-2"}'))), /didn’t accept 1920×1080 \(code -2\)/);
  const broken = await display.setResolution(undefined, fake('', 'Exception calling "Set" with "2" argument(s): "Access is denied."', new Error('Command failed: powershell.exe -EncodedCommand AAAA')));
  assert.equal(display.describe(broken), 'Couldn’t change the screen size: Access is denied..');
  assert.equal((await display.setResolution(undefined, {platform: 'linux', execFileFn: () => assert.fail('never runs')})).result, 'unsupported');
});

test('The encoded command decodes back to exactly the script', () => {
  const s = display.powershellScript({width: 1920, height: 1080});
  assert.equal(Buffer.from(Buffer.from(s, 'utf16le').toString('base64'), 'base64').toString('utf16le'), s);
});

test('The app offers the setting and checks at start-up, on screen changes, after unlock and every 5 minutes; Chrome opens as a full-screen kiosk', () => {
  const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  for (const action of ['fixScreen', 'fixScreenNow']) assert.match(main, new RegExp(`case '${action}'`));
  assert.match(main, /if\(!prefs\.fixScreen\|\|process\.platform!=='win32'\)return null;/, 'off unless ticked');
  assert.match(main, /Date\.now\(\)-lastScreenFix<10\*60\*1000/, 'never fights a remote-desktop app');
  assert.match(main, /'display-metrics-changed','display-added','display-removed'/);
  assert.match(main, /await checkScreen\(\)\.catch\(\(\)=>\{\}\);\n\s*if\(prefs\.autoBroadcast&&runtime\)setTimeout/, 'fixed before Chrome opens');
  assert.match(fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8'), /id="fixScreen"/);
  const args = chromeArgs({profile: 'p', port: 34500});
  assert.ok(args.includes('--kiosk'), 'channels fill the screen');
  assert.ok(!chromeArgs({profile: 'p', port: 34500, setup: true}).includes('--kiosk'), 'setting up needs the address bar');
  assert.equal(args.at(-1), 'http://127.0.0.1:34500/autostart');
});
