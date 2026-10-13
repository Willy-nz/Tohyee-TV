import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {compareVersions, pickUpdate, checkForUpdate, isReleasePage, checksumFor, downloadUpdate, INSTALL_ARGS} = require('../desktop/updates.cjs');
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const rel = (tag, extra = {}) => ({
  tag_name: tag, name: `Tohyee TV ${tag.slice(1)}`, draft: false, prerelease: /-/.test(tag),
  html_url: `https://github.com/Willy-nz/Tohyee-TV/releases/tag/${tag}`,
  assets: [
    {name: `Tohyee-TV-Setup-${tag.slice(1)}.exe`, size: 1000, browser_download_url: `https://github.com/Willy-nz/Tohyee-TV/releases/download/${tag}/Tohyee-TV-Setup-${tag.slice(1)}.exe`},
    {name: 'SHA256SUMS.txt', browser_download_url: `https://github.com/Willy-nz/Tohyee-TV/releases/download/${tag}/SHA256SUMS.txt`}
  ], ...extra
});

test('Versions are ordered properly, test builds before the full release', () => {
  const order = ['0.5.0', '0.6.0-alpha.1', '0.6.0', '0.6.1-alpha.1', '0.6.1-alpha.2', '0.6.1-alpha.10', '0.6.1', '0.7.0', '1.0.0'];
  for (let i = 1; i < order.length; i++) assert.ok(compareVersions(order[i - 1], order[i]) < 0, `${order[i - 1]} < ${order[i]}`);
  assert.equal(compareVersions('v0.6.0', '0.6.0'), 0);
});

test('Only full releases count, unless test builds are switched on', () => {
  const list = [rel('v0.6.0'), rel('v0.6.1-alpha.1'), rel('v0.5.0')];
  assert.equal(pickUpdate(list, '0.6.0'), null, 'a test build is not offered by default');
  assert.equal(pickUpdate(list, '0.6.0', {includeTest: true}).version, '0.6.1-alpha.1');
  assert.equal(pickUpdate([...list, rel('v0.6.1')], '0.6.0').version, '0.6.1');
});

test('Someone on a test build is offered the full release of that version', () => {
  assert.equal(pickUpdate([rel('v0.6.1'), rel('v0.6.1-alpha.1')], '0.6.1-alpha.1').version, '0.6.1');
});

test('Releases without a Windows installer, drafts, odd tags and outside links are ignored', () => {
  const list = [
    rel('v0.9.0', {assets: [{name: 'Tohyee-TV-Tuner-0.9.0.zip'}]}),
    rel('v0.9.1', {draft: true}),
    rel('nightly'),
    rel('v0.9.2', {html_url: 'https://evil.example/download'}),
    rel('v0.6.0')
  ];
  assert.equal(pickUpdate(list, '0.6.0'), null);
  assert.equal(pickUpdate({message: 'Not Found'}, '0.6.0'), null);
});

test('The newest qualifying release wins, with its page and name', () => {
  const u = pickUpdate([rel('v0.6.2'), rel('v0.7.0'), rel('v0.6.1')], '0.6.0');
  assert.deepEqual(u, {version: '0.7.0', name: 'Tohyee TV 0.7.0', url: 'https://github.com/Willy-nz/Tohyee-TV/releases/tag/v0.7.0', prerelease: false,
    installer: {name: 'Tohyee-TV-Setup-0.7.0.exe', url: 'https://github.com/Willy-nz/Tohyee-TV/releases/download/v0.7.0/Tohyee-TV-Setup-0.7.0.exe', size: 1000,
      sums: 'https://github.com/Willy-nz/Tohyee-TV/releases/download/v0.7.0/SHA256SUMS.txt'}});
});

test('Checking reports available, up to date, rate limits and connection problems', async () => {
  const ok = body => async () => ({ok: true, status: 200, json: async () => body});
  assert.equal((await checkForUpdate({current: '0.6.0', fetchFn: ok([rel('v0.6.1')])})).status, 'available');
  assert.equal((await checkForUpdate({current: '0.6.1', fetchFn: ok([rel('v0.6.1')])})).status, 'current');
  assert.match((await checkForUpdate({current: '0.6.0', fetchFn: async () => ({ok: false, status: 403})})).message, /limiting/);
  assert.match((await checkForUpdate({current: '0.6.0', fetchFn: async () => { throw new TypeError('offline'); }})).message, /Couldn’t reach GitHub/);
  const hang = (url, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), {name: 'AbortError'}))));
  assert.match((await checkForUpdate({current: '0.6.0', fetchFn: hang, timeoutMs: 20})).message, /too long/);
});

test('The check sends no personal details: one GET to the public release list', async () => {
  const calls = [];
  await checkForUpdate({current: '0.6.0', fetchFn: async (url, options) => { calls.push({url, options}); return {ok: true, status: 200, json: async () => []}; }});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/Willy-nz/Tohyee-TV/releases?per_page=30');
  assert.equal(calls[0].options.method, undefined, 'a plain GET');
  assert.equal(calls[0].options.body, undefined);
});

test('Only this project’s release pages can be opened', () => {
  assert.ok(isReleasePage('https://github.com/Willy-nz/Tohyee-TV/releases/tag/v0.6.1'));
  assert.ok(!isReleasePage('https://github.com/someone-else/x/releases/tag/v1'));
  assert.ok(!isReleasePage('file:///C:/Windows/system32/calc.exe'));
});

test('The app wires up the checker, its settings and the upgrade reminder', () => {
  const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  for (const action of ['checkUpdates', 'openUpdate', 'installUpdate', 'updateChecks', 'testBuilds', 'dismissUpgrade']) assert.match(main, new RegExp(`case '${action}'`));
  assert.match(main, /setTimeout\(\(\)=>checkUpdates\(\),10000\)/, 'checks shortly after starting');
  assert.match(main, /setInterval\(\(\)=>checkUpdates\(\),DAY\)/, 'and once a day');
  assert.match(main, /prefs\.lastNotifiedVersion!==result\.update\.version/, 'notifies once per new version');
  const html = fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8');
  for (const id of ['updateBanner', 'installUpdate', 'updateNote', 'upgradeBanner', 'updateChecks', 'testBuilds', 'updateStatus']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(main, /spawn\(file,updates\.INSTALL_ARGS,\{detached:true/, 'runs the checked installer, detached so it outlives the app');
  assert.match(main, /prefs\.testBuilds\?\?\/-\/\.test\(app\.getVersion\(\)\)/, 'test-build users get newer test builds by default');
  const pkg = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('*.cjs'), 'updates.cjs is packaged');
});

// ---- Update now: download, verify, install ----
const dl = 'https://github.com/Willy-nz/Tohyee-TV/releases/download/v0.7.0/';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tohyee-update-'));
const body = Buffer.alloc(300000, 7);
const sha = crypto.createHash('sha256').update(body).digest('hex');
const serve = (files, seen = []) => async url => {
  seen.push(url);
  if (!(url in files)) return {ok: false, status: 404};
  const data = files[url];
  if (typeof data === 'string') return {ok: true, status: 200, text: async () => data};
  async function* chunks() { for (let i = 0; i < data.length; i += 65536) yield new Uint8Array(data.subarray(i, i + 65536)); }
  return {ok: true, status: 200, headers: {get: h => h === 'content-length' ? String(data.length) : null}, body: chunks()};
};
const upd = () => pickUpdate([rel('v0.7.0')], '0.6.0');

test('The checksum file is read as CI writes it (CRLF lines, "hash  name")', () => {
  const text = `${'a'.repeat(64)}  Tohyee-TV-Setup-0.7.0.exe\r\n${'b'.repeat(64)}  Other.exe\r\n`;
  assert.equal(checksumFor(text, 'Tohyee-TV-Setup-0.7.0.exe'), 'a'.repeat(64));
  assert.equal(checksumFor(text, 'Missing.exe'), null);
  assert.equal(checksumFor(`﻿${'C'.repeat(64)} *X.exe`, 'X.exe'), 'c'.repeat(64));
});

test('Update now downloads the installer, checks it, and reports progress', async () => {
  const dir = tmp(); const progress = [];
  const file = await downloadUpdate({update: upd(), dir, onProgress: (r, t) => progress.push([r, t]),
    fetchFn: serve({[dl + 'SHA256SUMS.txt']: `${sha}  Tohyee-TV-Setup-0.7.0.exe\r\n`, [dl + 'Tohyee-TV-Setup-0.7.0.exe']: body})});
  assert.equal(path.basename(file), 'Tohyee-TV-Setup-0.7.0.exe');
  assert.ok(fs.readFileSync(file).equals(body));
  assert.deepEqual(progress.at(-1), [body.length, body.length]);
  assert.ok(progress.length > 1, 'progress while downloading');
  assert.deepEqual(fs.readdirSync(dir), ['Tohyee-TV-Setup-0.7.0.exe'], 'no partial file left');
});

test('A wrong or missing checksum means nothing is installed or left behind', async () => {
  for (const sums of [`${'0'.repeat(64)}  Tohyee-TV-Setup-0.7.0.exe\r\n`, `${sha}  Something-else.exe\r\n`]) {
    const dir = tmp();
    await assert.rejects(downloadUpdate({update: upd(), dir, fetchFn: serve({[dl + 'SHA256SUMS.txt']: sums, [dl + 'Tohyee-TV-Setup-0.7.0.exe']: body})}), /checksum/);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
  await assert.rejects(downloadUpdate({update: upd(), dir: tmp(), fetchFn: serve({})}), /error \(404\)/);
  await assert.rejects(downloadUpdate({update: upd(), dir: tmp(), fetchFn: async () => { throw new TypeError('fetch failed'); }}), /internet connection/);
});

test('Only this project’s own release downloads are fetched', async () => {
  const outside = rel('v0.7.0'); outside.assets[0].browser_download_url = 'https://evil.example/Tohyee-TV-Setup-0.7.0.exe';
  const u = pickUpdate([outside], '0.6.0');
  assert.equal(u.version, '0.7.0', 'still offered, so the release page can be opened');
  assert.equal(u.installer, undefined, 'but not installable from the app');
  const seen = [];
  await assert.rejects(downloadUpdate({update: u, dir: tmp(), fetchFn: serve({}, seen)}), /release page/);
  const sneaky = upd(); sneaky.installer.name = '..\\evil.exe';
  await assert.rejects(downloadUpdate({update: sneaky, dir: tmp(), fetchFn: serve({}, seen)}), /release page/);
  assert.deepEqual(seen, [], 'nothing was requested');
});

test('The installer runs silently, keeps the install folder and reopens the app', () => {
  assert.deepEqual(INSTALL_ARGS, ['/S', '--updated', '--force-run']);
});
