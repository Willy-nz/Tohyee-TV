// Browser-player presets, not direct media URLs. Playback needs a local NZ test.
// Leave guide IDs unset: select a match from the user's actual XMLTV listings.
window.FREEVIEW_CHANNELS = {
  tvnz: [
    {channelNumber: '1', channelName: 'TVNZ 1', url: 'https://www.tvnz.co.nz/player/channel/tvnz-1'},
    {channelNumber: '2', channelName: 'TVNZ 2', url: 'https://www.tvnz.co.nz/player/channel/tvnz-2'},
    {channelNumber: '6', channelName: 'TVNZ DUKE', url: 'https://www.tvnz.co.nz/player/channel/tvnz-duke'}
  ],
  threenow: [
    {channelNumber: '3', channelName: 'Three', url: 'https://www.threenow.co.nz/live-tv-guide/three'},
    {channelNumber: '4', channelName: 'Bravo', url: 'https://www.threenow.co.nz/live-tv-guide/bravo'},
    {channelNumber: '8', channelName: 'eden', url: 'https://www.threenow.co.nz/live-tv-guide/eden'},
    {channelNumber: '14', channelName: 'Rush', url: 'https://www.threenow.co.nz/live-tv-guide/rush'},
    {channelNumber: '17', channelName: 'HGTV', url: 'https://www.threenow.co.nz/live-tv-guide/hgtv'}
  ]
};
// Existing numbers are Plex identities. Never overwrite or remove an existing row.
window.mergeBrowserPresets = function(existing, presets) {
  const channels = existing.map(c => ({...c}));
  const numbers = new Set(channels.map(c => c.channelNumber));
  const urls = new Set(channels.map(c => c.url?.replace(/\/$/, '')).filter(Boolean));
  let added = 0, skipped = 0, renumbered = 0;
  for (const preset of presets) {
    const url = preset.url.replace(/\/$/, '');
    if (urls.has(url)) { skipped++; continue; }
    if (channels.length >= 200) break;
    let number = preset.channelNumber;
    if (numbers.has(number)) {
      let n = 1000; while (numbers.has(String(n))) n++;
      number = String(n); renumbered++;
    }
    channels.push({...preset, channelNumber: number, guideId: '', programmeTitle: preset.channelName});
    numbers.add(number); urls.add(url); added++;
  }
  return {channels, added, skipped, renumbered};
};
