const {app,BrowserWindow,Tray,Menu,ipcMain,shell,clipboard,Notification,powerMonitor} = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const {pathToFileURL} = require('node:url');
const {networkInterfaces} = require('node:os');
const {spawn} = require('node:child_process');
const updates = require('./updates.cjs');
let win,tray,indicator,runtime,config,configPath,prefs,prefsPath,quitting=false,closing=false;
const logs=[]; let lastLive=false, problem='', mode='chrome', changing=false;
// Update check state: status idle | checking | available | current | error
let update={status:'idle'}, upgradedFrom='';
// Update now: null | {state: downloading | installing | error, version, received, total, message}
let install=null;
const canInstall=app.isPackaged&&process.platform==='win32';
const updateDir=()=>path.join(app.getPath('temp'),'tohyee-tv-update');
// Someone on a test build gets newer test builds unless they say otherwise.
const testBuilds=()=>prefs.testBuilds??/-/.test(app.getVersion());
const DAY=24*60*60*1000;
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname,'..');
const icon = path.join(resources,'extension','spitz-32.png');
const extensionPath = path.join(resources,'extension');
const encPath = app.isPackaged ? path.join(resources,'ffmpeg','ffmpeg.exe') : (process.env.FFMPEG || 'ffmpeg');
function log(text){logs.push(`${new Date().toLocaleTimeString()}  ${text}`);if(logs.length>150)logs.shift();}
function addresses(){return Object.values(networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal).map(a=>a.address);}
function snapshot(){return {version:app.getVersion(),update,install,canInstall,updateChecks:prefs.updateChecks!==false,testBuilds:testBuilds(),upgradedFrom,...runtime?.status(),configuredChannels:config.channels??[{channelNumber:config.channelNumber,channelName:config.channelName,programmeTitle:config.programmeTitle}],problem,mode,port:config.port,lan:prefs.lan,startup:app.getLoginItemSettings().openAtLogin,videoMode:config.videoMode??'auto',addresses:addresses(),extensionPath,logs:[...logs]};}
function show(){win.show();win.focus();}
function savePrefs(){fs.writeFileSync(prefsPath,JSON.stringify(prefs,null,2));}
// Checks GitHub for a newer installer. Automatic checks tell the person once
// per new version (a notification they can click); manual checks always report.
async function checkUpdates(manual=false){
  if(update.status==='checking')return;
  if(!manual&&prefs.updateChecks===false)return;
  update={...update,status:'checking'};
  const result=await updates.checkForUpdate({current:app.getVersion(),includeTest:testBuilds()});
  update={...result,checkedAt:new Date().toISOString()};
  if(install?.state==='error'&&install.version!==result.update?.version)install=null;
  if(result.status==='available'){
    log(`Tohyee TV ${result.update.version} is available.`);
    if(prefs.lastNotifiedVersion!==result.update.version&&Notification.isSupported()){
      const note=new Notification({title:`Tohyee TV ${result.update.version} is available`,body:canInstall&&result.update.installer?'Open Tohyee TV and click Update now to install it.':'Click to open the download page.',icon});
      note.on('click',()=>canInstall&&result.update.installer?show():shell.openExternal(result.update.url));note.show();
      prefs.lastNotifiedVersion=result.update.version;savePrefs();
    }
  } else if(result.status==='error'&&manual) log(`Update check: ${result.message}`);
  refreshTray();
}
// Downloads the new installer, checks it, then runs it silently. The installer
// closes this app, upgrades it in place and opens it again.
function installUpdate(){
  if(['downloading','installing'].includes(install?.state))return;
  if(update.status!=='available')throw new Error('There’s no update to install. Click Check now first.');
  if(!canInstall)throw new Error('Updating from the app only works in the installed Windows app.');
  const target=update.update;
  if(!target.installer)throw new Error('This release can’t be installed from the app. Click What’s new to download it.');
  install={state:'downloading',version:target.version,received:0,total:target.installer.size||0};
  log(`Downloading Tohyee TV ${target.version}…`);
  try{fs.rmSync(updateDir(),{recursive:true,force:true});}catch{}
  updates.downloadUpdate({update:target,dir:updateDir(),onProgress:(received,total)=>{install={...install,received,total};}})
    .then(file=>{
      install={...install,state:'installing'};
      log(`Installing Tohyee TV ${target.version}. The app will close and open again by itself.`);
      const child=spawn(file,updates.INSTALL_ARGS,{detached:true,stdio:'ignore'});
      child.once('spawn',()=>{child.unref();setTimeout(()=>app.quit(),500);});
      child.once('error',error=>{install={state:'error',version:target.version,message:`Couldn’t start the installer: ${error.message}`};log(install.message);});
    })
    .catch(error=>{install={state:'error',version:target.version,message:error.message};log(`Update: ${error.message}`);});
}
function openUpdate(){if(update.status==='available'&&updates.isReleasePage(update.update.url))return shell.openExternal(update.update.url);}
function notify(title,body){if(Notification.isSupported())new Notification({title,body,icon}).show();}
function refreshTray(){
  const s=runtime?.status();const live=!!s?.connections;
  const active=!!s?.source.connected;
  tray.setToolTip(`Tohyee TV — ${live?'LIVE':active?'Ready for Plex':'Not broadcasting'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:live?'LIVE — sending to Plex':active?'Ready — waiting for Plex':'Not broadcasting',enabled:false},
    {label:'Open Tohyee TV',click:show},
    {label:'Stop broadcasting',enabled:!!runtime,click:()=>runtime.stopBroadcast()},
    ...(update.status==='available'?[{type:'separator'},{label:`Update available: ${update.update.version}…`,click:canInstall&&update.update.installer?show:openUpdate}]:[]),
    {type:'separator'},{label:'Quit Tohyee TV',click:()=>app.quit()}
  ]));
  if(live){indicator.showInactive();if(!lastLive)notify('Tohyee TV is broadcasting','The selected source is being sent to Plex. Use Stop to end it.');}
  else indicator.hide();
  lastLive=live;
}
async function start(test=false){
  problem='';mode=test?'test':'chrome';
  try{
    const {startRuntime}=await import(pathToFileURL(path.join(resources,'tuner/src/runtime.js')).href);
    runtime=await startRuntime({config,ffmpeg:encPath,log,testPattern:test});
    log(test?'Test picture is ready.':'Tuner is ready. Choose a tab in Chrome to broadcast.');
  }catch(error){problem=error.code==='EADDRINUSE'?'The tuner port is already in use. Close the old tuner and click Restart tuner.':error.message;log(problem);}
}
async function restart(test=false){
  if(changing)throw new Error('Please wait for the current change.');
  changing=true;
  try{const old=runtime;runtime=null;if(old)await old.close();await start(test);}finally{changing=false;}
  return snapshot();
}
function trusted(event){if(![win?.webContents,indicator?.webContents].includes(event.sender))throw new Error('Unknown caller');}
ipcMain.handle('status',event=>{trusted(event);return snapshot();});
ipcMain.handle('action',async(event,name,value)=>{
  trusted(event);
  switch(name){
    case 'stop':runtime?.stopBroadcast();break;
    case 'stopChannel':runtime?.stopBroadcast(String(value));break;
    case 'channels': {
      const {validate}=await import(pathToFileURL(path.join(resources,'tuner/src/config.js')).href);
      const next={...config,channels:value};const errors=validate(next);if(errors.length)throw new Error(errors.join('; '));
      fs.writeFileSync(configPath,JSON.stringify(next,null,2));config=next;await restart();break;
    }
    case 'restart':return restart(false);
    case 'test':return restart(true);
    case 'show':show();break;
    case 'startup':prefs.startup=!!value;app.setLoginItemSettings({openAtLogin:prefs.startup,args:['--hidden']});break;
    case 'network':prefs.lan=!!value;config.listenAddress=prefs.lan?'0.0.0.0':'127.0.0.1';fs.writeFileSync(configPath,JSON.stringify(config,null,2));await restart();break;
    case 'encoding':if(!['auto','encode'].includes(value))throw new Error('Unknown quality mode');config.videoMode=value;fs.writeFileSync(configPath,JSON.stringify(config,null,2));await restart();break;
    case 'extension':await shell.openPath(extensionPath);break;
    case 'chrome':clipboard.writeText('chrome://extensions');break;
    case 'plex':await shell.openExternal('https://app.plex.tv/desktop/');break;
    case 'guideHelp':await shell.openExternal('https://support.plex.tv/articles/using-an-xmltv-guide/');break;
    case 'copy':{
      const hosts=['127.0.0.1',...addresses()];if(!hosts.includes(value.host))throw new Error('Unknown address');
      clipboard.writeText(`http://${value.host}:${config.port}${value.guide?'/guide.xml':''}`);break;
    }
    case 'licences':await shell.openPath(path.join(resources,'ffmpeg'));break;
    case 'checkUpdates':await checkUpdates(true);break;
    case 'openUpdate':await openUpdate();break;
    case 'installUpdate':installUpdate();break;
    case 'updateChecks':prefs.updateChecks=!!value;if(prefs.updateChecks)checkUpdates();break;
    case 'testBuilds':prefs.testBuilds=!!value;await checkUpdates(true);break;
    case 'dismissUpgrade':upgradedFrom='';break;
    default:throw new Error('Unknown action');
  }
  fs.writeFileSync(prefsPath,JSON.stringify(prefs,null,2));refreshTray();return snapshot();
});
function secureWindow(window){
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',()=>{if(win)show();});
  app.whenReady().then(async()=>{
    app.setAppUserModelId('nz.tohyee.tv');
    prefsPath=path.join(app.getPath('userData'),'desktop.json');
    try{prefs=JSON.parse(fs.readFileSync(prefsPath,'utf8'));}catch{prefs={lan:false,startup:false};}
    // After an upgrade, remind the person to reload the Chrome extension (Chrome
    // keeps running the old copy until they do). Not shown on a fresh install.
    if(prefs.lastRunVersion&&prefs.lastRunVersion!==app.getVersion())upgradedFrom=prefs.lastRunVersion;
    if(upgradedFrom)try{fs.rmSync(updateDir(),{recursive:true,force:true});}catch{} // the installer that was just used
    prefs.lastRunVersion=app.getVersion();fs.writeFileSync(prefsPath,JSON.stringify(prefs,null,2));
    const {loadConfig}=await import(pathToFileURL(path.join(resources,'tuner/src/config.js')).href);
    configPath=path.join(app.getPath('userData'),'tuner.json');
    config=loadConfig(configPath);config.listenAddress=prefs.lan?'0.0.0.0':'127.0.0.1';
    config.ffmpegPath=encPath;fs.writeFileSync(configPath,JSON.stringify(config,null,2));
    win=new BrowserWindow({width:1040,height:800,minWidth:780,minHeight:600,show:false,backgroundColor:'#17181c',icon,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    secureWindow(win);await win.loadFile(path.join(__dirname,'index.html'));
    win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();if(!prefs.explainedTray){notify('Tohyee TV is still running','Use the Spitz tray icon to open the app or quit.');prefs.explainedTray=true;fs.writeFileSync(prefsPath,JSON.stringify(prefs));}}});
    indicator=new BrowserWindow({width:285,height:64,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,backgroundColor:'#77283b',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    secureWindow(indicator);indicator.setContentProtection(true);await indicator.loadFile(path.join(__dirname,'indicator.html'));
    const {screen}=require('electron');const area=screen.getPrimaryDisplay().workArea;indicator.setPosition(area.x+area.width-305,area.y+20);
    indicator.on('close',event=>{if(!quitting){event.preventDefault();indicator.hide();}});
    tray=new Tray(icon);tray.on('double-click',show);
    await start();refreshTray();setInterval(refreshTray,1000).unref();
    if(upgradedFrom)notify(`Tohyee TV updated to ${app.getVersion()}`,'Reload the Tohyee TV extension at chrome://extensions so Chrome uses the new version.');
    setTimeout(()=>checkUpdates(),10000).unref();setInterval(()=>checkUpdates(),DAY).unref();
    powerMonitor.on('lock-screen',()=>runtime?.stopBroadcast());
    powerMonitor.on('suspend',()=>runtime?.stopBroadcast());
    if(!process.argv.includes('--hidden')||problem)show();
  }).catch(error=>{require('electron').dialog.showErrorBox('Tohyee TV could not start',error.message);app.quit();});
  app.on('window-all-closed',()=>{});
  app.on('before-quit',event=>{
    if(closing)return;
    event.preventDefault();quitting=true;closing=true;
    Promise.race([runtime?.close(),new Promise(r=>setTimeout(r,1500))]).finally(()=>app.quit());
  });
}
