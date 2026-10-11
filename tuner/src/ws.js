// A small server-side WebSocket implementation (RFC 6455), so the Chrome
// extension can stream media to the tuner without extra installs.
// Supports text/binary messages, fragmentation, ping/pong and close.

import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

export function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, {maxMessageBytes = 16 * 1024 * 1024} = {}) {
    super();
    this.socket = socket;
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.closed = false;
    socket.setNoDelay?.(true);
    socket.on('data', data => this.receive(data));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  receive(data) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;
    while (!this.closed) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let length = b[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxMessageBytes)) return this.fail(1009, 'Message too big');
        length = Number(big); offset = 10;
      }
      if (!masked) return this.fail(1002, 'Client frames must be masked');
      if (length > this.maxMessageBytes) return this.fail(1009, 'Message too big');
      if (b.length < offset + 4 + length) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = b.subarray(offset + 4 + length);
      this.frame(fin, opcode, payload);
    }
  }

  frame(fin, opcode, payload) {
    if (opcode === 0x8) { // close
      this.sendRaw(encodeFrame(0x8, payload.subarray(0, 2)));
      return this.finish();
    }
    if (opcode === 0x9) return this.sendRaw(encodeFrame(0xa, payload)); // ping -> pong
    if (opcode === 0xa) return; // pong
    if (opcode === 0x1 || opcode === 0x2) {
      if (this.fragments.length) return this.fail(1002, 'Unexpected new message');
      if (fin) return this.deliver(opcode, payload);
      this.fragmentOpcode = opcode;
      this.fragments = [payload];
      return;
    }
    if (opcode === 0x0) {
      if (!this.fragments.length) return this.fail(1002, 'Unexpected continuation');
      this.fragments.push(payload);
      const size = this.fragments.reduce((n, f) => n + f.length, 0);
      if (size > this.maxMessageBytes) return this.fail(1009, 'Message too big');
      if (fin) {
        const whole = Buffer.concat(this.fragments);
        this.fragments = [];
        this.deliver(this.fragmentOpcode, whole);
      }
      return;
    }
    this.fail(1002, 'Unknown frame type');
  }

  deliver(opcode, payload) {
    if (opcode === 0x1) this.emit('text', payload.toString('utf8'));
    else this.emit('binary', payload);
  }

  sendRaw(frame) {
    if (!this.closed && !this.socket.destroyed) this.socket.write(frame);
  }

  send(text) { this.sendRaw(encodeFrame(0x1, Buffer.from(text, 'utf8'))); }
  sendJson(value) { this.send(JSON.stringify(value)); }

  fail(code, reason) {
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0); body.write(reason, 2);
    this.sendRaw(encodeFrame(0x8, body));
    this.finish();
  }

  close(code = 1000, reason = '') { this.fail(code, reason); }

  finish() {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
    this.emit('close');
  }
}

// Completes the HTTP upgrade. Returns null (and rejects) if it isn't a valid
// WebSocket request.
export function acceptUpgrade(req, socket, options) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  return new WebSocketConnection(socket, options);
}
