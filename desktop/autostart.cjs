// Finds Google Chrome and opens Tohyee TV's own Chrome window: a separate
// profile, started with Chrome's switch that lets the Tohyee TV extension
// capture tabs without being clicked, so channels can start after a restart.
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

// The extension's fixed ID, from the "key" in extension/manifest.json.
const EXTENSION_ID = 'kffnaonlbpgfpaijambclnleipdgojkl';

function chromeCandidates(env = process.env) {
  return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
    .filter(Boolean).map(dir => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
}

function findChrome({env = process.env, exists = fs.existsSync} = {}) {
  if (process.platform !== 'win32' && !env.TOHYEE_CHROME) return null;
  if (env.TOHYEE_CHROME && exists(env.TOHYEE_CHROME)) return env.TOHYEE_CHROME;
  return chromeCandidates(env).find(p => exists(p)) ?? null;
}

function chromeArgs({profile, port, setup = false}) {
  return [
    `--user-data-dir=${profile}`,
    `--allowlisted-extension-id=${EXTENSION_ID}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    `http://127.0.0.1:${Number(port)}/autostart${setup ? '?setup=1' : ''}`
  ];
}

function launchChrome({profile, port, setup = false, chrome = findChrome(), spawnFn = spawn}) {
  if (!chrome) return {ok: false, error: 'Google Chrome wasn’t found. Install Chrome, then try again.'};
  try {
    fs.mkdirSync(profile, {recursive: true});
    const child = spawnFn(chrome, chromeArgs({profile, port, setup}), {detached: true, stdio: 'ignore'});
    child.on?.('error', () => {});
    child.unref?.();
    return {ok: true};
  } catch (error) {
    return {ok: false, error: `Couldn’t open Chrome: ${error.message}`};
  }
}

module.exports = {EXTENSION_ID, chromeCandidates, findChrome, chromeArgs, launchChrome};
