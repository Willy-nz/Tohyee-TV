import {startRuntime} from '../tuner/src/runtime.js';
import {DEFAULTS} from '../tuner/src/config.js';
import {get} from 'node:http';
import assert from 'node:assert/strict';
const channels=[1,2].map(n=>({channelNumber:String(n),channelName:`Test ${n}`,programmeTitle:`Test ${n}`}));
const runtime=await startRuntime({config:{...DEFAULTS,deviceId:'12345678',listenAddress:'127.0.0.1',port:0,channels},ffmpeg:process.argv[2]||'ffmpeg',testPattern:true,log:console.log});
const requests=[];
function tune(number){return new Promise((resolve,reject)=>{const req=get(`http://127.0.0.1:${runtime.server.address().port}/stream/${number}`,res=>{const state={bytes:0,res};res.on('data',b=>{state.bytes+=b.length;if(state.bytes>1880)resolve(state);});res.on('error',reject);});requests.push(req);req.on('error',reject);req.setTimeout(20000,()=>req.destroy(new Error('Stream timeout')));});}
try{
 const [one,two]=await Promise.all([tune(1),tune(2)]);
 assert.equal(runtime.status().connections,2);
 runtime.stopBroadcast('1');const before=two.bytes;
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Second channel stopped with first')),10000);two.res.once('data',()=>{clearTimeout(t);resolve();});});
 assert.ok(two.bytes>before);assert.equal(runtime.channels.get('1').broadcaster.running,false);assert.equal(runtime.channels.get('2').broadcaster.running,true);
 console.log('Two simultaneous MPEG-TS channels passed; stopping channel 1 preserved channel 2.');
}finally{for(const r of requests)r.destroy();await runtime.close();}
