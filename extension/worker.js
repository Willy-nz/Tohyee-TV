// Background service worker: starts and stops broadcasting when asked by the
// popup, keeps the toolbar badge up to date, and does the tab actions the
// offscreen page asks for (reload the tab, check its video is playing).

const DEFAULTS = {port: 34500, reloadOnWatch: true};
let creating;

async function settings() {
  return {...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS)))};
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Keep capturing the tab you chose to broadcast after this popup closes, and send it to the Tohyee TV tuner while Plex is watching.'
    }).finally(() => { creating = undefined; });
  }
  await creating;
}

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']})).length > 0;
}

const toOffscreen = message => chrome.runtime.sendMessage({target: 'offscreen', ...message});

const BADGES = {
  live: {text: 'LIVE', color: '#c42b45', title: 'Tohyee TV — LIVE to Plex'},
  ready: {text: 'ON', color: '#6b5a1e', title: 'Tohyee TV — broadcasting, waiting for Plex'},
  connecting: {text: '…', color: '#6b5a1e', title: 'Tohyee TV — looking for the tuner'},
  starting: {text: '…', color: '#6b5a1e', title: 'Tohyee TV — starting'},
  error: {text: 'ERR', color: '#8a3a1e', title: 'Tohyee TV — problem, open for details'},
  idle: {text: '', color: '#444', title: 'Tohyee TV'}
};

async function setBadge(state) {
  const badge = BADGES[state] ?? BADGES.idle;
  await chrome.action.setBadgeText({text: badge.text});
  await chrome.action.setBadgeBackgroundColor({color: badge.color});
  await chrome.action.setTitle({title: badge.title});
}

// Runs inside the broadcast tab (all frames) to see whether its main video is
// playing, and starts it if it's paused. Only the largest video counts, so
// small preview clips are ignored.
function playMainVideo() {
  const videos = [...document.querySelectorAll('video')];
  if (!videos.length) return {found: false, playing: false};
  const main = videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  const playing = !main.paused && !main.ended && main.readyState > 2;
  if (!playing && main.paused) {
    main.play().catch(() => {});
  }
  return {found: true, playing, area: main.clientWidth * main.clientHeight};
}

async function ensurePlaying(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const origin = new URL(tab.url).origin;
  if (!(await chrome.permissions.contains({origins: [`${origin}/*`]}))) return {permission: false};
  const results = await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: playMainVideo});
  const found = results.map(r => r.result).filter(r => r?.found).sort((a, b) => b.area - a.area);
  return {playing: found.length > 0 && found[0].playing, found: found.length > 0};
}

async function broadcast() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('Open the website tab you want to broadcast, then click Tohyee TV there.');
  const {port, reloadOnWatch} = await settings();
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
  await chrome.storage.session.set({broadcastTabId: tab.id});
  return toOffscreen({type: 'arm', streamId, tabId: tab.id, tabTitle: tab.title, port, reloadOnWatch});
}

async function command(message) {
  switch (message.type) {
    case 'badge':
      await setBadge(message.state);
      return {ok: true};
    case 'broadcast':
      return broadcast();
    case 'stop':
      await chrome.storage.session.remove('broadcastTabId');
      if (!(await hasOffscreen())) return {state: 'idle', message: 'Not broadcasting.'};
      return toOffscreen({type: 'disarm', message: 'Broadcast stopped.'});
    case 'saveSettings': {
      const update = {};
      if (typeof message.reloadOnWatch === 'boolean') update.reloadOnWatch = message.reloadOnWatch;
      if (Number.isInteger(message.port) && message.port > 0 && message.port < 65536) update.port = message.port;
      await chrome.storage.local.set(update);
      if (await hasOffscreen()) await toOffscreen({type: 'settings', ...update});
      return settings();
    }
    case 'reloadTab':
      try {
        await chrome.tabs.reload(message.tabId);
        return {ok: true};
      } catch (error) {
        return {ok: false, error: error.message};
      }
    case 'ensurePlaying':
      try {
        return await ensurePlaying(message.tabId);
      } catch (error) {
        return {playing: false, error: error.message};
      }
    case 'status':
    default: {
      const saved = await settings();
      if (!(await hasOffscreen())) return {state: 'idle', message: 'Not broadcasting.', ...saved};
      return {...saved, ...(await toOffscreen({type: 'status'}))};
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'worker' || sender.id !== chrome.runtime.id) return;
  command(message).then(respond, error => respond({error: error.message}));
  return true;
});

// Keep the shown title current, and stop cleanly if the tab is closed.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.title) return;
  const {broadcastTabId} = await chrome.storage.session.get('broadcastTabId');
  if (tabId === broadcastTabId && await hasOffscreen()) toOffscreen({type: 'title', tabId, title: info.title}).catch(() => {});
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const {broadcastTabId} = await chrome.storage.session.get('broadcastTabId');
  if (tabId !== broadcastTabId) return;
  await chrome.storage.session.remove('broadcastTabId');
  if (await hasOffscreen()) toOffscreen({type: 'disarm', message: 'Broadcast stopped: the tab was closed.'}).catch(() => {});
});
