import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validate, DEFAULTS} from '../tuner/src/config.js';
import {autostartPlan, MAX_DEDICATED_TABS} from '../tuner/src/autostart.js';

const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../desktop/sky-channels.js', import.meta.url), 'utf8'), {window});
const sky = window.SKY_GO_CHANNELS;

test('The Sky Go list has all 61 live channels, with unique numbers, addresses and guide matches', () => {
  assert.equal(sky.length, 61);
  for (const key of ['channelNumber', 'url', 'guideId']) assert.equal(new Set(sky.map(c => c[key])).size, 61, key);
  for (const c of sky) assert.match(c.url, /^https:\/\/www\.skygo\.co\.nz\/watch-tv\/[A-Z0-9]{4}$/, c.channelName);
  const byName = Object.fromEntries(sky.map(c => [c.channelName, c]));
  assert.deepEqual([byName['Sky Sport 5'].url, byName['Sky Sport 6'].url], ['https://www.skygo.co.nz/watch-tv/0002', 'https://www.skygo.co.nz/watch-tv/0003']);
  assert.equal(byName['Sky Sport Premier League'].guideId, 'skysport8');
});

test('Saving the whole list passes the app’s channel checks, in reusable-tab mode', () => {
  const channels = sky.map(c => ({...c, programmeTitle: c.channelName}));
  assert.deepEqual(validate({...DEFAULTS, deviceId: '1234ABCD', captureMode: 'pool', tabCount: 3, channels}), []);
});

test('Starting by itself never opens a tab for each of a long list', () => {
  const channels = sky.map(c => ({...c, programmeTitle: c.channelName}));
  const dedicated = autostartPlan({channels});
  assert.deepEqual(dedicated.items, []);
  assert.match(dedicated.message, /Reusable tabs/);
  assert.equal(autostartPlan({channels: channels.slice(0, MAX_DEDICATED_TABS)}).items.length, MAX_DEDICATED_TABS);
  assert.deepEqual(autostartPlan({channels, captureMode: 'pool', tabCount: 3}).items.map(i => i.url), Array(3).fill('https://www.skygo.co.nz/'));
});

test('The app loads the list and offers the button', () => {
  const html = fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('sky-channels.js') < html.indexOf('renderer.js'), 'list loads before the page script');
  assert.match(html, /id="addSkyChannels"/);
});
