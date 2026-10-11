const {app,BrowserWindow,Tray,Menu,ipcMain,shell,clipboard,Notification,powerMonitor} = require('electron');
const fs = require('node:fs'); const path = require('node:path'); const {pathToFileURL} = require('node:url');
const {networkInterfaces} = require('node:os');
let win,tray,indicator,runtime,config,configPath,prefs,prefsPath,quitting=false,closing=false;
const logs=[]; let lastLive=false, problem='', mode='chrome', changing=false;
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname,'..');
const icon = path.join(resources,'extension','spitz-32.png');
const extensionPath = path.join(resources,'extension');
const encPath = app.isPackaged ? path.join(resources,'ffmpeg','ffmpeg.exe') : (process.env.FFMPEG || 'ffmpeg');
function log(text){logs.push(`${new Date().toLocaleTimeString()}  ${text}`);if(logs.length>150)logs.shift();}
function addresses(){return Object.values(networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal).map(a=>a.address);}
function snapshot(){return {version:app.getVersion(),...runtime?.status(),problem,mode,port:config.port,lan:prefs.lan,startup:app.getLoginItemSettings().openAtLogin,videoMode:config.videoMode??'auto',addresses:addresses(),extensionPath,logs:[...logs]};}
function show(){win.show();win.focus();}
function notify(title,body){if(Notification.isSupported())new Notification({title,body,icon}).show();}
function refreshTray(){
  const s=runtime?.status();const live=!!s?.connections;
  const active=!!s?.source.connected;
  tray.setToolTip(`Tohyee TV — ${live?'LIVE':active?'Ready for Plex':'Not broadcasting'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:live?'LIVE — sending to Plex':active?'Ready — waiting for Plex':'Not broadcasting',enabled:false},
    {label:'Open Tohyee TV',click:show},
    {label:'Stop broadcasting',enabled:!!runtime,click:()=>runtime.stopBroadcast()},
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
