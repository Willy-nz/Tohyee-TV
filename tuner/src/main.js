// Starts the Tohyee TV tuner: a pretend HDHomeRun network tuner that Plex
// can add under Live TV & DVR. Plays a Chrome tab sent by the Tohyee TV extension
// (or a test picture and tone with --test-pattern).

import {spawn, spawnSync} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, defaultConfigPath} from './config.js';
import {findFfmpeg, testPatternArgs, chromeInputArgs, chromeCopyArgs} from './ffmpeg.js';
import {SourceHub} from './source.js';
import {Broadcaster} from './broadcaster.js';
import {createTunerServer} from './server.js';
import {VERSION} from './hdhr.js';

const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

function lanAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) found.push(a.address);
  }
  return found;
}

function main() {
  const configArg = process.argv.indexOf('--config');
  const configPath = configArg > 0 ? process.argv[configArg + 1] : defaultConfigPath();
  let config;
  try {
    config = loadConfig(configPath);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  // tuner/ in the repo, or app/ in the Windows package; its parent is the
  // folder with "Start Tohyee TV Tuner", where people may drop ffmpeg.exe.
  const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const ffmpeg = findFfmpeg(config, [dirname(appDir), appDir]);
  const check = spawnSync(ffmpeg, ['-hide_banner', '-version'], {encoding: 'utf8', windowsHide: true});
  if (check.error || check.status !== 0) {
    console.error(`FFmpeg could not be started (${ffmpeg}). Put ffmpeg.exe in the Tohyee TV Tuner folder (or install FFmpeg), then start it again — see README.txt.`);
    process.exitCode = 1;
    return;
  }

  // Default source is the Chrome extension; --test-pattern (or "source": "test"
  // in settings) plays a test picture and tone instead, for checking Plex alone.
  const useTest = process.argv.includes('--test-pattern') || config.source === 'test';
  // Video handling ("video" in settings):
  //   auto   - pass Chrome's H.264 straight through (far less CPU, no extra
  //            quality loss); switch to re-encoding if Chrome sends another
  //            codec or doesn't send regular keyframes.
  //   copy   - always pass through.   encode - always re-encode.
  let copyBlocked = '';   // why pass-through was abandoned (auto mode), if it was
  let currentCopy = false;
  const wantCopy = () => {
    if (config.video === 'copy') return true;
    if (config.video === 'encode' || copyBlocked) return false;
    return source.codec === 'h264';
  };
  const fallBack = reason => {
    if (!currentCopy || config.video !== 'auto') return;
    copyBlocked = reason;
    log(`${reason} Switching to re-encoding (uses more CPU).`);
    broadcaster.restart('switching to re-encoding');
  };

  const source = useTest ? null : new SourceHub({
    log,
    // Chrome confirms the actual recording format when it starts sending.
    onSession: codec => { if (currentCopy && codec !== 'h264') fallBack(`Chrome is sending ${codec || 'an unknown format'}, not H.264.`); }
  });
  const broadcaster = new Broadcaster({
    log,
    onViewers: count => source?.setViewers(count),
    onEncoderStop: () => source?.detach(),
    onKeyframeGap: ms => fallBack(`Chrome's video went ${Math.round(ms / 1000)} seconds without a keyframe, which stops Plex starting it cleanly.`),
    spawnEncoder: ({tsOffset = 0} = {}) => {
      if (useTest) return spawn(ffmpeg, testPatternArgs(), {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
      currentCopy = wantCopy();
      source.videoMode = currentCopy ? 'copy' : 'encode';
      log(currentCopy ? 'Passing Chrome’s picture straight through (no re-encoding).' : 'Re-encoding Chrome’s picture.');
      const args = currentCopy ? chromeCopyArgs({tsOffset}) : chromeInputArgs({tsOffset});
      const encoder = spawn(ffmpeg, args, {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
      source.attach(encoder.stdin);
      return encoder;
    }
  });
  const server = createTunerServer({config, broadcaster, source, log});

  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Close the other program, or change "port" in ${configPath}.`
      : `Could not start: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(config.port, config.listenAddress, () => {
    const addresses = lanAddresses();
    const primary = addresses[0] ?? '127.0.0.1';
    console.log(`
Tohyee TV tuner ${VERSION} is running. Keep this window open.

  Tuner address for Plex:  http://${primary}:${config.port}
  XMLTV guide address:     http://${primary}:${config.port}/guide.xml
  Status page:             http://127.0.0.1:${config.port}/
${addresses.length > 1 ? `\n  This computer has several network addresses: ${addresses.join(', ')}.\n  Use the one on the same network as your Plex server.\n` : ''}
  Source: ${useTest ? 'test picture and tone' : 'Chrome tab (click Tohyee TV in Chrome and choose Broadcast)'}
${useTest ? '' : `  Video: ${{auto: 'pass Chrome’s picture straight through when possible', copy: 'always pass through', encode: 'always re-encode'}[config.video]}\n`}  Settings file: ${configPath}

Press Ctrl+C to stop.
`);
  });

  const shutdown = () => {
    log('Shutting down…');
    broadcaster.stop('shutting down');
    server.close();
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
