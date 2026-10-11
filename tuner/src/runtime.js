import {spawn} from 'node:child_process';
import {SourceHub} from './source.js';
import {Broadcaster} from './broadcaster.js';
import {createTunerServer} from './server.js';
import {testPatternArgs} from './ffmpeg.js';
import {sourceEncoder} from './media.js';

export async function startRuntime({config, ffmpeg, log = () => {}, testPattern = false}) {
  const source = testPattern ? null : new SourceHub({log});
  let forceEncode = config.videoMode === 'encode', mode = 'Waiting for source';
  const broadcaster = new Broadcaster({log,
    onViewers:count=>source?.setViewers(count), onEncoderStop:()=>source?.detach(),
    spawnEncoder:()=>testPattern ? spawn(ffmpeg,testPatternArgs(),{stdio:['ignore','pipe','pipe'],windowsHide:true}) : sourceEncoder({
      source,ffmpeg,compatibility:forceEncode,
      onMode:value=>{mode=value;log(value);},
      onCopyFailure:()=>{forceEncode=true;log('Passthrough failed before playback. Next tune will use compatibility encoding.');}
    })
  });
  const server = createTunerServer({config,broadcaster,source,log});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.listenAddress,resolve);});
  server.on('error',error=>log(`Tuner error: ${error.message}`));
  return {config,source,broadcaster,server,
    status:()=>({running:true,connections:broadcaster.clients.size,encoding:mode,source:source?.status() ?? {connected:false}}),
    stopBroadcast:()=>{source?.stopBroadcast();broadcaster.stop('Stopped by user');},
    close:()=>{source?.stopBroadcast();broadcaster.stop('App closed');server.closeAllConnections?.();return new Promise(resolve=>server.close(resolve));}
  };
}
