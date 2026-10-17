// What the Chrome extension should open and broadcast when the Tohyee TV app
// starts its Chrome window without anyone clicking (see extension/autostart.js).
import {channelConfigs} from './config.js';
import {escapeXml} from './hdhr.js';

export const MAX_DEDICATED_TABS = 8;

export function autostartPlan(config) {
  const withUrl = channelConfigs(config).filter(c => /^https:\/\//.test(c.url ?? ''));
  if (!withUrl.length) return {items: [], message: 'No channel has a video page address yet. Add one for each channel in the Tohyee TV app (Channels).'};
  if ((config.captureMode ?? 'dedicated') === 'pool') {
    // Reusable tabs open on the website's front page (no player, so no stream
    // used). Plex then sends each one to the channel being watched.
    const home = `${new URL(withUrl[0].url).origin}/`;
    return {items: Array.from({length: config.tabCount ?? 3}, (_, i) => ({channelNumber: `@${i + 1}`, label: `Reusable tab ${i + 1}`, url: home}))};
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
<li>Open your video website in a new tab and sign in.</li>
<li>On that tab, click the Tohyee TV icon and choose <b>Arm this tab for Plex</b> once. That lets the extension press Play and Pause on the site. You can stop it again afterwards.</li>
</ol>
<p>From then on, when Tohyee TV starts it opens this window and starts your channels by itself.</p>`
    : `<h1>Starting your channels…</h1><p>Tohyee TV is opening your channel tabs. You can minimise this window, but don’t close it.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeXml(setup ? 'Tohyee TV · set up' : 'Tohyee TV · starting')}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#17181c;color:#eee;max-width:720px;margin:40px auto;padding:0 16px}h1{color:#efb438}li.ok{color:#9be29b}li.warn{color:#efb438}li.error{color:#ff9a8a}code,b{color:#fff}</style></head>
<body>${intro}<ul id="log"></ul></body></html>`;
}
