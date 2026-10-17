// The link to the Chrome extension that captures the chosen tab.
//
// Messages (JSON text unless noted):
//   extension -> tuner  {type:'hello', version, tabTitle, reloadOnWatch}
//                       {type:'status', tabTitle, state, message}
//                       {type:'session', session, mimeType}  then binary WebM chunks
//   tuner -> extension  {type:'viewers', count}     whenever the number of Plex connections changes
//                       {type:'start', session}     someone is watching: start sending media
//                       {type:'stop'}               nobody is watching: stop sending media
//
// Only one extension connection is active; a new one replaces the old.
// Media for a session is accepted only after the extension confirms that
// session, so the encoder always receives a WebM stream from its beginning.

import {acceptUpgrade} from './ws.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export class SourceHub {
  constructor({log = () => {}, maxQueuedBytes = 32 * 1024 * 1024} = {}) {
    this.log = log;
    this.maxQueuedBytes = maxQueuedBytes;
    this.connection = null;
    this.info = null;
    this.sink = null;
    this.session = 0;
    this.accepting = false;
    this.viewers = 0;
    this.receivedBytes = 0;
  }

  get available() { return this.connection !== null; }

  // Accepts the extension's WebSocket. Only this computer, and only a Chrome
  // extension page, may connect.
  handleUpgrade(req, socket) {
    const origin = String(req.headers.origin ?? '');
    if (!LOOPBACK.has(req.socket.remoteAddress) || !origin.startsWith('chrome-extension://')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      this.log('Refused a source connection that was not from Chrome on this computer.');
      return;
    }
    const connection = acceptUpgrade(req, socket);
    if (!connection) return;
    if (this.connection) {
      this.log('A new Chrome connection replaced the previous one.');
      this.connection.close(4000, 'Replaced by a newer connection');
    }
    this.connection = connection;
    this.info = null;
    connection.on('text', text => this.onText(connection, text));
    connection.on('binary', data => this.onBinary(connection, data));
    connection.on('close', () => this.onClose(connection));
    connection.sendJson({type: 'viewers', count: this.viewers});
    if (this.sink) connection.sendJson({type: 'start', session: this.session});
  }

  onText(connection, text) {
    if (connection !== this.connection) return;
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if(!message||typeof message!=='object')return;
    this.onControl?.(message);
    if (message.type === 'hello' || message.type === 'status') {
      const first = message.type === 'hello';
      this.info = {...this.info, ...pick(message)};
      if (first) this.log(`Chrome connected${this.info.tabTitle ? `: broadcasting “${this.info.tabTitle}”` : ''}.`);
      else if (message.message) this.log(`Chrome: ${message.message}`);
    } else if (message.type === 'session' && message.session === this.session && this.sink) {
      if (this.accepting) return;
      this.onSession?.(String(message.mimeType ?? ''));
      this.accepting = true;
      this.log(`Chrome is sending picture and sound (${message.mimeType ?? 'unknown format'}).`);
    }
  }

  onBinary(connection, data) {
    if (connection !== this.connection || !this.accepting || !this.sink) return;
    this.receivedBytes += data.length;
    if (this.sink.writableLength > this.maxQueuedBytes) {
      this.log('The encoder is falling behind Chrome; restarting the stream.');
      const sink = this.sink;
      this.detach();
      sink.destroy();
      return;
    }
    this.sink.write(data);
  }

  onClose(connection) {
    if (connection !== this.connection) return;
    this.connection = null;
    this.info = null;
    this.onDisconnect?.();
    this.log('Chrome disconnected — Tohyee TV is not broadcasting.');
    if (this.sink) {
      const sink = this.sink;
      this.sink = null;
      this.accepting = false;
      sink.end();
    }
  }

  // Called when the encoder starts: media for this new session goes to `sink`.
  attach(sink, onSession) {
    this.session++;
    this.sink = sink;
    this.onSession = onSession;
    this.accepting = false;
    sink.on?.('error', () => {}); // FFmpeg closing its input early is handled by the encoder's exit
    this.connection?.sendJson({type: 'start', session: this.session});
  }

  // Called when the encoder stops.
  detach() {
    if (!this.sink) return;
    this.sink = null;
    this.accepting = false;
    this.connection?.sendJson({type: 'stop'});
  }

  setViewers(count) {
    this.viewers = count;
    this.connection?.sendJson({type: 'viewers', count});
  }

  stopBroadcast() {
    this.connection?.sendJson({type: 'shutdown'});
    this.connection?.close(1000, 'Stopped from desktop');
  }

  status() {
    return {connected: this.available, sending: this.accepting, viewers: this.viewers, ...this.info};
  }
}

function pick(message) {
  const out = {};
  for (const key of ['version', 'tabTitle', 'state', 'message', 'reloadOnWatch', 'frameRate', 'captureSize']) {
    if (key in message) out[key] = typeof message[key] === 'string' ? message[key].slice(0, 200) : message[key];
  }
  return out;
}
