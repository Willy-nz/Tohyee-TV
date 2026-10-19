// Owns the tab capture for as long as the tab is being broadcast, keeps a
// connection to the Tohyee TV tuner on this computer, and sends picture and
// sound only while Plex is watching.
//
// Capture starts when the person clicks "Broadcast this tab" (Chrome requires
// that click). After that, the tuner says when Plex starts and stops
// watching. Capture continues when the tab changes page (checked in
// Chromium), so when nobody is watching the tab can leave the video page for a
// standby page — closing the player, so the site stops counting it as one of
// the account's streams — and go back when someone starts watching, without
// another click.

const RETRY_DELAYS = [1000, 2000, 5000, 10000];
const PLAY_CHECKS_MS = [6000, 12000, 20000];   // after a reload
const RESUME_CHECKS_MS = [300, 4000, 10000];   // after a pause, without reloading
const IDLE_ACTIONS = ['standby', 'pause', 'none'];
const MAX_UNSENT_BYTES = 32 * 1024 * 1024;
// H.264 first: the tuner can pass it straight to Plex without re-encoding.
const MIME_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
// Ask for a keyframe every 2 seconds (milliseconds, per the MediaRecorder
// spec). Plex needs regular keyframes to start and join the stream; if Chrome
// doesn't honour this, the tuner notices and switches to compatibility encoding.
const KEYFRAME_INTERVAL_MS = 2000;

let nextNavigation=0;
function createCapture(channelNumber) {
const pooled=channelNumber.startsWith('@');let navigation=0;
const s = {
  state: 'idle',            // idle | starting | connecting | ready | live | error
  message: 'Not broadcasting.',
  tabId: null,
  tabTitle: '',
  port: 34500,
  reloadOnWatch: true,
  idleAction: 'standby',    // when nobody is watching: standby (leave the page) | pause | none
  standbySeconds: 60,       // how long nobody must be watching before leaving the page
  returnUrl: '',            // the video page to go back to
  inStandby: false,
  standbyTimer: null,
  stream: null,
  recordStream: null,       // what's sent to Plex: the tab's picture plus a sound track that never goes quiet
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
    reloadOnWatch: s.reloadOnWatch, idleAction: s.idleAction, standbySeconds: s.standbySeconds,
    inStandby: s.inStandby, returnUrl: s.inStandby ? s.returnUrl : '', port: s.port,
    frameRate: s.frameRate, captureSize: s.captureSize ?? '', sizeNote: s.armed ? (s.sizeNote ?? '') : ''};
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
async function arm({streamId, tabId, tabTitle, tabUrl = '', port, reloadOnWatch, idleAction = 'standby', standbySeconds = 60, frameRate = 50, tabWidth = 0, tabHeight = 0}) {
  disarm('Switching to a new tab.', true);
  s.armed = true;
  s.tabId = tabId; s.tabTitle = tabTitle ?? ''; s.port = port; s.reloadOnWatch = !!reloadOnWatch;
  s.idleAction = IDLE_ACTIONS.includes(idleAction) ? idleAction : 'standby';
  s.standbySeconds = Number(standbySeconds) > 0 ? Number(standbySeconds) : 60;
  s.frameRate = [50, 25].includes(Number(frameRate)) ? Number(frameRate) : 50;
  s.returnUrl = /^https?:/.test(tabUrl) ? tabUrl : '';
  set('starting', 'Starting tab capture…');
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId}},
      video: {mandatory: {chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: s.frameRate, maxWidth: 1920, maxHeight: 1080}}
    });
    if (!s.armed || s.tabId !== tabId) { media.getTracks().forEach(t => t.stop()); return snapshot(); }
    s.stream = media;
    if (!media.getVideoTracks().length) throw new Error('Chrome returned no picture for this tab.');
    // Capturing a tab stops its sound playing on the computer; play it back so you can still hear it.
    // Plex also needs real sound data from the first second, or it can't
    // start the channel ("Could not tune channel"). A tab that's silent or
    // muted (Sky Go can start muted) sends none, so the sound sent to Plex
    // is the tab's sound mixed with silence, which never stops.
    s.recordStream = media;
    try {
      const audioOut = s.audioOut = new AudioContext({sampleRate: 48000});
      const toPlex = audioOut.createMediaStreamDestination();
      if (media.getAudioTracks().length) {
        const tab = audioOut.createMediaStreamSource(media);
        tab.connect(audioOut.destination);
        tab.connect(toPlex);
      }
      const silence = audioOut.createConstantSource();
      silence.offset.value = 0;
      silence.connect(toPlex);
      silence.start();
      await audioOut.resume().catch(() => {});
      if (!s.armed || s.stream !== media) return snapshot(); // stopped while waiting
      // Chrome didn't allow sound here: send the tab as it is.
      if (audioOut.state === 'running') s.recordStream = new MediaStream([...media.getVideoTracks(), ...toPlex.stream.getAudioTracks()]);
    } catch {
      // No Web Audio: send the tab as it is.
      if (!s.armed || s.stream !== media) return snapshot();
      s.recordStream = media;
    }
    // Chrome shrinks a big tab to fit 1920×1080, but a smaller tab is padded
    // with black borders, not enlarged, and the capture still reports
    // 1920×1080. So judge by the tab's own size (in real pixels), which the
    // worker read when the broadcast started.
    const scale = Number(globalThis.devicePixelRatio) || 1;
    const real = tabWidth && tabHeight ? {width: Math.round(tabWidth * scale), height: Math.round(tabHeight * scale)} : (media.getVideoTracks()[0].getSettings?.() ?? {});
    const fit = real.width && real.height ? Math.min(1, 1920 / real.width, 1080 / real.height) : 1;
    const width = Math.round((real.width ?? 0) * fit), height = Math.round((real.height ?? 0) * fit);
    s.captureSize = width && height ? `${width}×${height}` : '';
    s.sizeNote = width && height && (width < 1800 || height < 1000)
      ? `Plex gets a ${width}×${height} picture because this tab is ${width < 1800 && height < 1000 ? 'small' : 'not TV-shaped'}. For full 1080p, make the browser window bigger (or maximise it on a 1920×1080 screen).` : '';
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
  navigation=++nextNavigation;
  if(pooled&&s.tabId!==null)toWorker({type:'cancelPool',tabId:s.tabId,navigation});
  clearStandbyTimer();
  // If the tab is on the standby page, give the person their video page back.
  if (!pooled && s.inStandby && s.tabId !== null && s.returnUrl) toWorker({type: 'returnTab', tabId: s.tabId, url: s.returnUrl});
  s.inStandby = false;
  clearTimeout(s.retryTimer); s.retryTimer = null; s.retry = 0;
  clearPlayChecks();
  stopRecorder();
  const ws = s.ws; s.ws = null;
  if (ws) { ws.onclose = null; ws.close(); }
  s.stream?.getTracks().forEach(t => t.stop());
  s.stream = null;
  s.recordStream?.getAudioTracks().forEach(t => t.stop());
  s.recordStream = null;
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
    ws = new WebSocket(`ws://127.0.0.1:${s.port}/${pooled?'slot/'+channelNumber.slice(1):'source/'+encodeURIComponent(channelNumber)}`);
  } catch (error) {
    set('error', `Can't connect to the tuner: ${error.message}`);
    return;
  }
  s.ws = ws;
  ws.onopen = () => {
    if (s.ws !== ws) return;
    s.retry = 0;
    ws.send(JSON.stringify({type: 'hello', version: chrome.runtime.getManifest?.().version ?? '', tabTitle: s.tabTitle, reloadOnWatch: s.reloadOnWatch, idleAction: s.idleAction, frameRate: s.frameRate, captureSize: s.captureSize}));
    set('ready', 'Ready. Waiting for someone to watch Tohyee TV in Plex.');
    idleFromStart();
  };
  ws.onmessage = event => {
    if (s.ws !== ws || typeof event.data !== 'string') return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'shutdown') disarm('Stopped from the Windows app.');
    else if (pooled && message.type === 'tune') tune(message,ws);
    else if (pooled && message.type === 'park') park();
    else if (message.type === 'start') startRecorder(message.session);
    else if (message.type === 'stop') nobodyWatching();
    else if (message.type === 'viewers') viewersChanged(Number(message.count) || 0);
  };
  ws.onclose = () => {
    if (s.ws !== ws) return;
    s.ws = null;
    navigation=++nextNavigation;
  if(pooled&&s.tabId!==null)toWorker({type:'cancelPool',tabId:s.tabId,navigation});
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

// Only acknowledge a tune after its page has loaded and a video is playing.
// The tuner withholds capture data until this acknowledgement.
async function tune(message,ws){
 const id=navigation=++nextNavigation;stopRecorder();clearStandbyTimer();clearPlayChecks();s.inStandby=false;s.viewers=0;
 set('starting',`Switching to ${message.channelName}…`);
 // The armed tab's own address decides which website channels may load.
 if(!s.returnUrl){const error='This tab’s web address isn’t known. Open the video website in it and arm it again.';set('error',error);send({type:'tuned',token:message.token,ok:false,error});return;}
 const result=await toWorker({type:'navigatePool',tabId:s.tabId,url:message.url,origin:new URL(s.returnUrl).origin,navigation:id});
 if(id!==navigation||s.ws!==ws||!s.armed)return;
 if(result?.ok){s.tabTitle=message.channelName;set('ready',`Ready: ${message.channelName}`);}
 else set('error',result?.error||'The channel did not start. Check its link and sign-in.');
 send({type:'tuned',token:message.token,ok:!!result?.ok,error:result?.error});
}
async function park(){
 const id=navigation=++nextNavigation;stopRecorder();clearStandbyTimer();clearPlayChecks();s.viewers=0;s.wasWatching=false;
 const result=await toWorker({type:'parkPool',tabId:s.tabId,navigation:id,channelNumber});
 if(id!==navigation||!s.armed)return;s.inStandby=!!result?.ok;
 set('ready',result?.ok?'Reusable tab available — player closed.':'Reusable tab available; could not close the previous player.');
}

// ---- Recording while watched ----------------------------------------------
function startRecorder(session) {
  stopRecorder();
  if (!s.stream || !s.ws || s.ws.readyState !== 1) return;
  const mimeType = MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mimeType) { set('error', 'Chrome has no supported video recorder.'); return; }
  let recorder;
  try {
    recorder = new MediaRecorder(s.recordStream ?? s.stream, {mimeType, videoBitsPerSecond: 8000000, audioBitsPerSecond: 160000, videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS});
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
  if (count > 0) { s.wasWatching = true; clearStandbyTimer(); }
  if (pooled || !started || s.tabId === null) return;
  if (s.inStandby) returnFromStandby();
  else if (s.reloadOnWatch) refreshForViewer();
  else if (s.idleAction !== 'none') resumeForViewer();
}

const describeWait = seconds => seconds % 60 === 0 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} seconds`;

// The tuner says this once nobody has been watching for a few seconds (so a
// quick channel change in Plex doesn't interrupt anything).
async function nobodyWatching() {
  s.wasWatching = false;
  stopRecorder();
  clearPlayChecks();
  clearStandbyTimer();
  if (!s.armed || s.tabId === null) return;
  if(pooled){set('ready','Reusable tab ready.');return;}
  if (s.inStandby) { set('ready', STANDBY_MESSAGE); return; }
  if (s.idleAction === 'none') { set('ready', 'Ready. Nobody is watching right now.'); return; }
  const tabId = s.tabId;
  const result = await toWorker({type: 'pauseVideo', tabId});
  if (s.tabId !== tabId || s.viewers > 0 || !s.armed) return;
  if (s.idleAction === 'standby') {
    s.standbyTimer = setTimeout(() => enterStandby(tabId), s.standbySeconds * 1000);
    set('ready', `Nobody is watching${result?.paused ? ' — paused the video' : ''}. Leaving the video page in ${describeWait(s.standbySeconds)} so it stops using one of your streams.`);
  } else if (result?.paused) set('ready', 'Nobody is watching — paused the video. It will play again when someone starts watching.');
  else if (result?.permission === false) set('ready', 'Nobody is watching. Couldn’t pause the video: Tohyee TV wasn’t given permission on this site.');
  else set('ready', 'Nobody is watching. No video was found to pause.');
}

// A channel that is broadcasting but that nobody has watched yet is idle too:
// with several channels, the unwatched tabs would otherwise keep playing and
// keep using the service's streams. Leave the page after the same wait; if
// someone starts watching first, viewersChanged() cancels this.
function idleFromStart() {
  if(pooled){s.standbyTimer=setTimeout(()=>{if(s.viewers===0&&s.state==='ready')park();},2000);return;}
  if (s.idleAction !== 'standby' || s.inStandby || s.viewers > 0 || s.standbyTimer || s.tabId === null) return;
  const tabId = s.tabId;
  s.standbyTimer = setTimeout(() => enterStandby(tabId), s.standbySeconds * 1000);
  set('ready', `Ready. Nobody is watching yet: leaving the video page in ${describeWait(s.standbySeconds)} unless someone starts watching in Plex.`);
}

const STANDBY_MESSAGE = 'Standby — left the video page so it doesn’t use one of your streams. It goes back when someone watches in Plex.';

async function enterStandby(tabId) {
  s.standbyTimer = null;
  if (s.tabId !== tabId || s.viewers > 0 || !s.armed || s.inStandby) return;
  const result = await toWorker({type: 'standbyTab', tabId, channelNumber});
  if (s.tabId !== tabId || !s.armed) return;
  if (!result?.ok) { set('ready', `Nobody is watching, but the video page couldn’t be closed${result?.error ? `: ${result.error}` : ''}.`); return; }
  if (/^https?:/.test(result.url ?? '')) s.returnUrl = result.url; // the page as it is now, if Chrome let us read it
  s.inStandby = true;
  set('ready', STANDBY_MESSAGE);
  if (s.viewers > 0) returnFromStandby(); // someone started watching while we were leaving
}

async function returnFromStandby(manual = false) {
  clearPlayChecks();
  const tabId = s.tabId;
  s.inStandby = false;
  if (!s.returnUrl) { set(s.state, 'Couldn’t go back to the video page because its address wasn’t known. Open it again in the broadcast tab.'); return; }
  const result = await toWorker({type: 'returnTab', tabId, url: s.returnUrl});
  if (s.tabId !== tabId) return;
  if (!result?.ok) { set(s.state, `Couldn’t go back to the video page${result?.error ? `: ${result.error}` : ''}.`); return; }
  if (manual && s.viewers === 0) { set('ready', 'Back on the video page. Ready for Plex.'); return; }
  set(s.state, 'Someone started watching — went back to the video page. Checking it plays…');
  for (const ms of PLAY_CHECKS_MS) s.playTimers.push(setTimeout(() => checkPlaying(tabId, ms === PLAY_CHECKS_MS.at(-1)), ms));
}

function clearStandbyTimer() {
  clearTimeout(s.standbyTimer);
  s.standbyTimer = null;
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
 if (IDLE_ACTIONS.includes(request.idleAction)) { s.idleAction=request.idleAction; if (s.idleAction!=='standby') clearStandbyTimer(); }
 if (Number(request.standbySeconds) > 0) s.standbySeconds=Number(request.standbySeconds);
},
// The standby page's own title isn't the programme's, so keep the last real one.
title(request){if(request.tabId===s.tabId&&!s.inStandby){s.tabTitle=request.title??'';send({type:'status',tabTitle:s.tabTitle});}},
leaveStandby(){ if (s.inStandby) returnFromStandby(true); return snapshot(); }};
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
 else if(request.type==='leaveStandby')respond(c.leaveStandby());
 else respond({...c.snapshot(),captures:[...captures].map(([channelNumber,x])=>({channelNumber,...x.snapshot()}))});
});
