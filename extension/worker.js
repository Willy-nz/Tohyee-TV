// Background service worker: starts and stops broadcasting when asked by the
// popup, keeps the toolbar badge up to date, and does the tab actions the
// offscreen page asks for (reload the tab, check its video is playing, move
// it to the standby page and back).

const DEFAULTS = {port: 34500, reloadOnWatch: true, idleAction: 'standby', standbySeconds: 60, frameRate: 50};
// Sky (and NZ TV generally) sends 50 frames a second; 25 is every second frame.
const FRAME_RATES = [50, 25];
const IDLE_ACTIONS = ['standby', 'pause', 'none'];
const STANDBY_SECONDS = [30, 60, 120, 300, 600];
let creating;

async function settings() {
  const stored = await chrome.storage.local.get([...Object.keys(DEFAULTS), 'pauseWhenIdle']);
  const result = {...DEFAULTS, ...stored};
  // Earlier versions had a pause on/off switch; someone who switched it off wants nothing done.
  if (!('idleAction' in stored) && stored.pauseWhenIdle === false) result.idleAction = 'none';
  delete result.pauseWhenIdle;
  return result;
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

// Runs inside the broadcast tab (all frames): pauses the main video.
function pauseMainVideo() {
  const videos = [...document.querySelectorAll('video')];
  if (!videos.length) return {found: false};
  const main = videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  if (!main.paused) main.pause();
  return {found: true, paused: main.paused, area: main.clientWidth * main.clientHeight};
}

async function sitePermitted(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return chrome.permissions.contains({origins: [`${new URL(tab.url).origin}/*`]});
}

async function pauseVideo(tabId) {
  if (!(await sitePermitted(tabId))) return {permission: false};
  const results = await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: pauseMainVideo});
  const found = results.map(r => r.result).filter(r => r?.found).sort((a, b) => b.area - a.area);
  return {found: found.length > 0, paused: found.length > 0 && found[0].paused};
}

async function ensurePlaying(tabId) {
  if (!(await sitePermitted(tabId))) return {permission: false};
  const results = await chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: playMainVideo});
  const found = results.map(r => r.result).filter(r => r?.found).sort((a, b) => b.area - a.area);
  return {playing: found.length > 0 && found[0].playing, found: found.length > 0};
}

async function broadcast(channelNumber) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('Open the website tab you want to broadcast, then click Tohyee TV there.');
  const {port, reloadOnWatch, idleAction, standbySeconds, frameRate} = await settings();
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
  return toOffscreen({type: 'arm', channelNumber, streamId, tabId: tab.id, tabTitle: tab.title, tabUrl: tab.url, port, reloadOnWatch, idleAction, standbySeconds, frameRate, tabWidth: tab.width, tabHeight: tab.height});
}

// Leaves the video page for the standby page, closing the site's player.
// Returns the page's current address when Chrome lets us read it (it does on
// sites where Play/Pause permission was given), so we can go back to exactly
// where it was.
async function standbyTab(tabId, channelNumber) {
  let url = null;
  try { const tab = await chrome.tabs.get(tabId); if (/^https?:/.test(tab.url ?? '')) url = tab.url; } catch { /* keep the address saved at broadcast time */ }
  await chrome.tabs.update(tabId, {url: chrome.runtime.getURL(`standby.html?channel=${encodeURIComponent(channelNumber ?? '1')}`)});
  return {ok: true, url};
}

async function returnTab(tabId, url) {
  if (!/^https?:\/\//.test(url ?? '')) throw new Error('No web page to go back to.');
  await chrome.tabs.update(tabId, {url});
  return {ok: true};
}

const poolNavigations=new Map();
async function navigatePool(message){
 const {tabId,navigation}=message;poolNavigations.set(tabId,navigation);
 const current=()=>poolNavigations.get(tabId)===navigation;
 if(message.type==='parkPool'){await standbyTab(tabId,message.channelNumber);return {ok:true};}
 const url=new URL(message.url);
 if(url.protocol!=='https:'||url.origin!==message.origin||url.username||url.password)throw new Error('Channel must be on the same HTTPS website as the authorised tab.');
 if(!await chrome.permissions.contains({origins:[url.origin+'/*']}))throw new Error('Give the extension Play permission for this website, then arm the tab again.');
 if(!current())return {ok:false,error:'Switch cancelled'};
 await chrome.tabs.update(tabId,{url:url.href});
 let loadedAt=0;
 for(let i=0;i<35;i++){
  await new Promise(r=>setTimeout(r,800));if(!current())return {ok:false,error:'Switch cancelled'};
  const tab=await chrome.tabs.get(tabId);
  if(tab.status!=='complete'){loadedAt=0;continue;}
  if(new URL(tab.url).origin!==url.origin)throw new Error('The channel redirected to another website. Check its link or sign in.');
  if(!loadedAt){loadedAt=Date.now();continue;}
  if(Date.now()-loadedAt<1600)continue;
  const result=await ensurePlaying(tabId);if(result.playing)return {ok:true};
 }
 throw new Error('No playing video after 28 seconds. Check the channel link, sign in or press Play.');
}

async function command(message) {
  switch (message.type) {
    case 'cancelPool':poolNavigations.set(message.tabId,message.navigation);return {ok:true};
    case 'navigatePool':
    case 'parkPool':
      try{return await navigatePool(message);}catch(e){return {ok:false,error:e.message};}
    case 'channels': {
      const {port}=await settings();
      // Older tuners have no capture.json: they only have dedicated channels.
      const setup=await fetch(`http://127.0.0.1:${port}/capture.json`,{signal:AbortSignal.timeout(3000)}).then(r=>r.ok?r.json():{}).catch(()=>({}));
      if(setup.mode==='pool')return Array.from({length:setup.tabCount},(_,i)=>({channelNumber:'@'+(i+1),channelName:'Reusable tab '+(i+1)}));
      const response=await fetch(`http://127.0.0.1:${port}/channels.json`,{signal:AbortSignal.timeout(3000)});
      if(!response.ok)throw new Error('Could not load channels');
      return response.json();
    }
    case 'badge':
      await setBadge(message.state);
      return {ok: true};
    case 'broadcast':
      return broadcast(String(message.channelNumber??'1'));
    case 'stop':
      if (!(await hasOffscreen())) return {state: 'idle', message: 'Not broadcasting.'};
      return toOffscreen({type: 'disarm', channelNumber:message.channelNumber, message: 'Broadcast stopped.'});
    case 'saveSettings': {
      const update = {};
      if (typeof message.reloadOnWatch === 'boolean') update.reloadOnWatch = message.reloadOnWatch;
      if (IDLE_ACTIONS.includes(message.idleAction)) update.idleAction = message.idleAction;
      if (STANDBY_SECONDS.includes(Number(message.standbySeconds))) update.standbySeconds = Number(message.standbySeconds);
      if (FRAME_RATES.includes(Number(message.frameRate))) update.frameRate = Number(message.frameRate);
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
    case 'standbyTab':
      try {
        return await standbyTab(message.tabId, message.channelNumber);
      } catch (error) {
        return {ok: false, error: error.message};
      }
    case 'returnTab':
      try {
        return await returnTab(message.tabId, message.url);
      } catch (error) {
        return {ok: false, error: error.message};
      }
    case 'leaveStandby':
      if (!(await hasOffscreen())) return {state: 'idle'};
      return toOffscreen({type: 'leaveStandby', channelNumber: message.channelNumber});
    case 'pauseVideo':
      try {
        return await pauseVideo(message.tabId);
      } catch (error) {
        return {paused: false, error: error.message};
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
      return {...saved, ...(await toOffscreen({type: 'status',channelNumber:message.channelNumber}))};
    }
  }
}

importScripts('autostart.js');

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'worker' || sender.id !== chrome.runtime.id) return;
  command(message).then(respond, error => respond({error: error.message}));
  return true;
});

chrome.tabs.onUpdated.addListener(async(tabId,info)=>{
 if(info.title && await hasOffscreen())toOffscreen({type:'title',tabId,title:info.title}).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(async tabId=>{
 if(await hasOffscreen())toOffscreen({type:'tabClosed',tabId}).catch(()=>{});
});
