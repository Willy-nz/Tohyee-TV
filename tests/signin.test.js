import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {startRuntime} from '../tuner/src/runtime.js';
import {signInRequestAllowed, EXTENSION_ORIGIN} from '../tuner/src/server.js';
const require = createRequire(import.meta.url);
const {SignInStore} = require('../desktop/signin.cjs');

// Stands in for Electron's safeStorage (Windows' DPAPI): reversible, but not plain text.
const fakeSafe = {isEncryptionAvailable: () => true, encryptString: s => Buffer.from([...Buffer.from(s)].map(b => b ^ 0x5a)), decryptString: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString()};

test('The extension ID in the tuner matches the extension’s key', async () => {
  const {createHash} = await import('node:crypto');
  const key = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url))).key;
  const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  assert.equal(EXTENSION_ORIGIN, `chrome-extension://${id}`);
});

test('Saved sign-ins are encrypted on disk, and the app window never gets the password back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohyee-signin-'));
  try {
    const file = path.join(dir, 'signin.json');
    const store = new SignInStore({file, safeStorage: fakeSafe});
    assert.throws(() => store.save({site: 'https://evil.example', email: 'a@b.c', password: 'x'}), /only sign in to Sky Go/);
    assert.throws(() => store.save({site: 'https://www.skygo.co.nz', email: '', password: 'x'}), /email/);
    store.save({site: 'https://www.skygo.co.nz', email: ' me@example.com ', password: 'Secret pass 1'});
    assert.ok(!fs.readFileSync(file, 'utf8').includes('Secret pass 1'));
    assert.deepEqual(new SignInStore({file, safeStorage: fakeSafe}).get('https://www.skygo.co.nz'), {email: 'me@example.com', password: 'Secret pass 1'});
    const listed = store.list();
    assert.equal(listed[0].email, 'me@example.com');
    assert.ok(!JSON.stringify(listed).includes('Secret'));
    assert.equal(store.get('https://other.example'), null);
    store.remove('https://www.skygo.co.nz');
    assert.equal(store.get('https://www.skygo.co.nz'), null);
    assert.throws(() => new SignInStore({file, safeStorage: {...fakeSafe, isEncryptionAvailable: () => false}}).save({site: 'https://www.skygo.co.nz', email: 'a@b.c', password: 'x'}), /encrypt/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('Only the extension on this computer may ask for a saved sign-in', () => {
  const req = (over = {}) => ({socket: {remoteAddress: '127.0.0.1'}, headers: {host: '127.0.0.1:5004', 'x-tohyee-extension': '1', origin: EXTENSION_ORIGIN}, ...over});
  assert.equal(signInRequestAllowed(req(), 5004), true);
  assert.equal(signInRequestAllowed(req({headers: {host: '127.0.0.1:5004', 'x-tohyee-extension': '1'}}), 5004), true); // no Origin header
  assert.equal(signInRequestAllowed(req({socket: {remoteAddress: '192.168.1.20'}}), 5004), false); // another computer
  assert.equal(signInRequestAllowed(req({headers: {host: 'evil.example:5004', 'x-tohyee-extension': '1'}}), 5004), false); // a website's name pointing here
  assert.equal(signInRequestAllowed(req({headers: {host: '127.0.0.1:5004', origin: EXTENSION_ORIGIN}}), 5004), false); // no header
  assert.equal(signInRequestAllowed(req({headers: {host: '127.0.0.1:5004', 'x-tohyee-extension': '1', origin: 'https://evil.example'}}), 5004), false); // a web page
  assert.equal(signInRequestAllowed(req({headers: {host: '127.0.0.1:5004', 'x-tohyee-extension': '1', origin: 'chrome-extension://someotherextension'}}), 5004), false);
});

const request = (port, pathName, headers = {}) => new Promise((resolve, reject) => http.get({host: '127.0.0.1', port, path: pathName, headers}, res => { let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({status: res.statusCode, body, cors: res.headers['access-control-allow-origin']})); }).on('error', reject));

test('The tuner gives the saved sign-in to the extension, and to nobody else', async () => {
  const config = {port: 0, listenAddress: '127.0.0.1', deviceId: '1234ABCD', channels: [{channelNumber: '1', channelName: 'One', programmeTitle: 'x'}]};
  const logs = [];
  const runtime = await startRuntime({config, ffmpeg: 'ffmpeg', log: m => logs.push(m), signIn: site => site === 'https://www.skygo.co.nz' ? {email: 'me@example.com', password: 'pw'} : null});
  try {
    const port = runtime.server.address().port, host = `127.0.0.1:${port}`;
    const ok = await request(port, '/signin?site=https%3A%2F%2Fwww.skygo.co.nz', {host, 'X-Tohyee-Extension': '1', origin: EXTENSION_ORIGIN});
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), {email: 'me@example.com', password: 'pw'});
    assert.equal(ok.cors, undefined); // web pages can't read it
    assert.equal((await request(port, '/signin?site=https%3A%2F%2Fwww.skygo.co.nz', {host})).status, 403);
    assert.equal((await request(port, '/signin?site=https%3A%2F%2Fwww.skygo.co.nz', {host, 'X-Tohyee-Extension': '1', origin: 'https://evil.example'})).status, 403);
    assert.equal((await request(port, '/signin?site=https%3A%2F%2Fother.example', {host, 'X-Tohyee-Extension': '1'})).status, 404);
    assert.ok(!logs.join('\n').includes('pw'));
    assert.ok(logs.some(l => /Sent the saved sign-in for https:\/\/www\.skygo\.co\.nz/.test(l)));
  } finally { await runtime.close(); }
});

test('The extension knows Sky’s sign-in page and asks for it when arming a Sky Go tab', () => {
  const code = fs.readFileSync(new URL('../extension/signin.js', import.meta.url), 'utf8');
  const ctx = {URL}; ctx.globalThis = ctx; vm.runInNewContext(code, ctx);
  const {forSite, forPage} = ctx.TohyeeSignIn;
  assert.equal(forSite('https://www.skygo.co.nz').page, 'https://login.sky.co.nz');
  assert.equal(forPage('https://login.sky.co.nz/login?state=x').site, 'https://www.skygo.co.nz');
  assert.equal(forPage('https://www.tvnz.co.nz/'), null);
  assert.equal(forPage('not a url'), null);
  const popup = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
  assert.match(popup, /TohyeeSignIn\?\.forSite/);
  assert.match(fs.readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8'), /signin\.js[\s\S]*popup\.js/);
  const worker = fs.readFileSync(new URL('../extension/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /importScripts\('autostart\.js', 'signin\.js'\)/);
  assert.match(worker, /SIGN_IN_GAP_MS = 10 \* 60 \* 1000/); // never hammers the sign-in with a wrong password
});
