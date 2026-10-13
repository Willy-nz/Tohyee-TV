// Checks GitHub Releases for a newer Tohyee TV installer.
// Only public release information is downloaded; nothing about the person or
// their broadcasts is sent. It never downloads or runs anything itself: it
// reports the release page so the person can choose to install it.

const REPO = 'Willy-nz/Tohyee-TV';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
const RELEASE_PAGE_PREFIX = `https://github.com/${REPO}/releases/`.toLowerCase();
const INSTALLER = /^Tohyee-TV-Setup-.+\.exe$/i;

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
    if (!(Array.isArray(r.assets) && r.assets.some(a => INSTALLER.test(a?.name ?? '')))) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.parsed) > 0) {
      best = {parsed: version, version: r.tag_name.replace(/^v/, ''), name: r.name || r.tag_name, url, prerelease: !!r.prerelease};
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

// Only ever open this project's own release pages.
function isReleasePage(url) {
  return typeof url === 'string' && url.toLowerCase().startsWith(RELEASE_PAGE_PREFIX);
}

module.exports = {parseVersion, compareVersions, pickUpdate, checkForUpdate, isReleasePage, RELEASES_API};
