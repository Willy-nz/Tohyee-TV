# Tohyee TV

**Your Chrome tab, live on Plex.** Tohyee TV turns a Chrome tab, picture and sound, into a live TV channel you can watch on any Plex app. No TV tuner, and nothing else to install.

**Website:** https://willy-nz.github.io/Tohyee-TV/
**Download:** [latest release](https://github.com/Willy-nz/Tohyee-TV/releases/latest) (Windows 64-bit installer)

## What it does

- **Picture and sound, even minimised.** Chrome keeps sending the tab while it's minimised or in the background.
- **Up to eight channels.** Each channel has its own tab, name, number, stream and guide entry. Stop one and the others keep playing.
- **Only works when you're watching.** Nothing is sent until someone plays the channel in Plex. Several screens watching one channel share one stream.
- **Standby frees your stream.** Many services limit how many devices can watch at once, and a paused video still counts. When nobody is watching a channel (including one nobody has watched yet), the extension pauses the video, then after a set time (1 minute by default) moves the tab to a standby page, which closes the site's player. When someone starts watching, it goes back to the same page and presses Play. Choose *Leave the video page*, *Pause the video* or *Keep playing* in the extension.
- **Light on your PC.** When Chrome already sends H.264, the picture is passed straight through instead of being compressed again; only the sound is converted. Other formats use the bundled encoder.
- **Sky Go channels built in** (0.7.1 test build). One click fills in all 61 Sky Go live channels, with their page addresses and programme guide matches.
- **Starts by itself** (new in 0.7.0). Tohyee TV can open its own Chrome window and start your channels without a click, after a restart or after Windows is unlocked (Settings → Start broadcasting by itself).
- **Stays at home.** Runs on your computer and home network: no accounts, no cloud, no router changes.
- **Updates from the app.** The app checks GitHub when it starts and once a day. When there's a new version, click **Update now** and it downloads, checks and installs it, then opens again (Settings → Updates). Nothing installs until you click.

## Quick start

1. **Install.** Run the installer from the [latest release](https://github.com/Willy-nz/Tohyee-TV/releases/latest). FFmpeg and the runtime are included. It isn't code-signed yet, so if Windows shows a SmartScreen warning, choose **More info → Run anyway**.
2. **Add the Chrome extension.** In Chrome go to `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick the folder the app's **Connect to Plex** page opens. Pin the Spitz icon.
3. **Connect in Plex.** Plex → **Settings** → your server → **Live TV & DVR** → **DVR Setup**. Enter the tuner address shown in the app, use its XMLTV guide address for the guide, and map the channel.
4. **Broadcast.** Open your video tab, click the Spitz icon, choose the channel and **Broadcast this tab to Plex**, then play the channel in Plex. The app also has a built-in test picture for checking Plex on its own.

**Already have a DVR in Plex?** Using an XMLTV guide can mean recreating your existing DVR setup. Check Plex's instructions before changing anything.

**Upgrading?** From 0.6.1 on, click **Update now** in the app. From 0.6.0 or earlier, quit the old app from its tray menu and run the new installer. Either way, reload the extension at `chrome://extensions` (upgrading to 0.7.0: remove it and load it again, because its ID changed) so it shows the new version.

### Requirements

- Windows (64-bit)
- Google Chrome 116 or newer (Tohyee TV is Chrome only)
- Plex Media Server on the same PC or your home network. Plex says recording needs Plex Pass; Live TV features and labels vary by Plex version and account.

## Good to know

- Some sites protect their video from capture, which shows as a black picture. Tohyee TV doesn't get around that, or around a service's own viewing limits.
- Standby closes the site's player, but the service decides how quickly it frees the stream.
- Updating restarts the tuner, which stops all broadcasts; click Broadcast again in each tab afterwards.
- Plex can only rewind what it has received since you started watching.
- The tuner defaults to this computer only. Turning on access for a Plex server elsewhere on your network allows local-network connections only; Windows Firewall should be set to **Private networks**.
- Saving the channel list or restarting the tuner stops all broadcasts; start each tab again afterwards.

## Development

- `desktop/` — the Electron desktop app and Windows installer configuration.
- `tuner/` — the program Plex sees as a network tuner (Node.js + FFmpeg). Command-line usage: [tuner/README.md](tuner/README.md).
- `extension/` — the Chrome extension that captures the chosen tab and sends it to the tuner while Plex is watching.
- `site/` — the website, published to GitHub Pages from `main` by `.github/workflows/website.yml`.
- `docs/DEVELOPMENT_PLAN.md` — product and development plan.

Run the tests with `npm test` (Node 20+). `scripts/e2e-chrome.mjs` runs the real extension code against a running tuner, with Chrome's recorder simulated by FFmpeg.

Releases are published by `.github/workflows/windows-installer.yml` when the version in `desktop/package.json` changes on `main`. Versions with a suffix (for example `0.7.0-alpha.1`) are published as test releases.

Tohyee TV isn't affiliated with Plex or Google. Plex and Chrome are trademarks of their owners.

## Reusable tabs and real programme listings

The Channels page can use a pool of 1–8 reusable Chrome tabs (default count: 3), independently of a lineup of up to 200 channels. Existing installations retain dedicated-tab mode until you choose Reusable tabs. Save each channel’s direct HTTPS video-page link, arm a different reusable slot in each Chrome tab, then tune through Plex. A watched slot is never taken away for another channel; additional viewers of the same channel share it.

Enable NZXMLTV Sky listings to download and cache the fixed-ID Sky XMLTV feed. Select a guide match per channel and refresh Plex’s existing `/guide.xml` source. Listings refresh every six hours while enabled; failed downloads retain the cache. File import supports XML or gzip. Adding channels from the guide fills names and guide IDs, but video links must be supplied separately.

See [test release instructions](desktop/RELEASE_NOTES.md) for setup and limitations. Website navigation/capture still requires manual Windows testing. Use the three reusable tabs only for broadcasting while armed.
