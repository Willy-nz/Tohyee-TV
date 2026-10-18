import {test} from 'node:test';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {GuideStore,parseGuide} from '../tuner/src/epg.js';
const xml=`<?xml version="1.0"?><tv><channel id="espn"><display-name>ESPN &amp; sport</display-name></channel><programme channel="espn" start="20261016100000 +1300" stop="20261016110000 +1300"><title>Game &amp; highlights</title></programme></tv>`;
test('Plain and gzip XMLTV map stable provider IDs to our channel IDs with times preserved',async()=>{for(const bytes of [Buffer.from(xml),gzipSync(xml)]){const store=new GuideStore();await store.import(bytes);assert.equal(store.status().channels[0].name,'ESPN & sport');const out=store.render({guideEnabled:true,channels:[{channelNumber:'8',channelName:'ESPN',guideId:'espn'}]});assert.match(out,/<programme channel="tohyee.8"/);assert.match(out,/20261016110000 \+1300/);assert.match(out,/Game &amp; highlights/);}});
test('Failed or invalid refresh preserves the last good cache across restart',async()=>{const directory=await mkdtemp(join(tmpdir(),'tohyee-epg-'));try{const s=new GuideStore({directory,fetchImpl:async()=>{throw Error('offline');}});await s.import(gzipSync(xml));await s.refresh();assert.equal(s.status().programmeCount,1);assert.match(s.status().error,/offline/);await assert.rejects(()=>s.import(Buffer.from('<tv>broken')));const reload=new GuideStore({directory});await reload.load();assert.equal(reload.status().programmeCount,1);}finally{await rm(directory,{recursive:true,force:true});}});
test('Entity declarations are rejected without resolving external references',()=>{assert.throws(()=>parseGuide(xml.replace('<tv>','<!ENTITY external SYSTEM "file:///secret"><tv>')),/Invalid/);});

test('Channel logos from the guide reach Plex, but only https ones', async () => {
  const withIcons = `<?xml version="1.0"?><tv>
<channel id="skysport1"><display-name>Sky Sport 1</display-name><display-name>51</display-name><icon src="https://img.example.com/ss1.png?w=200&amp;h=200"/></channel>
<channel id="plain"><display-name>Plain</display-name><icon src="http://img.example.com/plain.png"/></channel>
<channel id="nologo"><display-name>No logo</display-name></channel>
<programme channel="skysport1" start="20261016100000 +1300" stop="20261016110000 +1300"><title>Rugby</title></programme>
<programme channel="plain" start="20261016100000 +1300" stop="20261016110000 +1300"><title>Show</title></programme>
<programme channel="nologo" start="20261016100000 +1300" stop="20261016110000 +1300"><title>News</title></programme></tv>`;
  const store = new GuideStore(); await store.import(Buffer.from(withIcons));
  const channels = ['skysport1', 'plain', 'nologo', 'missing'].map((guideId, i) => ({channelNumber: String(51 + i), channelName: `C${i}`, programmeTitle: 'x', guideId}));
  const out = store.render({guideEnabled: true, deviceId: '1234ABCD', channels});
  assert.match(out, /<channel id="tohyee\.51">.*<icon src="https:\/\/img\.example\.com\/ss1\.png\?w=200&amp;h=200"\/><\/channel>/);
  for (const n of [52, 53, 54]) assert.match(out, new RegExp(`<channel id="tohyee\\.${n}"><display-name>[^<]*</display-name><display-name>${n}</display-name></channel>`), `channel ${n} has no logo`);
});
