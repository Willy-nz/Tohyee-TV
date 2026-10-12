# Tohyee TV

**Your Chrome tab, live on Plex.** Tohyee TV turns a Chrome tab, picture and sound, into a live TV channel you can watch on any Plex app. No TV tuner, and nothing else to install.

**Website:** https://willy-nz.github.io/Tohyee-TV/
**Download:** [latest release](https://github.com/Willy-nz/Tohyee-TV/releases/latest) (Windows 64-bit installer)

## What it does

- **Picture and sound, even minimised.** Chrome keeps sending the tab while it's minimised or in the background.
- **Up to eight channels.** Each channel has its own tab, name, number, stream and guide entry. Stop one and the others keep playing.
- **Only works when you're watching.** Nothing is sent until someone plays the channel in Plex. Several screens watching one channel share one stream.
- **Standby frees your stream** (new in 0.6.0). Many services limit how many devices can watch at once, and a paused video still counts. When nobody is watching, the extension pauses the video, then after a set time (1 minute by default) moves the tab to a standby page, which closes the site's player. When someone starts watching, it goes back to the same page and presses Play. Choose *Leave the video page*, *Pause the video* or *Keep playing* in the extension.
- **Light on your PC.** When Chrome already sends H.264, the picture is passed straight through instead of being compressed again; only the sound is converted. Other formats use the bundled encoder.
- **Stays at home.** Runs on your computer and home network: no accounts, no cloud, no router changes.

## Quick start

1. **Install.** Run the installer from the [latest release](https://github.com/Willy-nz/Tohyee-TV/releases/latest). FFmpeg and the runtime are included. It isn't code-signed yet, so if Windows shows a SmartScreen warning, choose **More info → Run anyway**.
2. **Add the Chrome extension.** In Chrome go to `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick the folder the app's **Connect to Plex** page opens. Pin the Spitz icon.
3. **Connect in Plex.** Plex → **Settings** → your server → **Live TV & DVR** → **DVR Setup**. Enter the tuner address shown in the app, use its XMLTV guide address for the guide, and map the channel.
4. **Broadcast.** Open your video tab, click the Spitz icon, choose the channel and **Broadcast this tab to Plex**, then play the channel in Plex. The app also has a built-in test picture for checking Plex on its own.

**Already have a DVR in Plex?** Using an XMLTV guide can mean recreating your existing DVR setup. Check Plex's instructions before changing anything.

**Upgrading?** Quit the old app from its tray menu, run the new installer, then reload the extension at `chrome://extensions` so it shows the new version.

### Requirements

- Windows (64-bit)
- Google Chrome 116 or newer (Tohyee TV is Chrome only)
- Plex Media Server on the same PC or your home network. Plex says recording needs Plex Pass; Live TV features and labels vary by Plex version and account.

## Good to know

- Some sites protect their video from capture, which shows as a black picture. Tohyee TV doesn't get around that, or around a service's own viewing limits.
- Standby closes the site's player, but the service decides how quickly it frees the stream.
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
