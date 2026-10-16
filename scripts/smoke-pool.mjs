// Real HTTP, WebSocket and FFmpeg, with browser capture/navigation simulated.
import vm from 'node:vm';import fs from 'node:fs';import {spawn} from 'node:child_process';import {get} from 'node:http';import assert from 'node:assert/strict';
import {startRuntime} from '../tuner/src/runtime.js';import {DEFAULTS} from '../tuner/src/config.js';
const ffmpeg=process.argv[2]||'ffmpeg',children=new Set(),requests=[];
const config={...DEFAULTS,port:0,listenAddress:'127.0.0.1',deviceId:'12345678',captureMode:'pool',tabCount:3,channels:Array.from({length:4},(_,i)=>({channelNumber:String(i+1),channelName:'Test '+(i+1),programmeTitle:'Test',url:'https://example.com/'+i}))};
const runtime=await startRuntime({config,ffmpeg,log:console.log});const port=runtime.server.address().port;
class Socket extends WebSocket{constructor(url){super(url,{headers:{Origin:'chrome-extension://pool-smoke'}});}}
class Recorder{
 static isTypeSupported(t){return t==='video/webm;codecs=h264,opus';}
 constructor(){this.state='inactive';}
 start(){this.state='recording';this.child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=550:sample_rate=48000','-c:v','libx264','-preset','ultrafast','-g','30','-c:a','aac','-f','matroska','-cluster_time_limit','250','pipe:1'],{windowsHide:true});children.add(this.child);this.child.stdout.on('data',d=>this.ondataavailable?.({data:new Blob([d])}));this.child.stderr.on('data',d=>console.log(String(d)));this.child.on('exit',()=>children.delete(this.child));}
 stop(){this.state='inactive';this.child?.kill('SIGKILL');}
}
let listener;const code=fs.readFileSync(new URL('../extension/offscreen.js',import.meta.url),'utf8');
vm.runInNewContext(code,{chrome:{runtime:{id:'test',getManifest:()=>({version:'test'}),onMessage:{addListener(fn){listener=fn;}},sendMessage:async m=>['navigatePool','parkPool'].includes(m.type)?{ok:true}:undefined}},navigator:{mediaDevices:{getUserMedia:async()=>{const t=new EventTarget();t.stop=()=>{};return {getTracks:()=>[t],getAudioTracks:()=>[],getVideoTracks:()=>[t]};}}},MediaRecorder:Recorder,WebSocket:Socket,Blob,URL,setTimeout,clearTimeout,console});
const send=(type,extra={})=>new Promise(r=>listener({target:'offscreen',type,...extra},{id:'test'},r));
const until=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>20000)throw Error('Timed out');await new Promise(r=>setTimeout(r,25));}};
function tune(number){return new Promise((resolve,reject)=>{const req=get(`http://127.0.0.1:${port}/stream/${number}`,res=>{if(res.statusCode!==200){res.resume();reject(Error('HTTP '+res.statusCode));return;}let bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>1880)resolve(res);});res.on('error',()=>{});});requests.push(req);req.on('error',reject);req.setTimeout(20000,()=>req.destroy(Error('Media timeout')));});}
try{
 for(let i=1;i<=3;i++)await send('arm',{channelNumber:'@'+i,streamId:'test',tabId:i,tabUrl:'https://example.com/live',port});await until(()=>runtime.pool.status().every(s=>s.connected));
 const viewers=await Promise.all([tune(1),tune(2),tune(3)]);await tune(1);assert.equal(runtime.pool.status().filter(s=>s.channelNumber).length,3);
 const blocked=await fetch(`http://127.0.0.1:${port}/stream/4`);assert.equal(blocked.status,503);
 runtime.stopBroadcast('1');await tune(4);assert.equal(runtime.pool.status().filter(s=>s.channelNumber).length,3);assert.equal(runtime.channels.get('2').broadcaster.clients.size,1);
 console.log('PASS: three real streams; shared channel; fourth refused; released tab retuned without interrupting other channels.');
}finally{for(const r of requests)r.destroy();await send('disarmAll');for(const child of children)child.kill('SIGKILL');await runtime.close();}
