import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {chromeInputArgs} from './ffmpeg.js';

// Whether Chrome's recording includes a sound track (a bare "video/webm" usually does).
export function hasAudio(mime) {
  return !/codecs\s*=/i.test(mime) || /opus|vorbis|aac|mp4a/i.test(mime);
}

export function canCopyVideo(mime) {
  return /^video\/(webm|mp4);\s*codecs\s*=\s*"?(h264|avc1(?:\.[a-f0-9]+)?)(?:[,";]|$)/i.test(mime);
}

// Wait for the recorder's format before selecting copy vs encode. No media
// decoding is needed to make this choice; FFmpeg validates the actual stream.
export function sourceEncoder({source, ffmpeg, compatibility = false, tsOffset = 0, getFps = () => 30, onMode = () => {}, onCopyFailure = () => {}, spawnProcess = spawn, timeoutMs = 20000}) {
  const proxy = new EventEmitter();
  proxy.stdout = new PassThrough(); proxy.stderr = new PassThrough();
  const input = new PassThrough(); let child, ended = false, outputSeen = false, copy = false;
  let lastOutput = Date.now();
  const finish = (code, signal) => {
    if (ended) return;
    ended = true; clearInterval(watchdog); input.destroy();
    if (copy && code !== 0 && !outputSeen) onCopyFailure();
    proxy.emit('exit',code,signal);
  };
  const stopChild=()=>{if(!child)return;child.stdin?.destroy();child.kill();const process=child;const timer=setTimeout(()=>{if(process.exitCode===null)process.kill('SIGKILL');},2000);timer.unref?.();};
  proxy.kill = () => {stopChild(); finish(0,'SIGTERM');};
  const watchdog = setInterval(() => {
    if (Date.now()-lastOutput < timeoutMs) return;
    proxy.stderr.write(`No encoded media received for ${timeoutMs/1000} seconds; closing stream so Plex can retry.`);
    stopChild(); finish(1,'timeout');
  },1000);
  watchdog.unref?.();
  source.attach(input, mime => {
    if (child || ended) return;
    copy = !compatibility && canCopyVideo(mime);
    onMode(copy ? 'Video passthrough · audio conversion' : 'Compatibility encoding');
    child = spawnProcess(ffmpeg,chromeInputArgs({copyVideo:copy,tsOffset,chromeAudio:hasAudio(mime),fps:[25,30,50].includes(Number(getFps()))?Number(getFps()):30}),{stdio:['pipe','pipe','pipe'],windowsHide:true});
    input.pipe(child.stdin);
    child.stdin.on('error',()=>{});
    child.stdout.on('data',data=>{lastOutput=Date.now();outputSeen=true;proxy.stdout.write(data);});
    child.stderr.on('data',data=>proxy.stderr.write(data));
    child.once('error',error=>{proxy.stderr.write(error.message);finish(1,'spawn-error');});
    child.once('exit',finish);
  });
  return proxy;
}
