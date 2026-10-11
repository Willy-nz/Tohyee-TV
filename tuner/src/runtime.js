import {channelConfigs} from './config.js';
import {spawn} from 'node:child_process';
import {SourceHub} from './source.js';
import {Broadcaster} from './broadcaster.js';
import {createTunerServer} from './server.js';
import {testPatternArgs} from './ffmpeg.js';
import {sourceEncoder} from './media.js';

export async function startRuntime({config, ffmpeg, log = () => {}, testPattern = false}) {
  const channels = new Map();
  for (const channel of channelConfigs(config)) {
  const channelLog = text=>log(`[${channel.channelNumber} ${channel.channelName}] ${text}`);
  const source = testPattern ? null : new SourceHub({log:channelLog});
  let forceEncode = config.videoMode === 'encode', mode = 'Waiting for source';
  const broadcaster = new Broadcaster({log:channelLog,
    onViewers:count=>source?.setViewers(count), onEncoderStop:()=>source?.detach(),
    spawnEncoder:()=>testPattern ? spawn(ffmpeg,testPatternArgs(),{stdio:['ignore','pipe','pipe'],windowsHide:true}) : sourceEncoder({
      source,ffmpeg,compatibility:forceEncode,
      onMode:value=>{mode=value;log(value);},
      onCopyFailure:()=>{forceEncode=true;log('Passthrough failed before playback. Next tune will use compatibility encoding.');}
    })
  });
  channels.set(channel.channelNumber, {config:channel,source,broadcaster,status:()=>({channelNumber:channel.channelNumber,channelName:channel.channelName,programmeTitle:channel.programmeTitle,connections:broadcaster.clients.size,encoding:testPattern?'Test picture':mode,source:source?.status() ?? {connected:false}})});
  }
  const first = channels.values().next().value;
  const server = createTunerServer({config,channels,log});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.listenAddress,resolve);});
  server.on('error',error=>log(`Tuner error: ${error.message}`));
  const stop = number => {
    for (const [id,c] of channels) if (number === undefined || id === number) { c.source?.stopBroadcast();c.broadcaster.stop('Stopped by user'); }
  };
  return {config,channels,source:first.source,broadcaster:first.broadcaster,server,
    status:()=>{const all=[...channels.values()].map(c=>c.status());return {running:true,channels:all,connections:all.reduce((n,c)=>n+c.connections,0),encoding:first.status().encoding,source:{connected:all.some(c=>c.source.connected)}};},
    stopBroadcast:stop,
    close:()=>{stop();server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));}
  };
}
