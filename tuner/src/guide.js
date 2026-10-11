// A rolling XMLTV guide for the single channel, so Plex has something to show
// in its programme guide. One-hour blocks covering the past 2 hours and the
// next 48 hours, aligned to the hour, in the computer's local time zone.

import {escapeXml} from './hdhr.js';

const pad = n => String(n).padStart(2, '0');

// XMLTV time format: YYYYMMDDHHMMSS +HHMM (local time with its UTC offset).
export function xmltvTime(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

export function channelId(config) {
  return `tohyee.${config.channelNumber}`;
}

export function xmltv(config, now = new Date(), hoursBack = 2, hoursAhead = 48) {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() - hoursBack);
  const id = escapeXml(channelId(config));
  const name = escapeXml(config.channelName);
  const title = escapeXml(config.programmeTitle);
  const programmes = [];
  for (let i = 0; i < hoursBack + hoursAhead; i++) {
    const from = new Date(start); from.setHours(start.getHours() + i);
    const to = new Date(start); to.setHours(start.getHours() + i + 1);
    programmes.push(`  <programme start="${xmltvTime(from)}" stop="${xmltvTime(to)}" channel="${id}">
    <title lang="en">${title}</title>
    <desc lang="en">Live from your computer with Tohyee TV.</desc>
  </programme>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="Tohyee TV">
  <channel id="${id}">
    <display-name>${name}</display-name>
    <display-name>${escapeXml(config.channelNumber)}</display-name>
  </channel>
${programmes.join('\n')}
</tv>
`;
}
