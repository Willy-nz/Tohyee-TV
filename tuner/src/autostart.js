// What the Chrome extension should open and broadcast when the Tohyee TV app
// starts its Chrome window without anyone clicking (see extension/autostart.js).
import {channelConfigs} from './config.js';
import {escapeXml} from './hdhr.js';

export const MAX_DEDICATED_TABS = 8;

// Which website each reusable tab opens on, in tab order. tabsPerSite
// (e.g. {"https://www.skygo.co.nz": 4}) says how many each website gets;
// websites it leaves out, and any tabs left over, are shared out in turn.
export function poolTabs(channels, config) {
  const count = config.tabCount ?? 3;
  const sites = [...new Set(channels.map(c => new URL(c.url).origin))];
  if (sites.length > count) return {message: `Your channels use ${sites.length} websites. Choose at least ${sites.length} reusable tabs, or remove channels from websites you do not need.`};
  const wanted = config.tabsPerSite ?? {};
  const counts = new Map(sites.map(site => [site, Number.isInteger(wanted[site]) ? wanted[site] : 0]));
  const without = sites.filter(site => counts.get(site) === 0 && wanted[site] !== 0);
  let spare = count - [...counts.values()].reduce((a, b) => a + b, 0);
  for (const site of without) if (spare > 0) { counts.set(site, 1); spare--; }
  const none = sites.filter(site => counts.get(site) === 0);
  if (none.length) return {message: `No reusable tab is left for ${none.map(s => new URL(s).hostname).join(', ')}. Choose more reusable tabs, give that website a tab, or remove its channels.`};
  const share = sites.filter(site => !(site in wanted)).length ? sites.filter(site => !(site in wanted)) : sites;
  for (let i = 0; spare > 0; i++, spare--) counts.set(share[i % share.length], counts.get(share[i % share.length]) + 1);
  return sites.flatMap(site => Array(counts.get(site)).fill(`${site}/`));
}

export function autostartPlan(config) {
  const withUrl = channelConfigs(config).filter(c => /^https:\/\//.test(c.url ?? ''));
  if (!withUrl.length) return {items: [], message: 'No channel has a video page address yet. Add one for each channel in the Tohyee TV app (Channels).'};
  if ((config.captureMode ?? 'dedicated') === 'pool') {
    // Reusable tabs open on the website's front page (no player, so no stream
    // used). Plex then sends each one to the channel being watched.
    const urls = poolTabs(withUrl, config);
    if (urls.message) return {items: [], message: urls.message};
    return {items: urls.map((url, i) => ({channelNumber: `@${i + 1}`, label: `Reusable tab ${i + 1}`, url}))};
  }
  // One tab per channel only makes sense for a few channels (each open player
  // can use one of the service's streams).
  if (withUrl.length > MAX_DEDICATED_TABS) return {items: [], message: `${withUrl.length} channels have a video page address, too many to open a tab for each. Choose Reusable tabs in the Tohyee TV app (Channels), then start again.`};
  return {items: withUrl.map(c => ({channelNumber: c.channelNumber, label: `${c.channelNumber} ${c.channelName}`, url: c.url}))};
}

export function autostartPage(setup = false) {
  const intro = setup
    ? `<h1>Set up automatic start</h1>
<p>This Chrome window belongs to Tohyee TV. It has its own sign-ins, separate from your usual Chrome. Do these once:</p>
<ol>
<li>Open <b>chrome://extensions</b> in this window, turn on <b>Developer mode</b>, click <b>Load unpacked</b> and choose the Tohyee TV extension folder (in the app: Connect to Plex → Open extension folder).</li>
<li>Open each video website in a separate tab and sign in. Repeat the permission step below on each website, using a different reusable slot.</li>
<li>On that tab, click the Tohyee TV icon and choose <b>Arm this tab for Plex</b> once. That lets the extension press Play and Pause on the site. You can stop it again afterwards.</li>
</ol>
<p>From then on, when Tohyee TV starts it opens this window and starts your channels by itself.</p>`
    : `<h1>Starting your channels…</h1><p>Tohyee TV is opening your channel tabs. Once they’ve started, Tohyee TV moves this window out of the way by itself. Don’t close it: it’s what sends your channels to Plex.</p>
<p>To get back to your desktop or the Tohyee TV app any time, press <b>Alt+Tab</b>. To see extensions, click <b>Set up Chrome window</b> in Tohyee TV.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeXml(setup ? 'Tohyee TV · set up' : 'Tohyee TV · starting')}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#17181c;color:#eee;max-width:720px;margin:40px auto;padding:0 16px}h1{color:#efb438}li.ok{color:#9be29b}li.warn{color:#efb438}li.error{color:#ff9a8a}code,b{color:#fff}</style></head>
<body>${intro}<ul id="log"></ul></body></html>`;
}
