// Starts broadcasting without a click, after a restart. The Tohyee TV app opens
// its own Chrome window (a separate profile) with Chrome's switch that lets
// this extension capture tabs without being clicked, at the tuner's
// /autostart page. When that page loads, this opens (or reuses) a tab for each
// channel the tuner lists and starts broadcasting it.
// Loaded by worker.js with importScripts, so it shares the worker's functions.

const AUTOSTART_PATH = '/autostart';
let autostarting = false;

function isAutostartPage(url, port) {
  try { const u = new URL(url); return u.origin === `http://127.0.0.1:${port}` && u.pathname === AUTOSTART_PATH; } catch { return false; }
}

// Writes a line on the autostart page so the person can see what happened.
async function report(tabId, text, kind = 'info') {
  try {
    await chrome.scripting.executeScript({target: {tabId}, args: [text, kind], func: (line, cls) => {
      const list = document.getElementById('log'); if (!list) return;
      const item = document.createElement('li'); item.textContent = line; item.className = cls; list.append(item);
    }});
  } catch { /* the page was closed */ }
}

// Chrome only shows the extension a tab's address on sites it has permission
// for, so this waits on the loading status alone.
async function waitForLoad(tabId, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  await new Promise(r => setTimeout(r, 500)); // let the new address start loading
  while (Date.now() < end) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('the page took too long to load');
}

// Sizes Tohyee TV's window so each tab's page is exactly 1920×1080: Sky Go
// sends 1080p, its player fills a TV-shaped page, and Chrome never enlarges a
// smaller tab. Returns the page size Chrome actually gave.
async function sizeWindow(windowId, tabId) {
  if ((await chrome.windows.get(windowId)).state !== 'normal') await chrome.windows.update(windowId, {state: 'normal'});
  const win = await chrome.windows.get(windowId), tab = await chrome.tabs.get(tabId);
  if (!tab.width || !tab.height) return null;
  if (tab.width !== 1920 || tab.height !== 1080) await chrome.windows.update(windowId, {width: win.width - tab.width + 1920, height: win.height - tab.height + 1080});
  const after = await chrome.tabs.get(tabId);
  return {width: after.width, height: after.height};
}

async function armedChannels() {
  if (!(await hasOffscreen())) return new Set();
  const status = await toOffscreen({type: 'status'});
  return new Set((status?.captures ?? []).filter(c => c.armed).map(c => c.channelNumber));
}

async function autostart(pageTabId) {
  if (autostarting) return;
  autostarting = true;
  try {
    const {port, reloadOnWatch, idleAction, standbySeconds, frameRate} = await settings();
    const page = await chrome.tabs.get(pageTabId);
    if (new URL(page.url).searchParams.has('setup')) return; // setting up: the person does it by hand
    let plan;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/autostart.json`, {signal: AbortSignal.timeout(5000)});
      plan = await response.json();
    } catch { await report(pageTabId, 'Couldn’t reach the Tohyee TV tuner. Is the app running?', 'error'); return; }
    if (!plan.items?.length) { await report(pageTabId, plan.message || 'No channels to start. Add each channel’s video page address in the Tohyee TV app.', 'error'); return; }

    try {
      const size = await sizeWindow(page.windowId, pageTabId);
      if (size && (size.width < 1800 || size.height < 1000)) await report(pageTabId, `This screen only fits a ${size.width}×${size.height} page, so Plex gets a smaller picture than Sky's 1080p. A 1920×1080 (or bigger) screen setting fixes that.`, 'warn');
      else if (size) await report(pageTabId, `Window sized for full 1080p (${size.width}×${size.height}).`);
    } catch { /* keep the window as it is */ }
    const {autoTabs = {}} = await chrome.storage.local.get('autoTabs');
    const armed = await armedChannels();
    let started = 0;
    for (const item of plan.items) {
      const label = item.label || `Channel ${item.channelNumber}`;
      if (armed.has(item.channelNumber)) { await report(pageTabId, `${label}: already broadcasting.`); started++; continue; }
      try {
        const origin = new URL(item.url).origin;
        // Reuse the tab opened last time if it's still there.
        let tabId = autoTabs[item.channelNumber];
        let tab = null;
        if (tabId !== undefined) tab = await chrome.tabs.get(tabId).catch(() => null);
        if (tab) await chrome.tabs.update(tab.id, {url: item.url});
        else tab = await chrome.tabs.create({url: item.url, active: false, windowId: page.windowId});
        autoTabs[item.channelNumber] = tab.id;
        await chrome.storage.local.set({autoTabs});
        await report(pageTabId, `${label}: opening ${origin}…`);
        tab = await waitForLoad(tab.id);
        await ensureOffscreen();
        let streamId;
        try { streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id}); }
        catch (error) { throw new Error(`Chrome didn’t allow capture without a click (${error.message}). Start this window from the Tohyee TV app.`); }
        const result = await toOffscreen({type: 'arm', channelNumber: item.channelNumber, streamId, tabId: tab.id, tabTitle: tab.title || label, tabUrl: item.url, port, reloadOnWatch, idleAction, standbySeconds, frameRate});
        if (result?.error) throw new Error(result.error);
        const permitted = await chrome.permissions.contains({origins: [`${origin}/*`]});
        await report(pageTabId, `${label}: broadcasting.${permitted ? '' : ' Play and Pause aren’t allowed on this site yet: click the Tohyee TV icon on that tab and choose Arm this tab for Plex once to allow them.'}`, permitted ? 'ok' : 'warn');
        started++;
      } catch (error) {
        await report(pageTabId, `${label}: ${error.message}`, 'error');
      }
    }
    await report(pageTabId, `Started ${started} of ${plan.items.length}. You can leave this window open (minimised is fine).`, started === plan.items.length ? 'ok' : 'warn');
  } finally {
    autostarting = false;
  }
}

// Each starting page is acted on once (Chrome can report the same load twice).
const handledPages = new Set();

async function checkAutostartPage(tabId, url) {
  const {port} = await settings();
  if (!isAutostartPage(url, port) || handledPages.has(tabId)) return;
  handledPages.add(tabId);
  await autostart(tabId);
}

// Chrome opens the starting page while it is still starting, sometimes before
// this script is running, so also look for one when Chrome or the extension starts.
async function findStartingPage() {
  for (let i = 0; i < 20; i++) {
    const {port} = await settings();
    const tabs = await chrome.tabs.query({url: `http://127.0.0.1:${port}/autostart*`});
    const ready = tabs.find(t => t.status === 'complete' && !handledPages.has(t.id));
    if (ready) return checkAutostartPage(ready.id, ready.url);
    if (!tabs.length && i > 4) return; // no starting page: an ordinary Chrome start
    await new Promise(r => setTimeout(r, 1500));
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) checkAutostartPage(tabId, tab.url).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { findStartingPage().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { findStartingPage().catch(() => {}); });
