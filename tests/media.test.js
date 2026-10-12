import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {canCopyVideo,sourceEncoder} from '../tuner/src/media.js';
import {chromeInputArgs} from '../tuner/src/ffmpeg.js';
test('Passthrough only selects explicitly identified H264 input',()=>{
 for(const value of ['video/webm;codecs=h264,opus','video/mp4;codecs="avc1.42E01E,mp4a.40.2"'])assert.ok(canCopyVideo(value));
 for(const value of ['video/webm','video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus'])assert.equal(canCopyVideo(value),false);
 const args=chromeInputArgs({copyVideo:true});assert.equal(args[args.indexOf('-c:v')+1],'copy');assert.ok(!args.includes('-vf'));
});
test('Deferred encoder waits for media format; copy startup failure selects fallback',()=>{
 let session,spawned=0,failed=false,child;
 const source={attach(sink,fn){session=fn;}};
 const proxy=sourceEncoder({source,ffmpeg:'ffmpeg',onCopyFailure:()=>failed=true,spawnProcess:()=>{
  spawned++;child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child;
 }});
 assert.equal(spawned,0);session('video/webm;codecs=h264,opus');assert.equal(spawned,1);
 child.emit('exit',1,null);assert.equal(failed,true);proxy.kill();
});
test('Stopping before media arrives never starts an encoder',()=>{
 let session;let spawned=0;
 const proxy=sourceEncoder({source:{attach(sink,fn){session=fn;}},ffmpeg:'ffmpeg',spawnProcess:()=>{spawned++;}});
 proxy.kill();session('video/webm;codecs=h264,opus');assert.equal(spawned,0);
});
