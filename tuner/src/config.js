// Per-user settings, saved as JSON so the tuner keeps the same identity
// (DeviceID) across restarts — Plex remembers tuners by that ID.

import {randomBytes} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';

export const DEFAULTS = Object.freeze({
  port: 34500,
  listenAddress: '0.0.0.0',
  deviceName: 'Tohyee TV',
  channelName: 'Tohyee TV',
  channelNumber: '1',
  programmeTitle: 'Live Desktop',
  source: 'chrome',
  videoMode: 'auto',
  captureMode: 'dedicated',
  tabCount: 3,
  guideEnabled: false,
  ffmpegPath: ''
});

export function defaultConfigPath(env = process.env, platform = process.platform) {
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'Tohyee TV', 'tuner.json');
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tohyee-tv', 'tuner.json');
}

export function newDeviceId() {
  return randomBytes(4).toString('hex').toUpperCase();
}

// Returns a list of problems; empty when the config is usable.
export function validate(config) {
  const problems = [];
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('port must be a whole number from 1 to 65535');
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(config.channelNumber)) problems.push('channelNumber must look like 1 or 2.1');
  if (!/^[0-9A-F]{8}$/.test(config.deviceId)) problems.push('deviceId must be 8 hex characters');
  for (const key of ['deviceName', 'channelName', 'programmeTitle']) {
    if (typeof config[key] !== 'string' || !config[key].trim() || config[key].length > 60) problems.push(`${key} must be 1–60 characters`);
  }
  if (typeof config.listenAddress !== 'string' || !config.listenAddress) problems.push('listenAddress must be set');
  if (typeof config.ffmpegPath !== 'string') problems.push('ffmpegPath must be text');
  if (config.videoMode !== undefined && !['auto','encode'].includes(config.videoMode)) problems.push('videoMode must be auto or encode');
  if (!['chrome', 'test'].includes(config.source)) problems.push('source must be "chrome" or "test"');
  if(!['dedicated','pool'].includes(config.captureMode??'dedicated'))problems.push('Invalid capture mode');
  if(!Number.isInteger(config.tabCount??3)||(config.tabCount??3)<1||(config.tabCount??3)>8)problems.push('Choose 1–8 reusable tabs');
  if (config.channels !== undefined) {
    if (!Array.isArray(config.channels) || config.channels.length < 1 || config.channels.length > 200) problems.push('Configure between 1 and 200 channels');
    else {
      const numbers = new Set();
      for (const c of config.channels) {
        if (!c || typeof c.channelNumber !== 'string' || !/^\d{1,4}(\.\d{1,3})?$/.test(c.channelNumber ?? '')) { problems.push('Invalid channel number'); continue; }
        if (numbers.has(c.channelNumber)) problems.push('Channel numbers must be unique');
        numbers.add(c.channelNumber);
        if(c.url)try{const u=new URL(c.url);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{problems.push('Channel web addresses must be HTTPS');}
        if(c.guideId!==undefined&&(typeof c.guideId!=='string'||c.guideId.length>200))problems.push('Invalid guide mapping');
        for (const key of ['channelName','programmeTitle']) if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 60) problems.push(`${key} must be 1–60 characters`);
      }
    }
  }
  return problems;
}

// Loads the config, filling in defaults and creating a DeviceID on first run.
// Saves it back if anything was added, so the ID stays stable.
export function loadConfig(path, fs = {readFileSync, writeFileSync, mkdirSync}) {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read settings file ${path}: ${error.message}`);
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) throw new Error(`Settings file ${path} is not a JSON object`);
  const config = {...DEFAULTS, ...stored};
  let changed = Object.keys(DEFAULTS).some(key => !(key in stored));
  if (!config.deviceId) { config.deviceId = newDeviceId(); changed = true; }
  const problems = validate(config);
  if (problems.length) throw new Error(`Settings file ${path} has problems: ${problems.join('; ')}`);
  if (changed) {
    fs.mkdirSync(dirname(path), {recursive: true});
    fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  }
  return config;
}

export function channelConfigs(config) { return (config.channels ?? [{channelNumber:config.channelNumber,channelName:config.channelName,programmeTitle:config.programmeTitle}]).map(c=>({...config,...c})); }
