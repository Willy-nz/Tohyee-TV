import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validate, DEFAULTS} from '../tuner/src/config.js';
const window={};
vm.runInNewContext(fs.readFileSync(new URL('../desktop/freeview-channels.js',import.meta.url),'utf8'),{window});
const presets=Object.values(window.FREEVIEW_CHANNELS).flat();
test('Adding browser presets preserves Sky channels, allocates spare numbers, and is repeatable',()=>{
 const existing=[{channelNumber:'4',channelName:'Sky Open',url:'https://www.skygo.co.nz/watch-tv/0101',guideId:'skyopen',programmeTitle:'Sky Open'},{channelNumber:'1000',channelName:'Custom',programmeTitle:'Custom',url:''}];
 const result=window.mergeBrowserPresets(existing,presets);
 assert.equal(JSON.stringify(result.channels.slice(0,2)),JSON.stringify(existing));
 assert.equal(result.added,8);assert.equal(result.renumbered,1);
 assert.equal(result.channels.find(c=>c.channelName==='Bravo').channelNumber,'1001');
 assert.equal(window.mergeBrowserPresets(result.channels,presets).added,0);
 assert.deepEqual(validate({...DEFAULTS,deviceId:'1234ABCD',channels:result.channels}),[]);
});
test('Preset import respects the 200-channel limit without removing user rows',()=>{
 const existing=Array.from({length:199},(_,i)=>({channelNumber:String(i+1),channelName:'Custom '+i,url:''}));
 const r=window.mergeBrowserPresets(existing,presets);
 assert.equal(r.channels.length,200);assert.equal(r.added,1);assert.equal(existing.length,199);
});
