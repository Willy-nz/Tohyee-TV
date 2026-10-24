import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The warning function from the app's screen code, run on its own.
const src = fs.readFileSync(new URL('../desktop/renderer.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('function smoothnessWarning('));
const ctx = {}; vm.runInNewContext(fn, ctx);
const warn = s => ctx.smoothnessWarning(s);

test('No warning on a 50 Hz screen (or 100 Hz), or when Chrome captures the full rate', () => {
  assert.equal(warn({screenHz: 50}), '');
  assert.equal(warn({screenHz: 100}), '');
  assert.equal(warn({screenHz: 50, capture: {fps: 49.8, target: 50}}), '');
  assert.equal(warn({screenHz: 0}), ''); // unknown: say nothing
});

test('A 60 Hz screen gets a warning with the fix, even before anyone watches', () => {
  const text = warn({screenHz: 60});
  assert.match(text, /60 Hz/);
  assert.match(text, /50 Hz/);
  assert.match(text, /dummy display plug/);
});

test('Chrome capturing well below the channel (the no-monitor case) says so, with the number', () => {
  const text = warn({screenHz: 60, capture: {fps: 32.5, target: 50}});
  assert.match(text, /about 33 frames a second/);
  assert.match(text, /dummy display plug/);
  const busy = warn({screenHz: 50, capture: {fps: 30, target: 50}});
  assert.match(busy, /too busy/);
  assert.match(warn({screenHz: 60, capture: {fps: 30, target: 25}}), /doesn’t match|doesn't match/); // 25 doesn't divide 60 evenly
  assert.equal(warn({screenHz: 50, capture: {fps: 25, target: 25}}), '');
});

test('The extension measures and reports what Chrome captures; the tuner keeps it; the app shows it', () => {
  const rec = fs.readFileSync(new URL('../extension/recorder.js', import.meta.url), 'utf8');
  assert.match(rec, /onFrame\(frame\) \{\r?\n\s+this\.framesIn\+\+;/);
  const off = fs.readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');
  assert.match(off, /send\(\{type: 'status', captureFps:/);
  const source = fs.readFileSync(new URL('../tuner/src/source.js', import.meta.url), 'utf8');
  assert.match(source, /'captureFps'\]/);
  const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /displayFrequency/);
  assert.match(main, /case 'displaySettings':await shell\.openExternal\('ms-settings:display'\)/);
  const html = fs.readFileSync(new URL('../desktop/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="smoothBanner"'));
});
