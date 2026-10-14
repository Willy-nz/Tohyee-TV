// Checks GitHub Releases for a newer Tohyee TV installer, and downloads it
// when the person presses Update now. Only public release information is
// downloaded; nothing about the person or their broadcasts is sent. The
// installer is checked against the release's SHA256SUMS.txt before it runs.

const REPO = 'Willy-nz/Tohyee-TV';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const RELEASE_PAGE_PREFIX = `https://github.com/${REPO}/releases/`.toLowerCase();
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`.toLowerCase();
const INSTALLER = /^Tohyee-TV-Setup-.+\.exe$/i;
const isDownload = url => typeof url === 'string' && url.toLowerCase().startsWith(DOWNLOAD_PREFIX);

// "0.6.1" or "v0.6.1-alpha.2" -> {core: [0,6,1], pre: ['alpha','2']}; anything else -> null.
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text ?? '').trim());
  return m ? {core: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split('.') : []} : null;
}

// Semantic-version order: negative if a < b, 0 if equal, positive if a > b.
function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error('Unrecognised version');
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // 1.0.0 > 1.0.0-alpha
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p - +q; }
    else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// From GitHub's release list, the newest release newer than `current` that
// has a Windows installer, or null. Test builds (prereleases) count only when
// `includeTest` is on. Drafts, odd tags and links outside this project are ignored.
function pickUpdate(releases, current, {includeTest = false} = {}) {
  if (!Array.isArray(releases) || !parseVersion(current)) return null;
  let best = null;
  for (const r of releases) {
    if (!r || r.draft || (r.prerelease && !includeTest)) continue;
    const version = parseVersion(r.tag_name);
    const url = typeof r.html_url === 'string' ? r.html_url : '';
    if (!version || !url.toLowerCase().startsWith(RELEASE_PAGE_PREFIX)) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const installer = assets.find(a => INSTALLER.test(a?.name ?? ''));
    if (!installer) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.parsed) > 0) {
      const sums = assets.find(a => a?.name === 'SHA256SUMS.txt');
      best = {parsed: version, version: r.tag_name.replace(/^v/, ''), name: r.name || r.tag_name, url, prerelease: !!r.prerelease};
      // What Update now needs; missing if the release can't be installed from the app.
      if (isDownload(installer.browser_download_url) && isDownload(sums?.browser_download_url)) {
        best.installer = {name: installer.name, url: installer.browser_download_url, size: Number(installer.size) || 0, sums: sums.browser_download_url};
      }
    }
  }
  if (!best) return null;
  const {parsed, ...update} = best;
  return update;
}

// -> {status: 'available', update} | {status: 'current'} | {status: 'error', message}
async function checkForUpdate({current, includeTest = false, fetchFn = fetch, timeoutMs = 15000}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(RELEASES_API, {
      headers: {Accept: 'application/vnd.github+json', 'User-Agent': `TohyeeTV/${current}`},
      signal: controller.signal
    });
    if (response.status === 403 || response.status === 429) return {status: 'error', message: 'GitHub is limiting update checks right now. It will try again later.'};
    if (!response.ok) return {status: 'error', message: `GitHub returned an error (${response.status}).`};
    const update = pickUpdate(await response.json(), current, {includeTest});
    return update ? {status: 'available', update} : {status: 'current'};
  } catch (error) {
    return {status: 'error', message: error?.name === 'AbortError' ? 'GitHub took too long to respond.' : 'Couldn’t reach GitHub. Check the internet connection.'};
  } finally {
    clearTimeout(timer);
  }
}

// The SHA256 listed for `name` in a SHA256SUMS.txt ("<hash>  <file>" lines), or null.
function checksumFor(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.replace(/^\uFEFF/, ''));
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

// Downloads the update's installer into `dir` and checks it against the
// release's SHA256SUMS.txt. Resolves to the installer's path; throws with a
// message for the person if anything is wrong (nothing is left behind).
async function downloadUpdate({update, dir, fetchFn = fetch, onProgress = () => {}, timeoutMs = 30 * 60 * 1000, fsModule = require('node:fs'), pathModule = require('node:path'), cryptoModule = require('node:crypto')}) {
  const inst = update?.installer;
  if (!inst || !isDownload(inst.url) || !isDownload(inst.sums) || !INSTALLER.test(inst.name) || /[\\/]/.test(inst.name)) throw new Error('This release can’t be installed from the app. Download it from the release page instead.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {'User-Agent': 'TohyeeTV'};
  const file = pathModule.join(dir, inst.name), part = `${file}.part`;
  try {
    const sumsResponse = await fetchFn(inst.sums, {headers, signal: controller.signal});
    if (!sumsResponse.ok) throw new Error(`GitHub returned an error (${sumsResponse.status}) for the checksum file.`);
    const expected = checksumFor(await sumsResponse.text(), inst.name);
    if (!expected) throw new Error('The release’s checksum file doesn’t list the installer, so it wasn’t installed.');
    const response = await fetchFn(inst.url, {headers, signal: controller.signal});
    if (!response.ok || !response.body) throw new Error(`GitHub returned an error (${response.status}) for the installer.`);
    const total = Number(response.headers?.get?.('content-length')) || inst.size || 0;
    fsModule.mkdirSync(dir, {recursive: true});
    const hash = cryptoModule.createHash('sha256');
    const out = fsModule.createWriteStream(part);
    const finished = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
    let received = 0;
    try {
      for await (const chunk of response.body) {
        const buf = Buffer.from(chunk);
        hash.update(buf); received += buf.length;
        if (!out.write(buf)) await new Promise(r => out.once('drain', r));
        onProgress(received, total);
      }
    } finally { out.end(); await finished; }
    if (hash.digest('hex') !== expected) throw new Error('The downloaded installer didn’t match its checksum, so it wasn’t installed. Try again later.');
    fsModule.renameSync(part, file);
    return file;
  } catch (error) {
    try { fsModule.rmSync(part, {force: true}); } catch {}
    if (error?.name === 'AbortError') throw new Error('The download took too long. Try again.');
    if (error instanceof TypeError) throw new Error('Couldn’t download the update. Check the internet connection.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Arguments for a silent upgrade: keep the install folder, close the running
// app, and open it again afterwards (electron-builder's NSIS installer).
const INSTALL_ARGS = ['/S', '--updated', '--force-run'];

// Only ever open this project's own release pages.
function isReleasePage(url) {
  return typeof url === 'string' && url.toLowerCase().startsWith(RELEASE_PAGE_PREFIX);
}

module.exports = {parseVersion, compareVersions, pickUpdate, checkForUpdate, isReleasePage, checksumFor, downloadUpdate, INSTALL_ARGS, RELEASES_API};
