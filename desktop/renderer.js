const $=id=>document.getElementById(id);let state={},busy=false;
function page(name){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==name);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.page===name));window.scrollTo(0,0);}
function addresses(){const host=$('host').value||'127.0.0.1';$('tunerAddress').textContent=`http://${host}:${state.port}`;$('guideAddress').textContent=`http://${host}:${state.port}/guide.xml`;}
function render(s){state=s;$('version').textContent=`Version ${s.version} · Windows test build`;
 $('notice').hidden=!s.problem;if(s.problem)$('notice').textContent=s.problem;
 $('status').textContent=!s.running?'Tuner stopped':s.connections?'● LIVE · Sending to Plex':s.source?.connected?'Ready · Waiting for Plex':'Not broadcasting';$('status').classList.toggle('live',!!s.connections);
 $('source').textContent=s.mode==='test'?'Built-in test picture':s.source?.tabTitle||'Choose a tab in Chrome';
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
