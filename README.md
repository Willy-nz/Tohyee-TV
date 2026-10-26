# Tohyee TV

**Your Chrome tabs, live on Plex.** A Windows app that captures browser picture and sound and presents your channels to Plex as a network TV tuner. The installer includes FFmpeg and the runtime; Google Chrome and Plex Media Server are required separately.

[Website](https://willy-nz.github.io/Tohyee-TV/) · [Download the Windows installer](https://github.com/Willy-nz/Tohyee-TV/releases/latest) · [Release notes](desktop/RELEASE_NOTES.md)

## Current release: 0.8.2

The sound sent to Plex is now the tab's own captured sound, with no mixing in Chrome. Earlier versions mixed it in Chrome's Web Audio, which could drift about 2 seconds late on a speaker-less server (0.8.0) or stutter after running for a day (0.8.1). The tuner still adds a steady silent track so Plex always has sound.

From 0.8.0: The app now warns when the screen's refresh rate doesn't suit your channels, or when Chrome captures well below their frame rate, and says how to fix it. Testing showed a computer with no monitor captured only about 32 frames a second; a screen at 50 Hz (a monitor, or an HDMI dummy display plug) gave Sky's full 50.

From 0.7.9: Smoother picture: Chrome now captures every screen redraw instead of every other one, so frames are evenly spaced (about 32 uneven frames a second before, on a 60 Hz screen). For an exact 50 fps match with Sky, give the computer a 50 Hz screen (a dummy display plug works on a computer with no monitor). The sound is now labelled English in Plex.

From 0.7.8: The extension now records with the computer’s hardware video encoder (for example Intel Quick Sync) when Chrome can use one. That gives standard H.264 High at the full frame rate (50 fps) with little CPU, so Plex apps such as Fire TV can play it without Plex converting it. Without a hardware encoder it falls back to Chrome’s own recorder, as before. The log shows which encoder was used. Every channel also keeps the steady silent audio track added in 0.7.7.

**After updating the app, reload the extension at `chrome://extensions`, confirm version 0.8.2, then arm the tabs again or click Start channels now.** The app installer does not reload an extension already running in Chrome.

## What it does

- **A large lineup with a few tabs.** Configure up to 200 channels and use 1–8 reusable capture tabs, with three as the default. Three tabs can serve three different channels at once; viewers of the same channel share a tab. A fourth different channel is refused while all three slots are busy; try again after a slot is released. Dedicated-tab mode is also available.
- **Sky Go channel presets.** Add Sky Go channels fills in 61 channel names, numbers, page links and guide matches from the bundled October 2026 list. Website addresses can change; edit them when needed. Your own subscription and website sign-in are required.
- **Programme listings and logos.** Optional NZXMLTV Sky listings feed Plex through the app’s XMLTV address. Listings refresh every six hours while enabled, with the last successful download cached. XML and gzip guide imports are supported.
- **50 or 25 fps capture.** The extension requests up to 50 fps by default; choose 25 fps for less work on the PC. Actual frame rate depends on the source, Chrome and the computer. Full 1080p also needs a sufficiently large tab and screen.
- **Less encoding when possible.** Compatible H.264 video passes through; audio is converted to AAC. Other formats, or streams needing the compatibility fallback, are encoded again and use more CPU.
- **Automatic startup.** Optionally start with Windows and open a dedicated Chrome profile to arm your channels. A Spitz tray icon and live indicator show when the app is broadcasting.
- **Standby when idle.** Reusable tabs leave the player page when their channel is released. Dedicated tabs offer leave-page, pause or keep-playing options. The service determines when a playback session stops counting towards its limits.
- **Updates in the app.** Check for releases and choose Update now. Updating stops broadcasts; reload the Chrome extension and start channels afterwards.

## Set up

1. **Install** the Windows 64-bit installer from the latest release. It is currently unsigned; download only from this repository’s release page.
2. **Add the extension.** Open the extension folder from Connect to Plex. In Chrome, open `chrome://extensions`, enable Developer mode, choose Load unpacked and select that folder. Pin the Spitz icon. For automatic startup, use Settings → Set up Chrome window and install the extension in that window’s separate profile.
3. **Configure channels.** In Channels, choose Add Sky Go channels or enter your own direct HTTPS video-page links. Save channels. For a large lineup, choose Reusable tabs, select a count (start with three), and click Apply capture settings. Existing installations keep their previous capture mode until changed.
4. **Arm capture.** Open the chosen number of tabs on the same video website and sign in. In each tab’s extension popup, select a different reusable slot and click Arm this tab for Plex. Grant the website permission to press Play and Pause. Keep these tabs reserved for broadcasting. In dedicated mode, select a channel instead of a reusable slot.
5. **Enable the guide.** In Channels, enable Use NZXMLTV Sky listings, refresh the guide and check each channel’s guide match. Add channels from downloaded guide supplies names and guide matches only; unlike the Sky Go preset, it does not supply video-page links.
6. **Connect Plex.** Follow Connect to Plex in the app. In your Plex server’s Live TV & DVR settings, add the tuner using the displayed address and supply the displayed XMLTV guide address (`/guide.xml`). Map the channels. If Plex runs on another PC, enable network access and use the Tohyee PC’s LAN address. Rescan channels and refresh Plex’s guide after changing the lineup.
7. **Watch.** Select a channel in Plex. A reusable tab opens its saved page; switching can take several seconds. Test with the built-in test picture first if you need to check the Plex connection independently of Chrome.

Plex’s setup screens and subscription requirements may vary. Review your existing DVR configuration before changing its guide source.

## Start automatically and run in the background

In Settings, enable Start Tohyee TV when I sign in to Windows and the option to open its Chrome window and start broadcasting. Use Set up Chrome window once to install the extension, sign in to your video site and grant playback permission. Then use Start channels now to check the setup.

Windows must be signed in. Capture stops when Windows locks or sleeps; automatic startup can re-arm after unlock or wake. If the website signs you out, sign in again in Tohyee TV’s Chrome profile.

Minimised capture depends on the computer. The app can minimise its own Chrome window and attempts to restore it if incoming media stops while someone is watching. If playback stalls, turn off automatic minimising and click Show Chrome window. Leaving Chrome visible is a useful diagnostic step.

For a PC without a monitor, Settings → Screen size can request 1920×1080 if the display supports it. This cannot create extra detail in a lower-resolution source.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Still seeing 30 fps | Reload the installed extension, confirm its version, choose 50 fps under Smoothness and re-arm. Extensions older than 0.7.2 cap capture at 30 fps. The built-in test picture is intentionally 30 fps. The selected setting is a limit, not a measured output rate. |
| Could not tune channel / no audio | Install 0.7.7 or later, reload the extension and start channels again. Unmute the website player if the picture works but sound is silent. |
| Playback stops when minimised | Disable automatic minimising and use Show Chrome window, then tune again in Plex. |
| Another channel will not start | Check that a reusable slot is armed and free, its saved link opens the correct channel, and the website is signed in. |
| Black picture | Try an unprotected video. Protected content may not be capturable. |
| Plex cannot connect | Try the built-in test picture. Check the tuner address, port (34500 by default), network access and Private-network firewall permission. |

If a problem remains, copy Help & diagnostics → Recent activity immediately after the failure, before restarting the app: activity is kept in memory. Include the app and extension versions, channel, Plex error and whether Chrome was minimised.

## Limits and privacy

- Capture does not bypass DRM or a service’s viewing limits. Channel presets and programme listings do not provide a video subscription.
- Channel switching needs direct links on the same HTTPS origin as the authorised capture tab. Login, consent and player changes may require manual attention.
- Closing an armed tab ends its capture. Saving channels, restarting the tuner or updating can interrupt broadcasts.
- Tohyee TV does not provide a catch-up archive. Plex’s live buffer only contains media received during viewing; recording is managed by Plex.
- The tuner defaults to this PC only. Use Private-network firewall permissions when enabling access from your home network; no router port forwarding is needed for local use.
- Captured media is sent locally to the tuner and your Plex server. Update checks contact GitHub, optional guide downloads contact NZXMLTV, and Chrome connects to your chosen video website.

## Docker server image (experimental)

A Linux amd64 Docker image packages the tuner and FFmpeg for server users. See [Docker setup and Compose instructions](docker/README.md). Settings and guide data persist in a Docker volume.

This is the tuner server only: live video still requires Chrome and the extension in a graphical session on the same Linux host. It does not run Sky Go on a headless NAS or replace the Windows installer’s desktop controls.

## Development

- `desktop/` — Electron desktop app and Windows installer configuration.
- `tuner/` — Node.js tuner and FFmpeg integration; see [CLI instructions](tuner/README.md).
- `extension/` — Chrome tab capture, audio and channel switching.
- `site/` — website published from main by `.github/workflows/website.yml`.
- `docs/DEVELOPMENT_PLAN.md` — development plan.

Run `npm test` with Node 20+. Automated tests do not establish that a particular website, Windows display setup or Plex client will work: test those on the target PC.

The Windows installer workflow publishes when `desktop/package.json` changes on main. Versions with a suffix are test releases. See [release notes](desktop/RELEASE_NOTES.md) for upgrade details, including reinstalling extensions from before the 0.7.0 extension-ID change.

Tohyee TV is not affiliated with Plex, Google, Sky or NZXMLTV. Trademarks belong to their respective owners.
