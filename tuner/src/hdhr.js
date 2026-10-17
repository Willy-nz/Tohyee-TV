import {channelConfigs} from './config.js';
// The small HDHomeRun-compatible description files Plex reads when you add a
// network tuner. Field names follow what Plex expects from HDHomeRun devices
// (cross-checked against Threadfin, an established Plex tuner emulator).
//
// `base` is "http://host:port" built from the address Plex used to reach us,
// so every URL we hand back is one Plex already knows it can reach.

export const VERSION = '0.7.2';

export function discover(base, config) {
  return {
    FriendlyName: config.deviceName,
    Manufacturer: 'Tohyee TV',
    ModelNumber: 'HDTC-2US',
    FirmwareName: 'tohyee_tv',
    FirmwareVersion: VERSION,
    DeviceID: config.deviceId,
    DeviceAuth: 'tohyee',
    TunerCount: config.captureMode==='pool'?(config.tabCount??3):channelConfigs(config).length,
    BaseURL: base,
    LineupURL: `${base}/lineup.json`
  };
}

export function lineup(base, config) {
  return channelConfigs(config).map(config => ({
    GuideNumber: config.channelNumber,
    GuideName: config.channelName,
    URL: `${base}/stream/${encodeURIComponent(config.channelNumber)}`
  }));
}

// There is nothing to scan: the single channel always exists.
export function lineupStatus() {
  return {ScanInProgress: 0, ScanPossible: 0, Source: 'Cable', SourceList: ['Cable']};
}

export function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'})[c]);
}

export function deviceXml(base, config) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <URLBase>${escapeXml(base)}</URLBase>
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${escapeXml(config.deviceName)}</friendlyName>
    <manufacturer>Tohyee TV</manufacturer>
    <modelName>HDTC-2US</modelName>
    <modelNumber>HDTC-2US</modelNumber>
    <serialNumber>${escapeXml(config.deviceId)}</serialNumber>
    <UDN>uuid:${escapeXml(config.deviceId)}</UDN>
  </device>
</root>
`;
}

// Only accept a plain host[:port] (name, IPv4 or bracketed IPv6) from the
// request's Host header; anything else falls back to the given default.
export function baseUrl(hostHeader, fallback) {
  const host = String(hostHeader ?? '').trim();
  if (/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/.test(host)) return `http://${host}`;
  return fallback;
}
