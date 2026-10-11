// Checks GitHub Releases for a newer Tohyee TV build.
// Only reads public release information; nothing about the user or their
// capture is sent. Prereleases are included because all test builds are
// published as prereleases.

// Parses "1.2.3" or "v1.2.3-alpha.4". Returns null for anything else.
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text ?? '').trim());
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    pre: match[4] ? match[4].split('.') : []
  };
}

// Semantic-version ordering: negative if a < b, 0 if equal, positive if a > b.
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error('Unrecognised version');
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // A release without a prerelease label is newer than any prerelease of it.
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) - Number(q); }
    else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// From a GitHub "list releases" response, returns the newest release that is
// newer than `current`, or null. Drafts, unparseable tags and links that
// don't point at this repository's GitHub pages are ignored.
export function findNewerRelease(releases, current, repo) {
  if (!Array.isArray(releases)) return null;
  const pagePrefix = `https://github.com/${repo}/releases/`.toLowerCase();
  let best = null;
  for (const release of releases) {
    if (!release || release.draft) continue;
    const version = parseVersion(release.tag_name);
    const url = typeof release.html_url === 'string' ? release.html_url : '';
    if (!version || !url.toLowerCase().startsWith(pagePrefix)) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.parsed) > 0) {
      best = {parsed: version, tag: release.tag_name, name: release.name || release.tag_name, url};
    }
  }
  if (!best) return null;
  const {parsed, ...result} = best;
  return result;
}

// Fetches releases and returns {status: 'update', release} | {status: 'current'}
// | {status: 'error', message}. `fetchFn` is injectable for tests.
export async function checkForUpdate({current, repo, fetchFn = fetch, timeoutMs = 10000}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      headers: {Accept: 'application/vnd.github+json'},
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal
    });
    if (response.status === 403 || response.status === 429) {
      return {status: 'error', message: 'GitHub is limiting update checks right now. Try again later.'};
    }
    if (!response.ok) return {status: 'error', message: `GitHub returned an error (${response.status}).`};
    const release = findNewerRelease(await response.json(), current, repo);
    return release ? {status: 'update', release} : {status: 'current'};
  } catch (error) {
    return {
      status: 'error',
      message: error?.name === 'AbortError'
        ? 'GitHub took too long to respond.'
        : 'Could not reach GitHub. Check your internet connection.'
    };
  } finally {
    clearTimeout(timer);
  }
}
