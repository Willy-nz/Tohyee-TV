import {readFileSync} from 'node:fs';
import {defaultConfigPath} from '../tuner/src/config.js';
try {
  const config = JSON.parse(readFileSync(defaultConfigPath(), 'utf8'));
  const host = ['0.0.0.0', '::'].includes(config.listenAddress) ? '127.0.0.1' : config.listenAddress;
  const address = host.includes(':') ? `[${host}]` : host;
  const response = await fetch(`http://${address}:${config.port}/discover.json`, {signal: AbortSignal.timeout(3000)});
  if (!response.ok || !(await response.json()).DeviceID) process.exitCode = 1;
} catch { process.exitCode = 1; }
