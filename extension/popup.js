const el = id => document.getElementById(id);
const LABELS = {
  idle: 'Not broadcasting', starting: 'Starting…', connecting: 'Looking for the tuner…',
  ready: 'Broadcasting · waiting for Plex', live: '● LIVE to Plex', error: 'Problem'
};
let busy = false;

const send = message => chrome.runtime.sendMessage({target: 'worker',channelNumber:el('channel').value||'1', ...message});

function render(data) {
  if (!data) return;
  if (data.error) { el('message').textContent = data.error; return; }
  const active = data.armed || ['starting', 'connecting', 'ready', 'live'].includes(data.state);
  el('status').textContent = LABELS[data.state] ?? data.state;
  el('status').className = data.state === 'live' ? 'live' : data.state === 'ready' ? 'ready' : data.state === 'error' ? 'error' : '';
  el('message').textContent = data.message ?? '';
  el('tab').hidden = !active || !data.tabTitle;
  el('tab').textContent = data.tabTitle ? `Tab: ${data.tabTitle}` : '';
  el('broadcast').hidden = active;
  el('stop').hidden = !active;
  el('broadcast').disabled = busy;
  if (document.activeElement !== el('reload')) el('reload').checked = data.reloadOnWatch !== false;
  if (document.activeElement !== el('idleAction') && data.idleAction) el('idleAction').value = data.idleAction;
  if (document.activeElement !== el('standbySeconds') && data.standbySeconds) el('standbySeconds').value = String(data.standbySeconds);
  el('standbyRow').hidden = el('idleAction').value !== 'standby';
  if (document.activeElement !== el('port') && data.port) el('port').value = data.port;
}

async function poll() {
  if (busy) return;
  try { render(await send({type: 'status'})); } catch (error) { el('message').textContent = error.message; }
}

// Ask (once per site) for permission to press Play / Pause on the video. Must
// run in the popup, straight from the click. Declining still lets you broadcast.
async function askPlayPermission() {
  if (!el('channel').value.startsWith('@') && !el('reload').checked && el('idleAction').value === 'none') return;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const origins = [`${new URL(tab.url).origin}/*`];
  if (await chrome.permissions.contains({origins})) return;
  const granted = await chrome.permissions.request({origins}).catch(() => false);
  if (!granted) el('message').textContent = 'OK — it can still reload the tab, but can’t press Play or Pause for you on this site.';
}

el('broadcast').addEventListener('click', async () => {
  busy = true; el('broadcast').disabled = true;
  el('message').textContent = 'Starting…';
  try {
    await askPlayPermission();
    render(await send({type: 'broadcast'}));
  } catch (error) {
    el('message').textContent = error.message;
  } finally {
    busy = false; el('broadcast').disabled = false; poll();
  }
});
el('stop').addEventListener('click', async () => render(await send({type: 'stop'})));
el('reload').addEventListener('change', async () => {
  if (el('reload').checked) await askPlayPermission();
  render({...(await send({type: 'saveSettings', reloadOnWatch: el('reload').checked})), ...(await send({type: 'status'}))});
});
el('idleAction').addEventListener('change', async () => {
  el('standbyRow').hidden = el('idleAction').value !== 'standby';
  if (el('idleAction').value !== 'none') await askPlayPermission();
  render({...(await send({type: 'saveSettings', idleAction: el('idleAction').value})), ...(await send({type: 'status'}))});
});
el('standbySeconds').addEventListener('change', async () => {
  render({...(await send({type: 'saveSettings', standbySeconds: Number(el('standbySeconds').value)})), ...(await send({type: 'status'}))});
});
el('save').addEventListener('click', async () => {
  const port = Number(el('port').value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { el('message').textContent = 'Port must be a number from 1 to 65535.'; return; }
  await send({type: 'saveSettings', port});
  el('message').textContent = 'Saved. Applies the next time you start broadcasting.';
});

async function loadChannels(){try{const channels=await send({type:'channels'});if(!Array.isArray(channels))throw new Error(channels.error||'No channels');const old=el('channel').value;el('channel').replaceChildren(...channels.map(c=>new Option(`${c.channelNumber} — ${c.channelName}`,c.channelNumber)));if(channels.some(c=>c.channelNumber===old))el('channel').value=old;poll();}catch(e){el('message').textContent='Open Tohyee TV, then click Refresh channels. '+e.message;}}
el('channel').addEventListener('change',poll);
el('refreshChannels').addEventListener('click',loadChannels);
loadChannels();
const timer = setInterval(poll, 1000);
window.addEventListener('pagehide', () => clearInterval(timer));
