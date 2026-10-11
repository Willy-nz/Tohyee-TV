import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromeInputArgs} from '../tuner/src/ffmpeg.js';
const ffmpeg=process.argv[2]||'ffmpeg';
const ffprobe=ffmpeg.endsWith('.exe')?ffmpeg.replace(/ffmpeg\.exe$/,'ffprobe.exe'):'ffprobe';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tohyee-media-'));
function run(exe,args,input){const r=spawnSync(exe,args,{input,maxBuffer:32*1024*1024,timeout:30000,windowsHide:true});assert.equal(r.status,0,r.error?.message||r.stderr?.toString());return r.stdout;}
try{
 for(const copy of [true,false]){
  const width=copy?640:641;
  const input=run(ffmpeg,['-v','error','-f','lavfi','-i',`testsrc=size=${width}x360:rate=30`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v',copy?'libx264':'ffv1','-pix_fmt',copy?'yuv420p':'yuv444p','-c:a','aac','-f','matroska','pipe:1']);
  const output=run(ffmpeg,chromeInputArgs({copyVideo:copy}),input);
  const file=path.join(folder,copy?'copy.ts':'encode.ts');fs.writeFileSync(file,output);
  const probe=JSON.parse(run(ffprobe,['-v','error','-show_streams','-of','json',file]).toString());
  const video=probe.streams.find(s=>s.codec_type==='video');
  assert.equal(video.codec_name,'h264');assert.equal(video.width%2,0);
  assert.ok(probe.streams.some(s=>s.codec_name==='aac'));
  run(ffmpeg,['-v','error','-i',file,'-f','null','-']);
  console.log(`${copy?'Passthrough':'Odd-width fallback'}: H.264 + AAC decodes successfully (${video.width} pixels wide).`);
 }
}finally{fs.rmSync(folder,{recursive:true,force:true});}
