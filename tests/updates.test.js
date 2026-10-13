import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const {compareVersions, pickUpdate, checkForUpdate, isReleasePage} = require('../desktop/updates.cjs');

const rel = (tag, extra = {}) => ({
  tag_name: tag, name: `Tohyee TV ${tag.slice(1)}`, draft: false, prerelease: /-/.test(tag),
  html_url: `https://github.com/Willy-nz/Tohyee-TV/releases/tag/${tag}`,
  assets: [{name: `Tohyee-TV-Setup-${tag.slice(1)}.exe`}, {name: 'SHA256SUMS.txt'}], ...extra
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
  assert.deepEqual(u, {version: '0.7.0', name: 'Tohyee TV 0.7.0', url: 'https://github.com/Willy-nz/Tohyee-TV/releases/tag/v0.7.0', prerelease: false});
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
  for (const action of ['checkUpdates', 'openUpdate', 'updateChecks', 'testBuilds', 'dismissUpgrade']) assert.match(main, new RegExp(`case '${action}'`));
  assert.match(main, /setTimeout\(\(\)=>checkUpdates\(\),10000\)/, 'checks shortly after starting');
  assert.match(main, /setInterval\(\(\)=>checkUpdates\(\),DAY\)/, 'and once a day');
  assert.match(main, /prefs\.lastNotifiedVersion!==result\.update\.version/, 'notifies once per new version');
  const html = fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8');
  for (const id of ['updateBanner', 'upgradeBanner', 'updateChecks', 'testBuilds', 'updateStatus']) assert.match(html, new RegExp(`id="${id}"`));
  const pkg = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('*.cjs'), 'updates.cjs is packaged');
});
