import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CaptureSession} from '../firefox-prototype/session.js';
function media() {
  const video = new EventTarget();
  video.readyState = 'live';
  video.stop = () => { video.readyState = 'ended'; };
  const audio = {readyState:'live', stop() {this.readyState = 'ended';}};
  return {video, audio, getTracks:() => [video,audio], getVideoTracks:() => [video]};
}
test('Stop releases both audio and video', async () => {
  const stream = media(); const session = new CaptureSession(async () => stream, () => {});
  await session.start(true); assert.equal(session.state, 'live');
  session.stop(); assert.equal(stream.audio.readyState, 'ended'); assert.equal(stream.video.readyState, 'ended');
  assert.equal(session.stream, null);
});
test('Stop while picker is open discards late permission result', async () => {
  let resolve; const stream = media();
  const session = new CaptureSession(() => new Promise(r => {resolve = r;}), () => {});
  const pending = session.start(true); session.stop(); resolve(stream); await pending;
  assert.equal(session.state, 'idle'); assert.equal(stream.video.readyState, 'ended');
});
test('Browser stop-sharing ends whole session', async () => {
  const stream = media(); const session = new CaptureSession(async () => stream, () => {});
  await session.start(false); stream.video.dispatchEvent(new Event('ended'));
  assert.equal(session.state, 'idle'); assert.equal(stream.audio.readyState, 'ended');
});
test('Permission denial returns actionable error state', async () => {
  const error = new Error('denied'); error.name = 'NotAllowedError'; let last;
  const session = new CaptureSession(async () => {throw error;}, value => {last = value;});
  await session.start(true); assert.equal(last.state, 'error'); assert.equal(last.error.name, 'NotAllowedError');
});
