import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const code=fs.readFileSync(new URL('../extension/worker.js',import.meta.url),'utf8');
function harness(){let listener,time=0;const updates=[];let current='https://example.com/start';const chrome={runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},getURL:p=>'chrome-extension://test/'+p},permissions:{contains:async()=>true},tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}},get:async()=>({url:current,status:'complete'}),update:async(id,{url})=>{updates.push(url);current=url;}},scripting:{executeScript:async()=>[{result:{found:true,playing:true,area:100}}]}};vm.runInNewContext(code,{importScripts(){},chrome,URL,Date:{now:()=>time},setTimeout(fn,ms){time+=ms;queueMicrotask(fn);}});return {updates,send:extra=>new Promise(r=>listener({target:'worker',...extra},{id:'test'},r))};}
test('Reusable navigation stays on the authorised website and waits for a playing video',async()=>{const h=harness();const r=await h.send({type:'navigatePool',tabId:1,navigation:1,origin:'https://example.com',url:'https://example.com/espn'});assert.equal(r.ok,true,r.error);assert.deepEqual(h.updates,['https://example.com/espn']);});
test('A tuner cannot navigate a reusable tab to a different origin or a local file',async()=>{for(const url of ['https://other.example/live','file:///secret','http://example.com/live']){const h=harness();const r=await h.send({type:'navigatePool',tabId:1,navigation:1,origin:'https://example.com',url});assert.equal(r.ok,false);assert.deepEqual(h.updates,[]);}});

// Sky Go signs Chrome out: a channel link lands on Sky's sign-in page.
function skyHarness({saved=true,accepts=true,permitted=true,whoIsWatching=false}={}){
 let listener,time=0,signedIn=false,current='https://www.skygo.co.nz/',asking=whoIsWatching;const updates=[],fetches=[],filled=[],picks=[];const session={};
 const chrome={runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},getURL:p=>'chrome-extension://test/'+p},
  permissions:{contains:async({origins})=>permitted||!origins[0].includes('login.sky')},
  storage:{local:{get:async()=>({port:34500})},session:{get:async k=>({[k]:session[k]}),set:async o=>Object.assign(session,o)}},
  tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}},get:async()=>({url:current,status:'complete'}),
   update:async(id,{url})=>{updates.push(url);current=signedIn||!url.includes('/watch-tv/')?url:'https://login.sky.co.nz/login?state=abc';}},
  scripting:{executeScript:async({func,args})=>{
   if(func.name==='fillSignIn'){filled.push(args.slice(0,2));if(accepts){signedIn=true;current='https://www.skygo.co.nz/';asking=whoIsWatching;}return [{result:{ok:true}}];}
   if(func.name==='signInMessage')return [{result:'Wrong email or password.'}];
   if(func.name==='pickProfile'){const r=asking?'Jackie':'';if(asking){picks.push(r);asking=false;}return [{result:r}];}
   return [{result:{found:true,playing:true,area:100}}];}}};
 const ctx=vm.createContext({chrome,URL,fetch:async(url,opts)=>{fetches.push({url,opts});return saved?{ok:true,status:200,json:async()=>({email:'me@example.com',password:'pw'})}:{ok:false,status:404};},
  Date:{now:()=>time},setTimeout(fn,ms){time+=ms;queueMicrotask(fn);}});
 ctx.importScripts=(...names)=>{for(const n of names)if(n==='signin.js')vm.runInContext(fs.readFileSync(new URL('../extension/signin.js',import.meta.url),'utf8'),ctx);};
 vm.runInContext(code,ctx);
 const send=extra=>new Promise(r=>listener({target:'worker',...extra},{id:'test'},r));
 return {updates,fetches,filled,picks,session,send,tune:(n=1)=>send({type:'navigatePool',tabId:1,navigation:n,origin:'https://www.skygo.co.nz',url:'https://www.skygo.co.nz/watch-tv/0001'})};
}
test('A signed-out Sky Go tab signs back in with the saved details, then opens the channel',async()=>{
 const h=skyHarness();const r=await h.tune();
 assert.equal(r.ok,true,r.error);
 assert.equal(JSON.stringify(h.filled),JSON.stringify([['me@example.com','pw']]));
 assert.equal(h.fetches.length,1);
 assert.match(h.fetches[0].url,/^http:\/\/127\.0\.0\.1:34500\/signin\?site=https%3A%2F%2Fwww\.skygo\.co\.nz$/);
 assert.equal(h.fetches[0].opts.headers['X-Tohyee-Extension'],'1');
 assert.deepEqual(h.updates,['https://www.skygo.co.nz/watch-tv/0001','https://www.skygo.co.nz/watch-tv/0001']);
});
test('With no saved sign-in, or no permission for Sky’s sign-in page, it says what to do',async()=>{
 let r=await skyHarness({saved:false}).tune();assert.notEqual(r.ok,true);assert.match(r.error,/Save your Sky Go sign-in in the Tohyee TV app/);
 const h=skyHarness({permitted:false});r=await h.tune();assert.match(r.error,/allow login\.sky\.co\.nz/);assert.equal(h.fetches.length,0);
});
test('A refused sign-in is reported, and not tried again for 10 minutes',async()=>{
 const h=skyHarness({accepts:false});let r=await h.tune();
 assert.match(r.error,/didn’t accept the saved sign-in \(“Wrong email or password\.”\)/);
 r=await h.tune(2);assert.match(r.error,/tried signing in less than 10 minutes ago/);
 assert.equal(h.filled.length,1);
});

test('After signing in, Sky Go’s “Who’s watching?” gets the first profile, then the channel opens',async()=>{
 const h=skyHarness({whoIsWatching:true});const r=await h.tune();
 assert.equal(r.ok,true,r.error);
 assert.equal(JSON.stringify(h.picks),JSON.stringify(['Jackie']));
 assert.equal(h.updates.length,3); // the channel, again after signing in, and again after picking
 assert.ok(h.updates.every(u=>u==='https://www.skygo.co.nz/watch-tv/0001'));
});
