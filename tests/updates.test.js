import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions, findNewerRelease, checkForUpdate} from '../firefox-prototype/updates.js';
import {isBlackFrame, BlackFrameMonitor} from '../firefox-prototype/blackframe.js';
const repo = 'Willy-nz/tohyee-tv';
const rel = (tag, extra = {}) => ({tag_name: tag, name: tag, html_url: `https://github.com/${repo}/releases/tag/${tag}`, draft: false, ...extra});

test('Version ordering follows semver including prereleases', () => {
  const ordered = ['0.1.0-alpha.1', '0.1.0-alpha.2', '0.1.0-alpha.10', '0.1.0-beta.1', '0.1.0', '0.1.1', '0.2.0', '1.0.0'];
  for (let i = 1; i < ordered.length; i++) assert.ok(compareVersions(ordered[i - 1], ordered[i]) < 0, ordered[i]);
  assert.equal(compareVersions('v0.1.0-alpha.2', '0.1.0-alpha.2'), 0);
});
test('Finds the newest newer release and ignores drafts, older and odd entries', () => {
  const found = findNewerRelease([rel('v0.1.0-alpha.1'), rel('v0.1.0-alpha.3'), rel('v0.2.0', {draft: true}),
    rel('nightly'), rel('v0.1.0-alpha.4', {html_url: 'https://evil.example/x'}), rel('v0.1.0-alpha.2')], '0.1.0-alpha.2', repo);
  assert.equal(found.tag, 'v0.1.0-alpha.3');
});
test('No update when already newest', () => {
  assert.equal(findNewerRelease([rel('v0.1.0-alpha.1'), rel('v0.1.0-alpha.2')], '0.1.0-alpha.2', repo), null);
  assert.equal(findNewerRelease({message: 'Not Found'}, '0.1.0', repo), null);
});
test('checkForUpdate reports update, current, rate limit and network failure', async () => {
  const ok = body => async () => ({ok: true, status: 200, json: async () => body});
  assert.equal((await checkForUpdate({current: '0.1.0-alpha.2', repo, fetchFn: ok([rel('v0.1.0-alpha.3')])})).status, 'update');
  assert.equal((await checkForUpdate({current: '0.1.0-alpha.2', repo, fetchFn: ok([])})).status, 'current');
  const limited = await checkForUpdate({current: '0.1.0', repo, fetchFn: async () => ({ok: false, status: 403})});
  assert.match(limited.message, /limiting/);
  const offline = await checkForUpdate({current: '0.1.0', repo, fetchFn: async () => { throw new TypeError('fail'); }});
  assert.equal(offline.status, 'error');
});
test('checkForUpdate gives up after the timeout', async () => {
  const hang = (url, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), {name: 'AbortError'}))));
  const result = await checkForUpdate({current: '0.1.0', repo, fetchFn: hang, timeoutMs: 20});
  assert.match(result.message, /too long/);
});
test('Black frame detection needs several black samples in a row', () => {
  const black = new Uint8ClampedArray(64).fill(0); for (let i = 3; i < 64; i += 4) black[i] = 255;
  const picture = black.slice(); picture[8] = 200;
  assert.equal(isBlackFrame(black), true);
  assert.equal(isBlackFrame(picture), false);
  const m = new BlackFrameMonitor(3);
  assert.equal(m.add(true), false); assert.equal(m.add(true), false); assert.equal(m.add(false), false);
  m.add(true); m.add(true); assert.equal(m.add(true), true);
});
