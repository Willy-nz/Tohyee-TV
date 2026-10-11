const el = id => document.getElementById(id);
let busy = false, shownClip = '';
async function send(type) {
  return chrome.runtime.sendMessage({target:'worker',type});
}
function render(data) {
  if(data.error) {el('message').textContent = data.error; return;}
  const active = ['starting','recording','stopping'].includes(data.state);
  el('start').disabled = active || busy;
  el('stop').disabled = !['starting','recording'].includes(data.state);
  el('status').textContent = data.state === 'recording' ? `REC · ${data.elapsed}s / 30s · local only` : ({idle:'Not capturing',starting:'Starting…',stopping:'Finishing clip…',done:'Capture stopped · clip ready',error:'Capture failed'}[data.state] ?? data.state);
  el('status').classList.toggle('live',data.state === 'recording');
  el('message').textContent = data.message;
  el('tracks').textContent = data.videoTracks === undefined ? '' : `Video tracks: ${data.videoTracks} · Audio tracks: ${data.audioTracks} (replay to verify sound)`;
  const url = data.clipUrl ?? '';
  if (url !== shownClip) {
    shownClip = url;
    if(url) el('clip').src = url;
    else {el('clip').removeAttribute('src');el('clip').load();}
  }
  el('clip').hidden = !url; el('clear').hidden = !url;
}
async function act(type) {
  busy = true; el('start').disabled = true;
  try {render(await send(type));}
  catch(error) {el('message').textContent = error.message;}
  finally {busy=false; await poll();}
}
async function poll() {
  if(busy) return;
  try {render(await send('status'));} catch(error) {el('message').textContent = error.message;}
}
el('start').addEventListener('click',()=>act('start'));
el('stop').addEventListener('click',()=>act('stop'));
el('clear').addEventListener('click',()=>act('clear'));
poll();
const polling = setInterval(poll,750);
window.addEventListener('pagehide',()=>clearInterval(polling));
