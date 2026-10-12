const $=id=>document.getElementById(id);let state={},busy=false,editorLoaded=false;
function page(name){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===name));window.scrollTo(0,0);}
function addresses(){const host=$('host').value||'127.0.0.1';$('tunerAddress').textContent=`http://${host}:${state.port}`;$('guideAddress').textContent=`http://${host}:${state.port}/guide.xml`;}
function render(s){state=s;$('version').textContent=`Version ${s.version} · Windows test build`;
 $('notice').hidden=!s.problem;if(s.problem)$('notice').textContent=s.problem;
 $('status').textContent=!s.running?'Tuner stopped':s.connections?'● LIVE · Sending to Plex':s.source?.connected?'Ready · Waiting for Plex':'Not broadcasting';$('status').classList.toggle('live',!!s.connections);
 $('source').textContent=s.mode==='test'?'Built-in test picture':`${s.channels?.length||1} channel(s) configured`;renderChannelStatus(s);if(!editorLoaded){editChannels(s.configuredChannels);editorLoaded=true;}
 $('detail').textContent=s.source?.message||'Open the Chrome extension on your chosen tab to begin.';
 $('connections').textContent=s.connections||0;$('encoding').textContent=s.encoding||'Waiting';$('logs').textContent=s.logs.join('\n');
 if(!busy){$('startup').checked=s.startup;$('lan').checked=s.lan;$('videoMode').value=s.videoMode;}
 const hosts=s.lan?s.addresses:['127.0.0.1'];if(!hosts.length)hosts.push('127.0.0.1');const old=$('host').value;
 if(JSON.stringify([...$('host').options].map(o=>o.value))!==JSON.stringify(hosts)){$('host').replaceChildren(...hosts.map(h=>new Option(h,h)));if(hosts.includes(old))$('host').value=old;}
 addresses();
}
async function action(name,value){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{render(await window.tohyee.action(name,value));}catch(e){$('notice').hidden=false;$('notice').textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action)));
$('startup').addEventListener('change',()=>action('startup',$('startup').checked));$('lan').addEventListener('change',()=>action('network',$('lan').checked));$('videoMode').addEventListener('change',()=>action('encoding',$('videoMode').value));$('host').addEventListener('change',addresses);
$('copyTuner').addEventListener('click',()=>action('copy',{host:$('host').value,guide:false}));$('copyGuide').addEventListener('click',()=>action('copy',{host:$('host').value,guide:true}));
async function poll(){if(!busy)try{render(await window.tohyee.status());}catch(e){$('notice').hidden=false;$('notice').textContent=e.message;}}
poll();setInterval(poll,1000);


function renderChannelStatus(s){
 const rows=(s.channels??[]).map(c=>{const row=document.createElement('div');row.className='channel-status';const text=document.createElement('p');text.textContent=`${c.channelNumber} — ${c.channelName}: ${c.connections?'LIVE · '+c.connections+' connection(s)':s.mode==='test'?'Test picture ready':c.source?.connected?'Ready':'Needs a tab'}${c.source?.tabTitle?' · '+c.source.tabTitle:''} · ${c.encoding}`;row.append(text);const stop=document.createElement('button');stop.textContent='Stop this channel';stop.className='secondary';stop.disabled=busy;stop.onclick=()=>action('stopChannel',c.channelNumber);row.append(stop);return row;});$('channelStatus').replaceChildren(...rows);
}
function addChannelRow(c){const row=document.createElement('div');row.className='channel-row';for(const [key,label] of [['channelNumber','Number'],['channelName','Channel name']]){const input=document.createElement('input');input.value=c[key]??'';input.dataset.key=key;input.placeholder=label;input.setAttribute('aria-label',label);input.maxLength=key==='channelNumber'?8:60;row.append(input);}const remove=document.createElement('button');remove.textContent='Remove';remove.className='secondary';remove.onclick=()=>row.remove();row.append(remove);$('channelEditor').append(row);}
function editChannels(channels){$('channelEditor').replaceChildren();for(const c of channels??[])addChannelRow(c);}
$('addChannel').onclick=()=>{const rows=[...$('channelEditor').children];if(rows.length>=8){$('channelSaveStatus').textContent='Maximum eight channels.';return;}const used=rows.map(r=>r.querySelector('input').value);let n=1;while(used.includes(String(n)))n++;addChannelRow({channelNumber:String(n),channelName:`Channel ${n}`});};
$('saveChannels').onclick=async()=>{const channels=[...$('channelEditor').children].map(row=>{const c=Object.fromEntries([...row.querySelectorAll('input')].map(i=>[i.dataset.key,i.value.trim()]));return {...c,programmeTitle:c.channelName};});await action('channels',channels);$('channelSaveStatus').textContent=JSON.stringify(state.configuredChannels)===JSON.stringify(channels)?'Saved. Reconnect each Chrome tab and rescan channels in Plex.':'Not saved. Check the error above.';};
