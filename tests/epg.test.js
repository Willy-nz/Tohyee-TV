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

const fixture=(name,title,id='shared')=>`<tv><channel id="${id}"><display-name>${name}</display-name><icon src="https://example.com/logo.png"/></channel><programme channel="${id}" start="20261107100000 +1300" stop="20261107110000 +1300"><title>${title}</title></programme></tv>`;
const reply=body=>({ok:true,body:(async function*(){yield Buffer.from(body);})()});
const service=url=>url.includes('/sky/')?'sky':url.includes('/tvnz-')?'tvnz':'threenow';
test('Combines all three feeds without colliding IDs and maps website-specific schedules to Plex',async()=>{
 const titles={sky:'Sky news',tvnz:'TVNZ news',threenow:'Three news'};
 const store=new GuideStore({fetchImpl:async url=>reply(fixture('News',titles[service(url)]))});
 await store.refresh();assert.equal(store.status().programmeCount,3);
 assert.deepEqual(store.status().channels.map(c=>c.id),['shared','tvnz:shared','threenow:shared']);
 for(const [i,host] of ['www.skygo.co.nz','www.tvnz.co.nz','www.threenow.co.nz'].entries()){
  const out=store.render({guideEnabled:true,channels:[{channelNumber:String(i+1),channelName:'News',url:`https://${host}/live`,programmeTitle:'Fallback'}]});
  assert.match(out,new RegExp(Object.values(titles)[i]));assert.equal((out.match(/<programme /g)||[]).length,1);
  assert.match(out,new RegExp(`channel="tohyee.${i+1}"`));assert.match(out,/20261107100000 \+1300/);assert.match(out,/logo.png/);
 }
 const ambiguous=store.render({guideEnabled:true,channels:[{channelNumber:'9',channelName:'News',programmeTitle:'Fallback'}]});
 assert.match(ambiguous,/<title lang="en">Fallback/);
});
test('One failed provider retains its own cached schedule while others update, including after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tohyee-multi-guide-'));let second=false;
 try{
  const s=new GuideStore({directory,fetchImpl:async url=>{
   const id=service(url);if(second&&id==='tvnz')throw Error('offline');
   return reply(fixture(id,`${id}-${second?'new':'old'}`));
  }});
  await s.refresh();second=true;await s.refresh();
  assert.match(s.data.channels.get('tvnz:shared').programmes[0],/tvnz-old/);
  assert.match(s.data.channels.get('shared').programmes[0],/sky-new/);
  assert.match(s.data.channels.get('threenow:shared').programmes[0],/threenow-new/);
  assert.match(s.status().error,/tvnz: offline/);assert.equal(s.status().programmeCount,3);
  const reload=new GuideStore({directory});await reload.load();assert.equal(reload.status().programmeCount,3);
  assert.match(reload.data.channels.get('tvnz:shared').programmes[0],/tvnz-old/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('Manual mappings override automatic matches; DUKE aliases match; disabled guide uses placeholders',async()=>{
 const s=new GuideStore({fetchImpl:async url=>reply(fixture(service(url)==='tvnz'?'DUKE':'Other',service(url)))});
 await s.refresh();
 const c={channelNumber:'6',channelName:'TVNZ DUKE',url:'https://www.tvnz.co.nz/live',programmeTitle:'Placeholder'};
 assert.match(s.render({guideEnabled:true,channels:[c]}),/<title>tvnz<\/title>/);
 assert.match(s.render({guideEnabled:true,channels:[{...c,guideId:'shared'}]}),/<title>sky<\/title>/);
 assert.match(s.render({guideEnabled:true,channels:[{...c,guideId:'missing'}]}),/Placeholder/);
 assert.match(s.render({guideEnabled:false,channels:[c]}),/Placeholder/);
});
test('Existing sky.xml cache and unprefixed mappings remain usable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'tohyee-legacy-guide-'));
 try{
  const {writeFile}=await import('node:fs/promises');await writeFile(join(directory,'sky.xml'),xml);
  const s=new GuideStore({directory});await s.load();assert.equal(s.status().programmeCount,1);
  assert.match(s.render({guideEnabled:true,channels:[{channelNumber:'60',channelName:'ESPN',guideId:'espn'}]}),/Game &amp; highlights/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('Invalid provider data cannot replace a valid cache; explicit imports survive refresh',async()=>{
 let invalid=false;const s=new GuideStore({fetchImpl:async url=>reply(invalid&&service(url)==='tvnz'?'<tv>broken':fixture(service(url),service(url)))});
 await s.refresh();await s.import(xml);invalid=true;await s.refresh();
 assert.equal(s.status().programmeCount,4);assert.match(s.status().error,/tvnz:/);
 assert.ok(s.data.channels.has('espn'));assert.ok(s.data.channels.has('tvnz:shared'));
});
