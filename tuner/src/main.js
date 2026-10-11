// Starts the Tohyee TV tuner: a pretend HDHomeRun network tuner that Plex
// can add under Live TV & DVR. Stage 1 plays a test picture and tone.

import {spawn, spawnSync} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig, defaultConfigPath} from './config.js';
import {findFfmpeg, testPatternArgs, chromeInputArgs} from './ffmpeg.js';
import {SourceHub} from './source.js';
import {Broadcaster} from './broadcaster.js';
import {createTunerServer} from './server.js';
import {startRuntime} from './runtime.js';
import {VERSION} from './hdhr.js';

const log = message => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);

function lanAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) found.push(a.address);
  }
  return found;
}

async function main() {
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
  const runtime = await startRuntime({config, ffmpeg, log, testPattern:useTest});
  const {server, broadcaster} = runtime;
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Close the other program, or change "port" in ${configPath}.`
      : `Could not start: ${error.message}`);
    process.exitCode = 1;
  });

  {
    const addresses = lanAddresses();
    const primary = addresses[0] ?? '127.0.0.1';
    console.log(`
Tohyee TV tuner ${VERSION} is running. Keep this window open.

  Tuner address for Plex:  http://${primary}:${config.port}
  XMLTV guide address:     http://${primary}:${config.port}/guide.xml
  Status page:             http://127.0.0.1:${config.port}/
${addresses.length > 1 ? `\n  This computer has several network addresses: ${addresses.join(', ')}.\n  Use the one on the same network as your Plex server.\n` : ''}
  Source: ${useTest ? 'test picture and tone' : 'Chrome tab (click Tohyee TV in Chrome and choose Broadcast)'}
  Settings file: ${configPath}

Press Ctrl+C to stop.
`);
  }

  const shutdown = () => {
    log('Shutting down…');
    runtime.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});
