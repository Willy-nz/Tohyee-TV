import {TabPool} from './pool.js';
import {channelConfigs} from './config.js';
import {spawn} from 'node:child_process';
import {SourceHub} from './source.js';
import {Broadcaster} from './broadcaster.js';
import {createTunerServer} from './server.js';
import {testPatternArgs} from './ffmpeg.js';
import {sourceEncoder} from './media.js';

export async function startRuntime({config, ffmpeg, log = () => {}, testPattern = false, guide}) {
  const channels = new Map();
  const pool=config.captureMode==='pool'&&!testPattern?new TabPool({count:config.tabCount??3,log}):null;
  for (const channel of channelConfigs(config)) {
  const channelLog = text=>log(`[${channel.channelNumber} ${channel.channelName}] ${text}`);
  const source = testPattern ? null : (pool?pool.source(channel):new SourceHub({log:channelLog}));
  let forceEncode = config.videoMode === 'encode', mode = 'Waiting for source', copying = false;
  const broadcaster = new Broadcaster({log:channelLog,
    onViewers:count=>source?.setViewers(count), onEncoderStop:()=>source?.detach(),
    // Passthrough needs Chrome to send regular keyframes (the extension asks for
    // one every 2 s). If pictures keep arriving without one, Plex can't start or
    // join the stream cleanly: switch this channel to compatibility encoding,
    // without disconnecting anyone (see Broadcaster.restart).
    onKeyframeGap:ms=>{
      if (!copying || testPattern) return;
      forceEncode = true;
      channelLog(`Chrome's video went ${Math.round(ms/1000)} seconds without a keyframe. Switching to compatibility encoding (uses more CPU).`);
      broadcaster.restart('switching to compatibility encoding');
    },
    spawnEncoder:({tsOffset = 0} = {})=>testPattern ? spawn(ffmpeg,testPatternArgs(),{stdio:['ignore','pipe','pipe'],windowsHide:true}) : sourceEncoder({
      source,ffmpeg,compatibility:forceEncode,tsOffset,getFps:()=>source?.status?.()?.frameRate,timeoutMs:pool?45000:20000,
      onMode:value=>{mode=value;copying=value.startsWith('Video passthrough');log(value);},
      onCopyFailure:()=>{forceEncode=true;log('Passthrough failed before playback. Next tune will use compatibility encoding.');}
    })
  });
  channels.set(channel.channelNumber, {config:channel,source,broadcaster,status:()=>({channelNumber:channel.channelNumber,channelName:channel.channelName,programmeTitle:channel.programmeTitle,connections:broadcaster.clients.size,encoding:testPattern?'Test picture':mode,source:source?.status() ?? {connected:false}})});
  }
  const first = channels.values().next().value;
  let autostartDone = null;
  const server = createTunerServer({config,channels,log,pool,guide,onAutostartDone:result=>{autostartDone={...result,at:Date.now()};log(`Chrome started ${result.started} of ${result.total} channel tab(s).`);}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.listenAddress,resolve);});
  server.on('error',error=>log(`Tuner error: ${error.message}`));
  const stop = number => {
    for (const [id,c] of channels) if (number === undefined || id === number) { c.source?.stopBroadcast();c.broadcaster.stop('Stopped by user'); }
    if(number===undefined)pool?.close();
  };
  return {config,channels,pool,source:first.source,broadcaster:first.broadcaster,server,
    status:()=>{const all=[...channels.values()].map(c=>c.status());return {running:true,slots:pool?.status(),channels:all,connections:all.reduce((n,c)=>n+c.connections,0),encoding:first.status().encoding,source:{connected:(pool?pool.status().some(s=>s.connected):all.some(c=>c.source.connected))}};},
    stopBroadcast:stop,
    // When the extension last finished starting channels: {started, total, at} or null.
    autostartDone:()=>autostartDone,
    // For each tab someone is watching: how many viewers and how many bytes
    // Chrome has sent so far (the app uses it to notice a picture that stopped).
    flow:()=>pool?pool.slots.filter(s=>s.lease).map(s=>({key:`tab ${s.id}`,viewers:s.lease.viewers,bytes:s.hub.receivedBytes}))
      :[...channels.values()].filter(c=>c.source).map(c=>({key:`channel ${c.config.channelNumber}`,viewers:c.source.viewers,bytes:c.source.receivedBytes})),
    close:()=>{stop();pool?.close();server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));}
  };
}
