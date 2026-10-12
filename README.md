# Tohyee-TV
Turns a **Chrome tab** (picture and sound) into a live TV channel in **Plex**, using FFmpeg and HDHomeRun-compatible tuner emulation. No physical TV tuner required. Chrome only.

## Windows installer

Download the Windows x64 test installer from [Releases](https://github.com/Willy-nz/Tohyee-TV/releases). FFmpeg and the app runtime are included: no separate encoder or Node.js installation is needed.

Close the old command-window tuner before launching the app. Open **Connect to Plex** for the Chrome extension and Plex setup steps. Chrome requires a one-time **Load unpacked** step and an explicit click to start capturing a tab.

The app includes a Spitz tray icon, optional startup at Windows sign-in, and a visible LIVE indicator with a Stop button. Closing the main window keeps it in the tray; use the tray menu to quit. Startup does not automatically capture a tab.

Automatic mode copies compatible H.264 video and converts audio to AAC. Other video formats use the bundled encoder. Select Compatibility in Settings if playback needs video re-encoding. Protected content may not be capturable.

The test installer is unsigned. Actual Chrome/Plex playback and Windows startup behaviour still need manual testing. Encoder licences and matching sources are included and accessible from Settings.

## Multiple channels

Use **Channels** in the Windows app to add up to eight named channels. Save, then select the matching channel in the Chrome extension on each source tab. Each channel needs a different tab and an explicit Broadcast click. Rescan channels and refresh/map the XMLTV guide in Plex after changing the lineup.

When upgrading, reload the extension at `chrome://extensions` and confirm version 0.5.0. If you loaded an older extracted extension folder, use the installed app’s extension folder instead. Saving the lineup stops broadcasts; start each tab again afterwards. Pausing a website may not release its streaming-service viewing slot.

## Development

- `desktop/` — the Electron desktop app and Windows installer configuration.
- `tuner/` — the program Plex sees as a network tuner (Node.js + FFmpeg). Command-line setup and usage: [tuner/README.md](tuner/README.md).
- `extension/` — the Chrome extension that captures the chosen tab and sends it to the tuner while Plex is watching.
- `docs/DEVELOPMENT_PLAN.md` — product and development plan.

Run the tests with `npm test` (Node 20+). `scripts/e2e-chrome.mjs` runs the real extension code against a running tuner, with Chrome's recorder simulated by FFmpeg.
