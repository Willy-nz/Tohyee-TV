import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code = fs.readFileSync(new URL('../chrome-prototype/offscreen.js',import.meta.url),'utf8');
function harness(getMedia) {
  let listener, instance; const timers = new Map(); let nextTimer=0;
  const tracks = [new EventTarget(),new EventTarget()];
  for(const t of tracks) {t.readyState='live';t.stop=()=>{t.readyState='ended';};}
  const media={getTracks:()=>tracks,getAudioTracks:()=>[tracks[1]],getVideoTracks:()=>[tracks[0]]};
  class Recorder {
    static isTypeSupported(){return true;}
    constructor(){instance=this;this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['test'])});this.onstop();});}
  }
  const context = {
    chrome:{runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},sendMessage:async()=>{}}},
    navigator:{mediaDevices:{getUserMedia:getMedia ?? (async()=>media)}},
    MediaRecorder:Recorder,
    AudioContext:class {createMediaStreamSource(){return {connect(){}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}},
    Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}, Date,
    setTimeout(fn,ms){timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout(id){timers.delete(id);}
  };
  vm.runInNewContext(code,context);
  const send = (type,extra={}) => new Promise(resolve=>listener({target:'offscreen',type,...extra},{id:'test'},resolve));
  return {send,tracks,timers,media,recorder:()=>instance};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Chrome capture survives lack of popup polling and stops automatically with replay',async()=>{
  const h=harness();const started=await h.send('start',{id:'opaque'});
  assert.equal(started.state,'recording');assert.equal(started.audioTracks,1);
  const timer=[...h.timers.values()].find(t=>t.ms===30000);assert.ok(timer);
  timer.fn();await tick();
  const done=await h.send('status');assert.equal(done.state,'done');assert.equal(done.clipUrl,'blob:test');
  assert.ok(h.tracks.every(t=>t.readyState==='ended'));
  await h.send('clear');assert.equal((await h.send('status')).clipUrl,'');
});
test('Chrome pending capture cancellation stops late tracks',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));
  const pending=h.send('start',{id:'opaque'});await h.send('stop');resolve(h.media);
  assert.equal((await pending).state,'idle');assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});
test('Chrome recorder failure retains error state and releases tracks',async()=>{
  const h=harness();await h.send('start',{id:'opaque'});h.recorder().onerror();await tick();
  assert.equal((await h.send('status')).state,'error');assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});
test('Chrome browser stop-sharing stops recorder',async()=>{
  const h=harness();await h.send('start',{id:'opaque'});h.tracks[0].dispatchEvent(new Event('ended'));await tick();
  assert.equal((await h.send('status')).state,'done');assert.equal(h.recorder().state,'inactive');
});
