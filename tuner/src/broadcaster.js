// One shared encoder for everyone watching. The encoder starts when the first
// viewer connects and stops a few seconds after the last one leaves (the delay
// lets Plex reconnect while re-tuning without restarting FFmpeg).
// A viewer that falls too far behind is disconnected so it can't hold up others.
// Each new viewer starts at a video keyframe (with the program tables sent
// first) so its picture starts cleanly instead of with a second of garbage.
// It also watches how often keyframes arrive: if pictures keep coming but no
// keyframe does for too long, `onKeyframeGap` is called so the caller can
// switch to re-encoding (see restart()).

import {TsTracker, PACKET} from './ts.js';

export class Broadcaster {
  constructor({spawnEncoder, idleStopMs = 5000, maxBufferedBytes = 8 * 1024 * 1024, keyframeWaitMs = 4000, log = () => {}, now = Date.now, onViewers = () => {}, onEncoderStop = () => {}, onKeyframeGap = null, maxKeyframeGapMs = 6000, minFramesForGap = 30}) {
    this.spawnEncoder = spawnEncoder;
    this.idleStopMs = idleStopMs;
    this.maxBufferedBytes = maxBufferedBytes;
    this.keyframeWaitMs = keyframeWaitMs;
    this.log = log;
    this.now = now;
    this.onViewers = onViewers;
    this.onEncoderStop = onEncoderStop;
    this.onKeyframeGap = onKeyframeGap;
    this.maxKeyframeGapMs = maxKeyframeGapMs;
    this.minFramesForGap = minFramesForGap;
    this.sessionStartedAt = 0;
    this.clients = new Set();
    this.waiting = new Map(); // client -> time it joined, until its first keyframe
    this.encoder = null;
    this.idleTimer = null;
  }

  get running() { return this.encoder !== null; }

  // `client` is a writable stream (an HTTP response). Returns a function that
  // removes it.
  subscribe(client) {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.clients.add(client);
    this.waiting.set(client, this.now());
    const remove = () => this.unsubscribe(client);
    client.once('close', remove);
    client.once('error', remove);
    if (!this.encoder) this.start();
    this.log(`Viewer connected (${this.clients.size} connected).`);
    this.onViewers(this.clients.size);
    return remove;
  }

  unsubscribe(client) {
    this.waiting.delete(client);
    if (!this.clients.delete(client)) return;
    this.log(`Viewer disconnected (${this.clients.size} connected).`);
    this.onViewers(this.clients.size);
    if (this.clients.size === 0 && this.encoder) {
      this.idleTimer = setTimeout(() => this.stop('no viewers'), this.idleStopMs);
    }
  }

  // `options.tsOffset` continues an existing stream's clock (used by restart()).
  start(options = {}) {
    if (!options.tsOffset) this.sessionStartedAt = this.now();
    const encoder = this.spawnEncoder(options);
    this.encoder = encoder;
    let stderrTail = '';
    this.log('Encoder started.');
    const tracker = new TsTracker();
    let lastKeyframeAt = this.now();
    let gapReported = false;
    encoder.stdout.on('data', chunk => {
      if (this.encoder !== encoder) return;
      const packets = tracker.align(chunk);
      if (!packets.length) return;
      const keyframe = tracker.scan(packets);
      if (keyframe >= 0) lastKeyframeAt = this.now();
      else if (this.onKeyframeGap && !gapReported && tracker.framesSinceKey >= this.minFramesForGap &&
               this.now() - lastKeyframeAt > this.maxKeyframeGapMs) {
        gapReported = true;
        this.onKeyframeGap(this.now() - lastKeyframeAt);
        if (this.encoder !== encoder) return; // the callback replaced the encoder
      }
      for (const client of this.clients) {
        if (client.writableLength > this.maxBufferedBytes) {
          this.log('A viewer fell too far behind and was disconnected.');
          client.destroy();
          continue;
        }
        const joined = this.waiting.get(client);
        if (joined === undefined) {
          client.write(packets);
        } else if (keyframe >= 0) {
          this.waiting.delete(client);
          client.write(Buffer.concat([tracker.tables(), packets.subarray(keyframe * PACKET)]));
        } else if (this.now() - joined > this.keyframeWaitMs) {
          // No keyframe marker seen; send anyway rather than leave the viewer waiting.
          this.waiting.delete(client);
          client.write(packets);
        }
      }
    });
    encoder.stderr?.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-2000); });
    const ended = reason => {
      if (this.encoder !== encoder) return;
      this.encoder = null;
      this.log(`Encoder stopped unexpectedly (${reason}).${stderrTail.trim() ? ' FFmpeg said: ' + stderrTail.trim() : ''}`);
      for (const client of this.clients) client.end();
      this.clients.clear();
      this.waiting.clear();
      this.onEncoderStop();
      this.onViewers(0);
    };
    encoder.once('error', error => ended(error.code === 'ENOENT'
      ? 'FFmpeg was not found — see the README for how to install it'
      : error.message));
    encoder.once('exit', (code, signal) => ended(signal ? `signal ${signal}` : `exit code ${code}`));
  }

  // Replaces the running encoder without disconnecting anyone: viewers wait
  // for the new encoder's first keyframe (with fresh program tables), and its
  // timestamps carry on from where the old one was rather than jumping back.
  restart(reason) {
    const old = this.encoder;
    if (!old) return;
    this.log(`Restarting the encoder (${reason}).`);
    const tsOffset = Math.max(0, (this.now() - this.sessionStartedAt) / 1000) + 1;
    this.encoder = null; // the old encoder's exit is now ignored
    old.kill();
    for (const client of this.clients) this.waiting.set(client, this.now());
    this.start({tsOffset});
  }

  stop(reason = 'stopped') {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const encoder = this.encoder;
    this.encoder = null;
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.waiting.clear();
    if (encoder) {
      encoder.kill();
      this.log(`Encoder stopped (${reason}).`);
      this.onEncoderStop();
    }
    this.onViewers(0);
  }
}
