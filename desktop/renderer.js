const $=id=>document.getElementById(id);let state={},busy=false,editorLoaded=false;
function page(name){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===name));window.scrollTo(0,0);}
function addresses(){const host=$('host').value||'127.0.0.1';$('tunerAddress').textContent=`http://${host}:${state.port}`;$('guideAddress').textContent=`http://${host}:${state.port}/guide.xml`;}
function render(s){state=s;$('version').textContent=`Version ${s.version}${/-/.test(s.version)?' · test build':''}`;renderUpdates(s);
 $('notice').hidden=!s.problem;if(s.problem)$('notice').textContent=s.problem;
 $('status').textContent=!s.running?'Tuner stopped':s.connections?'● LIVE · Sending to Plex':s.source?.connected?'Ready · Waiting for Plex':'Not broadcasting';$('status').classList.toggle('live',!!s.connections);
 $('source').textContent=s.mode==='test'?'Built-in test picture':`${s.channels?.length||1} channel(s) configured`;renderChannelStatus(s);renderPool(s);if(!editorLoaded){editChannels(s.configuredChannels);editorLoaded=true;}
 $('detail').textContent=s.source?.message||'Open the Chrome extension on your chosen tab to begin.';
 $('connections').textContent=s.connections||0;$('encoding').textContent=s.encoding||'Waiting';$('logs').textContent=s.logs.join('\n');
 if(!busy){$('startup').checked=s.startup;$('lan').checked=s.lan;$('videoMode').value=s.videoMode;$('updateChecks').checked=s.updateChecks;$('testBuilds').checked=s.testBuilds;}
 const hosts=s.lan?s.addresses:['127.0.0.1'];if(!hosts.length)hosts.push('127.0.0.1');const old=$('host').value;
 if(JSON.stringify([...$('host').options].map(o=>o.value))!==JSON.stringify(hosts)){$('host').replaceChildren(...hosts.map(h=>new Option(h,h)));if(hosts.includes(old))$('host').value=old;}
 addresses();
}
async function action(name,value){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{render(await window.tohyee.action(name,value));}catch(e){$('notice').hidden=false;$('notice').textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action)));
$('startup').addEventListener('change',()=>action('startup',$('startup').checked));$('lan').addEventListener('change',()=>action('network',$('lan').checked));$('videoMode').addEventListener('change',()=>action('encoding',$('videoMode').value));$('host').addEventListener('change',addresses);$('updateChecks').addEventListener('change',()=>action('updateChecks',$('updateChecks').checked));$('testBuilds').addEventListener('change',()=>action('testBuilds',$('testBuilds').checked));
$('copyTuner').addEventListener('click',()=>action('copy',{host:$('host').value,guide:false}));$('copyGuide').addEventListener('click',()=>action('copy',{host:$('host').value,guide:true}));
async function poll(){if(!busy)try{render(await window.tohyee.status());}catch(e){$('notice').hidden=false;$('notice').textContent=e.message;}}
poll();setInterval(poll,1000);


function renderChannelStatus(s){
 const rows=(s.channels??[]).map(c=>{const row=document.createElement('div');row.className='channel-status';const text=document.createElement('p');text.textContent=`${c.channelNumber} — ${c.channelName}: ${c.connections?'LIVE · '+c.connections+' connection(s)':s.mode==='test'?'Test picture ready':c.source?.connected?'Ready':'Needs a tab'}${c.source?.tabTitle?' · '+c.source.tabTitle:''} · ${c.encoding}`;row.append(text);const stop=document.createElement('button');stop.textContent='Stop this channel';stop.className='secondary';stop.disabled=busy;stop.onclick=()=>action('stopChannel',c.channelNumber);row.append(stop);return row;});$('channelStatus').replaceChildren(...rows);
}
function addChannelRow(c){const row=document.createElement('div');row.className='channel-row';for(const [key,label] of [['channelNumber','Number'],['channelName','Channel name'],['url','Video page address (https://…)']]){const input=document.createElement('input');input.value=c[key]??'';input.dataset.key=key;input.placeholder=label;input.setAttribute('aria-label',label);input.maxLength=key==='channelNumber'?8:key==='url'?2048:60;row.append(input);}const mapping=document.createElement('select');mapping.dataset.key='guideId';mapping.setAttribute('aria-label','Programme guide match');row.append(mapping);fillGuideOptions(mapping,c.guideId||'');const remove=document.createElement('button');remove.textContent='Remove';remove.className='secondary';remove.onclick=()=>row.remove();row.append(remove);$('channelEditor').append(row);}
function editChannels(channels){$('channelEditor').replaceChildren();for(const c of channels??[])addChannelRow(c);}
$('addChannel').onclick=()=>{const rows=[...$('channelEditor').children];if(rows.length>=200){$('channelSaveStatus').textContent='Maximum 200 channels.';return;}const used=rows.map(r=>r.querySelector('input').value);let n=1;while(used.includes(String(n)))n++;addChannelRow({channelNumber:String(n),channelName:`Channel ${n}`});};
$('saveChannels').onclick=async()=>{const channels=[...$('channelEditor').children].map(row=>{const c=Object.fromEntries([...row.querySelectorAll('[data-key]')].map(i=>[i.dataset.key,i.value.trim()]));return {...c,programmeTitle:c.channelName};});await action('channels',channels);$('channelSaveStatus').textContent=JSON.stringify(state.configuredChannels)===JSON.stringify(channels)?'Saved. Reconnect each Chrome tab and rescan channels in Plex.':'Not saved. Check the error above.';};

function renderUpdates(s){
 const u=s.update||{status:'idle'};
 $('updateBanner').hidden=u.status!=='available';
 const i=s.install, mb=n=>(n/1048576).toFixed(0), installable=s.canInstall&&!!u.update?.installer;
 if(u.status==='available'){
  const name=`Tohyee TV ${u.update.version}${u.update.prerelease?' (test build)':''}`;
  $('updateText').textContent=i?.state==='downloading'?`Downloading ${name}… ${i.total?`${Math.floor(i.received/i.total*100)}% (${mb(i.received)} of ${mb(i.total)} MB)`:`${mb(i.received)} MB`}`
   :i?.state==='installing'?`Installing ${name}. Tohyee TV will close and open again by itself.`
   :i?.state==='error'?`Couldn’t update to ${name}: ${i.message}`
   :`${name} is available. You have ${s.version}.`;
  const working=['downloading','installing'].includes(i?.state);
  $('installUpdate').hidden=!installable||working;
  $('installUpdate').textContent=i?.state==='error'?'Try again':'Update now';
  $('updateNote').hidden=!installable||working;
  $('updateNote').textContent=s.source?.connected?'Updating stops your broadcasts. Click Broadcast again in each Chrome tab once it reopens.':'Tohyee TV will close for a moment, update and open again.';
 }
 $('upgradeBanner').hidden=!s.upgradedFrom;
 if(s.upgradedFrom)$('upgradeText').textContent=`Updated from ${s.upgradedFrom} to ${s.version}. Reload the Tohyee TV extension at chrome://extensions (click its reload arrow) so Chrome uses the new version.`;
 const when=u.checkedAt?` Last checked ${new Date(u.checkedAt).toLocaleString()}.`:'';
 $('updateStatus').textContent={idle:'Not checked yet.',checking:'Checking…',current:`You have the latest version.${when}`,available:`Version ${u.update?.version} is available.${when}`,error:`Couldn’t check: ${u.message}${when}`}[u.status]||'';
}

let guideSignature='',captureDirty=false;
$('captureMode').onchange=()=>captureDirty=true;
$('tabCount').oninput=()=>captureDirty=true;
function fillGuideOptions(select,value){select.replaceChildren(new Option('No guide match',''),...(state.guide?.channels??[]).map(c=>new Option(c.name,c.id)));if(value&&![...select.options].some(o=>o.value===value))select.add(new Option('Saved mapping: '+value,value));select.value=value;}
function renderPool(s){
 if(!busy&&!captureDirty&&document.activeElement!==$('captureMode'))$('captureMode').value=s.captureMode;
 if(!busy&&!captureDirty&&document.activeElement!==$('tabCount'))$('tabCount').value=s.tabCount;
 if(!busy)$('guideEnabled').checked=s.guideEnabled;
 $('poolStatus').textContent=s.slots?.map(x=>`Tab ${x.id}: ${x.connected?(x.channelName||'Available'):'Not armed'}`).join(' · ')||'Dedicated tabs';
 const g=s.guide??{};$('guideStatus').textContent=g.busy?'Downloading guide…':`${g.programmeCount||0} programmes. ${g.updatedAt?'Updated '+new Date(g.updatedAt).toLocaleString()+'. ':''}${g.through?'Listings through '+g.through+'. ':''}${g.error?'Refresh failed: '+g.error+' (cached data retained).':''}`;
 const signature=JSON.stringify(g.channels??[]);if(signature!==guideSignature){guideSignature=signature;for(const select of document.querySelectorAll('#channelEditor select'))fillGuideOptions(select,select.value);}
}
$('saveCapture').onclick=async()=>{const value={mode:$('captureMode').value,count:Number($('tabCount').value)};await action('captureSettings',value);if(state.captureMode===value.mode&&state.tabCount===value.count)captureDirty=false;};
$('guideEnabled').onchange=()=>action('guideEnabled',$('guideEnabled').checked);
$('addGuideChannels').onclick=()=>{const rows=[...$('channelEditor').children],mapped=new Set(rows.map(r=>r.querySelector('select').value)),used=new Set(rows.map(r=>r.querySelector('input').value));let n=1;for(const g of state.guide?.channels??[]){if(mapped.has(g.id)||$('channelEditor').children.length>=200)continue;while(used.has(String(n)))n++;addChannelRow({channelNumber:String(n),channelName:g.name.slice(0,60),url:'',guideId:g.id});used.add(String(n));} $('channelSaveStatus').textContent='Review the channels, add their live-page links, then Save channels.';};
