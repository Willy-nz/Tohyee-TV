import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,validate,channelConfigs} from '../tuner/src/config.js';
import {discover,lineup} from '../tuner/src/hdhr.js';
import {xmltv} from '../tuner/src/guide.js';
import {startRuntime} from '../tuner/src/runtime.js';
const config={...DEFAULTS,deviceId:'12345678',port:0,listenAddress:'127.0.0.1',channels:[{channelNumber:'1',channelName:'First',programmeTitle:'First'},{channelNumber:'2',channelName:'Second & more',programmeTitle:'Second'}]};
test('Old single-channel settings migrate without changing channel identity',()=>{assert.equal(channelConfigs({...DEFAULTS,channelNumber:'7'})[0].channelNumber,'7');});
test('Channel configuration rejects duplicates, empty and oversized lineups',()=>{
 const c={...config,port:34500};assert.deepEqual(validate(c),[]);
 for(const channels of [[],[c.channels[0],c.channels[0]],Array(9).fill(c.channels[0]),[{channelNumber:'x',channelName:'Test',programmeTitle:'Test'}]])assert.ok(validate({...c,channels}).length);
});
test('Plex receives both stream URLs and guide channels before programme entries',()=>{
 assert.equal(discover('http://local',config).TunerCount,2);assert.deepEqual(lineup('http://local',config).map(c=>c.URL),['http://local/stream/1','http://local/stream/2']);
 const xml=xmltv(config);assert.equal((xml.match(/<programme /g)||[]).length,100);assert.ok(xml.lastIndexOf('<channel ')<xml.indexOf('<programme '));assert.match(xml,/Second &amp; more/);
});
test('Runtime routes channels separately and stopping one preserves the other',async()=>{
 const runtime=await startRuntime({config,ffmpeg:'unused'});const base=`http://127.0.0.1:${runtime.server.address().port}`;
 try{
 assert.equal((await (await fetch(base+'/channels.json')).json()).length,2);
 assert.equal((await fetch(base+'/stream/3')).status,404);
 assert.equal((await fetch(base+'/stream/1')).status,503);
 let stopped1=0,stopped2=0;const [one,two]=runtime.channels.values();one.source.stopBroadcast=()=>stopped1++;two.source.stopBroadcast=()=>stopped2++;
 runtime.stopBroadcast('1');assert.equal(stopped1,1);assert.equal(stopped2,0);
 assert.notEqual(one.source,two.source);assert.notEqual(one.broadcaster,two.broadcaster);
 }finally{await runtime.close();}
});
