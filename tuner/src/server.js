// HTTP endpoints Plex uses to find, scan and play the tuner, plus a small
// status page for people.

import {createServer} from 'node:http';
import {discover, lineup, lineupStatus, deviceXml, baseUrl, escapeXml, VERSION} from './hdhr.js';
import {xmltv} from './guide.js';

function send(res, status, type, body) {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(body);
}

function statusPage(base, config, broadcaster, source) {
  const tuner = escapeXml(base);
  const guide = escapeXml(`${base}/guide.xml`);
  const stream = escapeXml(`${base}/stream/${encodeURIComponent(config.channelNumber)}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tohyee TV tuner</title><style>
:root{color-scheme:dark;font-family:Segoe UI,system-ui,sans-serif;background:#17181c;color:#eee}body{margin:0}main{max-width:760px;margin:auto;padding:28px 16px}
h1{font-size:28px}.card{background:#24262c;border:1px solid #444752;border-radius:14px;padding:18px 20px;margin:16px 0}
dt{color:#b8bbc4;font-size:13px;margin-top:12px}dd{margin:4px 0;font-family:Consolas,monospace;word-break:break-all;color:#ffd27a}p{line-height:1.6;color:#c9ccd5}
</style></head><body><main><h1>Tohyee TV tuner is running</h1>
<p>Plex: ${broadcaster.running ? `<strong>watching</strong> (${broadcaster.clients.size} connection${broadcaster.clients.size === 1 ? '' : 's'})` : 'not watching'} · v${VERSION}</p>
<p>Source: ${sourceText(source)}</p>
<div class="card"><dl>
<dt>Tuner address (enter this in Plex)</dt><dd>${tuner}</dd>
<dt>XMLTV guide address</dt><dd>${guide}</dd>
<dt>Channel stream (test in VLC: Media → Open Network Stream)</dt><dd>${stream}</dd>
</dl></div>
<p>These addresses use the address this page was opened with. If Plex runs on another device, open this page using this computer's network address (for example http://192.168.1.20:${config.port}) so the addresses shown are ones Plex can reach.</p>
</main></body></html>`;
}

function sourceText(source) {
  if (!source) return 'test picture and tone';
  const s = source.status();
  if (!s.connected) return '<strong>Chrome not connected</strong> — click Tohyee TV in Chrome on your video tab and choose Broadcast.';
  const video = s.sending ? (s.videoMode === 'copy' ? ' (picture passed straight through)' : ' (picture re-encoded)') : '';
  return `Chrome tab “${escapeXml(s.tabTitle ?? 'unknown')}”${s.sending ? ` — sending to Plex${video}` : ' — ready, waiting for Plex'}${s.message ? ` · ${escapeXml(s.message)}` : ''}`;
}

// `source` is the Chrome SourceHub, or null when playing the test pattern.
export function createTunerServer({config, broadcaster, source = null, log = () => {}}) {
  const fallbackBase = `http://127.0.0.1:${config.port}`;
  const streamPath = `/stream/${encodeURIComponent(config.channelNumber)}`;
  const server = createServer((req, res) => {
    const base = baseUrl(req.headers.host, fallbackBase);
    const path = new URL(req.url, 'http://x').pathname;
    const method = req.method;

    if (path === streamPath && (method === 'GET' || method === 'HEAD')) {
      if (source && !source.available && !broadcaster.running) {
        if (method === 'GET') log(`Plex tried to watch, but Chrome is not broadcasting a tab (${req.socket.remoteAddress}).`);
        return send(res, 503, 'text/plain; charset=utf-8', 'Tohyee TV is not broadcasting. In Chrome, open your video tab, click Tohyee TV and choose Broadcast.\n');
      }
      res.writeHead(200, {'Content-Type': 'video/mpeg', 'Cache-Control': 'no-store', 'Connection': 'close'});
      if (method === 'HEAD') return res.end();
      log(`Stream requested by ${req.socket.remoteAddress}.`);
      broadcaster.subscribe(res);
      return;
    }
    if (path.startsWith('/stream/')) return send(res, 404, 'text/plain; charset=utf-8', 'No such channel.\n');
    if (method === 'POST' && path === '/lineup.post') return send(res, 200, 'text/plain; charset=utf-8', '');
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.\n');

    switch (path) {
      case '/discover.json':
        log(`Plex (or another app) read the tuner details from ${req.socket.remoteAddress}.`);
        return send(res, 200, 'application/json', JSON.stringify(discover(base, config)));
      case '/lineup.json':
        return send(res, 200, 'application/json', JSON.stringify(lineup(base, config)));
      case '/lineup_status.json':
        return send(res, 200, 'application/json', JSON.stringify(lineupStatus()));
      case '/device.xml':
      case '/capability':
        return send(res, 200, 'application/xml', deviceXml(base, config));
      case '/guide.xml':
        log(`Guide requested by ${req.socket.remoteAddress}.`);
        return send(res, 200, 'application/xml; charset=utf-8', xmltv(config));
      case '/':
        return send(res, 200, 'text/html; charset=utf-8', statusPage(base, config, broadcaster, source));
      default:
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found.\n');
    }
  });
  server.on('upgrade', (req, socket) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/source' && source) return source.handleUpgrade(req, socket);
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  });
  return server;
}
