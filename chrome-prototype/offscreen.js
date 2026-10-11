let state = 'idle', message = 'Ready.', stream, recorder, output, timer, expiry;
let clipUrl = '', started = 0, bytes = 0, chunks = [], generation = 0;
let audioTracks = 0, videoTracks = 0;
function notify() {
  chrome.runtime.sendMessage({target:'worker',type:'badge',state}).catch(() => {});
}
function snapshot() {
  return {state,message,clipUrl,audioTracks,videoTracks,elapsed: started ? Math.min(30,Math.floor((Date.now()-started)/1000)) : 0};
}
function releaseTracks() {
  clearTimeout(timer);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  output?.close().catch(() => {});
  output = null;
}
function clearClip() {
  clearTimeout(expiry);
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = '';
}
function stop() {
  generation++;
  if (recorder?.state === 'recording') {
    if (state !== 'error') state = 'stopping';
    recorder.stop();
    releaseTracks();
  } else {
    releaseTracks();
    if (state === 'starting') {state = 'idle'; message = 'Capture cancelled.';}
  }
  notify();
  return snapshot();
}
async function start(id) {
  if (['starting','recording','stopping'].includes(state)) throw new Error('A test is already running.');
  clearClip();
  chunks = []; bytes = 0; audioTracks = 0; videoTracks = 0; started = 0;
  const token = ++generation;
  state = 'starting'; message = 'Starting selected-tab capture…'; notify();
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:id}},
      video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:id,maxFrameRate:30,maxWidth:1920,maxHeight:1080}}
    });
    if (token !== generation) { media.getTracks().forEach(t => t.stop()); return snapshot(); }
    stream = media;
    audioTracks = media.getAudioTracks().length;
    videoTracks = media.getVideoTracks().length;
    if (!videoTracks) throw new Error('No video track was returned.');
    // Tab capture diverts the tab's audio. Restore local listening explicitly.
    if (audioTracks) {
      output = new AudioContext();
      output.createMediaStreamSource(media).connect(output.destination);
      output.resume().catch(() => {});
    }
    const mimeType = ['video/webm;codecs=vp8,opus','video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('No supported WebM recorder is available.');
    recorder = new MediaRecorder(media,{mimeType,videoBitsPerSecond:2500000,audioBitsPerSecond:128000});
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      bytes += event.data.size;
      if (bytes > 32 * 1024 * 1024) {
        message = 'Stopped at the 32 MB test limit.';
        stop();
        return;
      }
      chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseTracks();
      const blob = new Blob(chunks,{type:mimeType}); chunks = []; recorder = null;
      if (blob.size) {
        clipUrl = URL.createObjectURL(blob);
        if (state !== 'error') {state = 'done'; message = 'Test finished. Replay the clip to check picture and sound.';}
        expiry = setTimeout(() => {clearClip(); if(state === 'done') {state='idle';message='Test clip expired after 10 minutes.';notify();}},600000);
      } else {state = 'error'; message = 'No recorded data was returned.';}
      notify();
    };
    recorder.onerror = () => {state='error';message='Recording failed. Try an ordinary unprotected video first.';stop();};
    media.getVideoTracks()[0].addEventListener('ended',stop);
    recorder.start(1000);
    started = Date.now(); state = 'recording';
    message = 'Recording locally for 30 seconds. Switch tabs or minimise Chrome now.';
    timer = setTimeout(stop,30000); notify();
  } catch(error) {
    if (token !== generation) return snapshot();
    releaseTracks(); state = 'error'; message = error.message || 'Capture failed.'; notify();
  }
  return snapshot();
}
chrome.runtime.onMessage.addListener((request,sender,respond) => {
  if (request.target !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  if (request.type === 'start') { start(request.id).then(respond,error=>respond({error:error.message})); return true; }
  if (request.type === 'stop') stop();
  if (request.type === 'clear' && !['starting','recording','stopping'].includes(state)) {clearClip();state='idle';message='Test clip deleted.';notify();}
  respond(snapshot());
});
