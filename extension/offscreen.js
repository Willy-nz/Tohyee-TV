// Owns the tab capture for as long as the tab is being broadcast, keeps a
// connection to the Tohyee TV tuner on this computer, and sends picture and
// sound only while Plex is watching.
//
// Capture starts when the person clicks "Broadcast this tab" (Chrome requires
// that click). After that, the tuner says when Plex starts and stops
// watching. Capture continues across reloads of the tab, so the tab can be
// refreshed when someone starts watching, and the video can be paused when
// nobody is watching and played again when someone starts.

const RETRY_DELAYS = [1000, 2000, 5000, 10000];
const PLAY_CHECKS_MS = [6000, 12000, 20000];   // after a reload
const RESUME_CHECKS_MS = [300, 4000, 10000];   // after a pause, without reloading
const MAX_UNSENT_BYTES = 32 * 1024 * 1024;
const MIME_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

function createCapture(channelNumber) {
const s = {
  state: 'idle',            // idle | starting | connecting | ready | live | error
  message: 'Not broadcasting.',
  tabId: null,
  tabTitle: '',
  port: 34500,
  reloadOnWatch: true,
  pauseWhenIdle: true,
  stream: null,
  audioOut: null,
  ws: null,
  retry: 0,
  retryTimer: null,
  recorder: null,
  session: 0,
  viewers: 0,
  playTimers: [],
  armed: false
};

function snapshot() {
  return {state: s.state, message: s.message, tabId: s.tabId, tabTitle: s.tabTitle, viewers: s.viewers, armed: s.armed,
    reloadOnWatch: s.reloadOnWatch, pauseWhenIdle: s.pauseWhenIdle, port: s.port};
}

function toWorker(message) {
  return chrome.runtime.sendMessage({target: 'worker', ...message}).catch(() => undefined);
}

function set(state, message) {
  s.state = state;
  if (message !== undefined) s.message = message;
  updateBadge();
  send({type: 'status', state, message: s.message, tabTitle: s.tabTitle});
}

function send(message) {
  if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(message));
}

// ---- Capture ---------------------------------------------------------------
async function arm({streamId, tabId, tabTitle, port, reloadOnWatch, pauseWhenIdle = true}) {
  disarm('Switching to a new tab.', true);
  s.armed = true;
  s.tabId = tabId; s.tabTitle = tabTitle ?? ''; s.port = port; s.reloadOnWatch = !!reloadOnWatch; s.pauseWhenIdle = !!pauseWhenIdle;
  set('starting', 'Starting tab capture…');
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId}},
      video: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: 30, maxWidth: 1920, maxHeight: 1080}}
    });
    if (!s.armed || s.tabId !== tabId) { media.getTracks().forEach(t => t.stop()); return snapshot(); }
    s.stream = media;
    if (!media.getVideoTracks().length) throw new Error('Chrome returned no picture for this tab.');
    // Capturing a tab stops its sound playing on the computer; play it back so you can still hear it.
    if (media.getAudioTracks().length) {
      s.audioOut = new AudioContext();
      s.audioOut.createMediaStreamSource(media).connect(s.audioOut.destination);
      s.audioOut.resume().catch(() => {});
    }
    media.getVideoTracks()[0].addEventListener('ended', () => {
      if (s.stream === media) disarm('Broadcast stopped: the tab was closed or Chrome stopped sharing it.');
    });
    connect();
  } catch (error) {
    disarm(`Could not capture this tab: ${error.message || error.name || 'unknown error'}`);
    s.state = 'error';
    updateBadge();
  }
  return snapshot();
}

function disarm(message = 'Not broadcasting.', quiet = false) {
  s.armed = false;
  clearTimeout(s.retryTimer); s.retryTimer = null; s.retry = 0;
  clearPlayChecks();
  stopRecorder();
  const ws = s.ws; s.ws = null;
  if (ws) { ws.onclose = null; ws.close(); }
  s.stream?.getTracks().forEach(t => t.stop());
  s.stream = null;
  s.audioOut?.close().catch(() => {});
  s.audioOut = null;
  s.viewers = 0;
  s.wasWatching = false;
  s.tabId = null;
  s.tabTitle = '';
  if (!quiet) { s.state = 'idle'; s.message = message; updateBadge(); }
  return snapshot();
}

// ---- Tuner connection ------------------------------------------------------
function connect() {
  if (!s.armed) return;
  set('connecting', `Looking for the Tohyee TV tuner on this computer (port ${s.port})…`);
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${s.port}/source/${encodeURIComponent(channelNumber)}`);
  } catch (error) {
    set('error', `Can't connect to the tuner: ${error.message}`);
    return;
  }
  s.ws = ws;
  ws.onopen = () => {
    if (s.ws !== ws) return;
    s.retry = 0;
    ws.send(JSON.stringify({type: 'hello', version: chrome.runtime.getManifest?.().version ?? '', tabTitle: s.tabTitle, reloadOnWatch: s.reloadOnWatch, pauseWhenIdle: s.pauseWhenIdle}));
    set('ready', 'Ready. Waiting for someone to watch Tohyee TV in Plex.');
  };
  ws.onmessage = event => {
    if (s.ws !== ws || typeof event.data !== 'string') return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'shutdown') disarm('Stopped from the Windows app.');
    else if (message.type === 'start') startRecorder(message.session);
    else if (message.type === 'stop') nobodyWatching();
    else if (message.type === 'viewers') viewersChanged(Number(message.count) || 0);
  };
  ws.onclose = () => {
    if (s.ws !== ws) return;
    s.ws = null;
    stopRecorder();
    clearPlayChecks();
    s.viewers = 0;
    s.wasWatching = false;
    if (!s.armed) return;
    const delay = RETRY_DELAYS[Math.min(s.retry++, RETRY_DELAYS.length - 1)];
    s.state = 'connecting';
    s.message = 'Can’t reach the Tohyee TV tuner. Make sure “Start Tohyee TV Tuner” is running on this computer. Retrying…';
    updateBadge();
    s.retryTimer = setTimeout(connect, delay);
  };
}

// ---- Recording while watched ----------------------------------------------
function startRecorder(session) {
  stopRecorder();
  if (!s.stream || !s.ws || s.ws.readyState !== 1) return;
  const mimeType = MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mimeType) { set('error', 'Chrome has no supported video recorder.'); return; }
  let recorder;
  try {
    recorder = new MediaRecorder(s.stream, {mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 160000});
  } catch (error) {
    set('error', `Could not start sending: ${error.message}`);
    return;
  }
  s.recorder = recorder;
  s.session = session;
  const ws = s.ws;
  recorder.ondataavailable = event => {
    if (s.recorder !== recorder || !event.data.size || ws.readyState !== 1) return;
    if (ws.bufferedAmount > MAX_UNSENT_BYTES) {
      failStream('The connection fell behind. Reconnecting to the tuner…');
      return;
    }
    ws.send(event.data);
  };
  recorder.onerror = () => { if (s.recorder === recorder) failStream('Recording failed. Reconnecting to the tuner…'); };
  ws.send(JSON.stringify({type: 'session', session, mimeType}));
  recorder.start(250);
  set('live', 'LIVE — sending this tab to Plex.');
}

function failStream(message) {
  stopRecorder();
  set('error', message);
  s.ws?.close(1011, 'Media stopped');
}

function stopRecorder() {
  const recorder = s.recorder;
  s.recorder = null;
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop(); } catch { /* already stopped */ }
  }
}

// ---- When someone starts or stops watching --------------------------------
function viewersChanged(count) {
  const started = s.viewers === 0 && count > 0 && s.playTimers.length === 0 && !s.wasWatching;
  s.viewers = count;
  if (count === 0) clearPlayChecks();
  if (count > 0) s.wasWatching = true;
  if (!started || s.tabId === null) return;
  if (s.reloadOnWatch) refreshForViewer();
  else if (s.pauseWhenIdle) resumeForViewer();
}

// The tuner says this once nobody has been watching for a few seconds (so a
// quick channel change in Plex doesn't pause the video).
async function nobodyWatching() {
  s.wasWatching = false;
  stopRecorder();
  clearPlayChecks();
  if (!s.armed) return;
  if (!s.pauseWhenIdle || s.tabId === null) { set('ready', 'Ready. Nobody is watching right now.'); return; }
  const tabId = s.tabId;
  const result = await toWorker({type: 'pauseVideo', tabId});
  if (s.tabId !== tabId || s.viewers > 0) return;
  if (result?.paused) set('ready', 'Nobody is watching — paused the video. It will play again when someone starts watching.');
  else if (result?.permission === false) set('ready', 'Nobody is watching. Couldn’t pause the video: Tohyee TV wasn’t given permission on this site.');
  else set('ready', 'Nobody is watching. No video was found to pause.');
}

function resumeForViewer() {
  clearPlayChecks();
  const tabId = s.tabId;
  set(s.state, 'Someone started watching — pressing Play…');
  for (const ms of RESUME_CHECKS_MS) s.playTimers.push(setTimeout(() => checkPlaying(tabId, ms === RESUME_CHECKS_MS.at(-1)), ms));
}

async function refreshForViewer() {
  clearPlayChecks();
  const tabId = s.tabId;
  const result = await toWorker({type: 'reloadTab', tabId});
  if (s.tabId !== tabId) return;
  if (!result?.ok) {
    set(s.state, `Someone started watching, but the tab couldn’t be reloaded${result?.error ? `: ${result.error}` : ''}.`);
    return;
  }
  set(s.state, 'Someone started watching — reloaded the tab. Checking the video plays…');
  for (const ms of PLAY_CHECKS_MS) s.playTimers.push(setTimeout(() => checkPlaying(tabId, ms === PLAY_CHECKS_MS.at(-1)), ms));
}

async function checkPlaying(tabId, last) {
  if (s.tabId !== tabId || s.viewers === 0) return;
  const result = await toWorker({type: 'ensurePlaying', tabId});
  if (s.tabId !== tabId) return;
  if (result?.playing) {
    clearPlayChecks();
    set(s.state, 'Playing.');
  } else if (result?.permission === false) {
    clearPlayChecks();
    set(s.state, 'Press Play on the tab if the video isn’t playing (Tohyee TV wasn’t given permission to press Play on this site).');
  } else if (last) {
    set(s.state, 'The video isn’t playing. It may need you to press Play or sign in on the tab.');
  }
}

function clearPlayChecks() {
  s.playTimers.forEach(clearTimeout);
  s.playTimers = [];
}

return {arm,disarm,snapshot,settings(request){
 if ('reloadOnWatch' in request) s.reloadOnWatch=!!request.reloadOnWatch;
 if ('pauseWhenIdle' in request) s.pauseWhenIdle=!!request.pauseWhenIdle;
},title(request){if(request.tabId===s.tabId){s.tabTitle=request.title??'';send({type:'status',tabTitle:s.tabTitle});}}};
}
const captures = new Map();
function capture(number='1') {if(!captures.has(number))captures.set(number,createCapture(number));return captures.get(number);}
function updateBadge(){
 const all=[...captures.values()].map(c=>c.snapshot());
 const state=['live','error','connecting','starting','ready'].find(state=>all.some(c=>c.state===state))??'idle';
 chrome.runtime.sendMessage({target:'worker',type:'badge',state}).catch(()=>{});
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(request.target!=='offscreen'||sender.id!==chrome.runtime.id)return;
 const number=String(request.channelNumber??'1');
 const c=capture(number);
 if(request.type==='arm') {
   const duplicate=[...captures].find(([id,x])=>id!==number&&x.snapshot().armed&&x.snapshot().tabId===request.tabId);
   if(duplicate){respond({error:`This tab is already assigned to channel ${duplicate[0]}. Stop that channel first.`});return;}
   c.arm(request).then(respond,e=>respond({error:e.message}));return true;
 }
 if(request.type==='disarm')respond(c.disarm(request.message));
 else if(request.type==='disarmAll'){for(const x of captures.values())x.disarm(request.message);respond({ok:true});}
 else if(request.type==='tabClosed'){for(const x of captures.values())if(x.snapshot().tabId===request.tabId)x.disarm('The tab was closed.');respond({ok:true});}
 else if(request.type==='title'){for(const x of captures.values())x.title(request);respond(c.snapshot());}
 else if(request.type==='settings'){for(const x of captures.values())x.settings(request);respond(c.snapshot());}
 else respond({...c.snapshot(),captures:[...captures].map(([channelNumber,x])=>({channelNumber,...x.snapshot()}))});
});
