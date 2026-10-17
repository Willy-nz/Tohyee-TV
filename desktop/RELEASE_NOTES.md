Windows test installer: reusable capture tabs and real Sky NZ programme listings. FFmpeg remains included.

## New in alpha.3: start broadcasting by itself

Tohyee TV can now start your channels without a click, for example after the computer restarts. It opens its own Chrome window (a separate Chrome profile, with its own sign-ins), started with Chrome's setting that lets the Tohyee TV extension capture tabs without being clicked. The window opens each channel's saved page (or, with reusable tabs, the website's front page) and starts broadcasting. It does this when the app starts, and again after Windows is unlocked or wakes up, reusing the tabs it opened before.

Set up once, in **Settings → Start broadcasting by itself**:
1. Tick **When Tohyee TV starts, open its Chrome window and start broadcasting**, and **Start Tohyee TV when I sign in to Windows**.
2. Click **Set up Chrome window** and follow the page it opens: add the extension in that window (chrome://extensions → Developer mode → Load unpacked), sign in to your video website, and click **Arm this tab for Plex** once on that site so the extension may press Play and Pause.
3. Make sure every channel has its video page address (Channels).

Things to know:
- Windows has to sign in by itself after a restart, and broadcasting stops while Windows is locked (it starts again when unlocked).
- If the video website signs you out, sign in again in the Tohyee TV Chrome window.
- The extension now has a fixed ID, so Chrome treats it as a new extension. In your usual Chrome, remove the old Tohyee TV extension and load it again, then set its options and site permission again.
- Tested in Chromium (the open-source version of Chrome): no-click start, both capture modes, and starting again after a stop. Not yet tested in Google Chrome on Windows, or with Sky Go.

## Set up reusable tabs

1. Quit the old app from the tray, install this version, then reload the Chrome extension at chrome://extensions. Confirm extension version 0.7.0.
2. In **Channels**, choose **Reusable tabs**, leave the maximum at **3**, and apply. Existing installations keep dedicated mode until you switch. You can choose 1–8 tabs independently of the channel lineup (up to 200 channels).
3. Give each channel its actual HTTPS live-video page address. Open that channel in Sky Go and copy its page address. Use links that load the intended channel directly; a generic homepage or a replay link is not a live-channel selector.
4. Open three tabs on the same video website and sign in. In the extension on each tab, select a different reusable slot and click **Arm this tab for Plex**. Allow the website permission so the extension can press Play. Keep these tabs open; capture still requires your initial click.
5. Select a channel in Plex. An available tab switches to its saved page. Viewers of the same channel share a tab. A fourth different channel is refused while all three are watched. When a slot becomes idle, the player page is closed and the slot can be reused. A website may take time to release a session.

The reusable tabs are dedicated to Tohyee while armed. Do not browse manually in them while someone is watching. All saved channel links must be on the same HTTPS origin as the tab authorised for capture. Channel switching may take several seconds, and login/consent screens or sites without a direct channel link may need manual attention. No DRM or service-limit bypass is provided.

## Programme guide

Enable **Use NZXMLTV Sky listings** in Channels and refresh. The app uses https://nzxmltv.com/sky/guide-static.xml.gz, caches the last successful guide, and refreshes every six hours while enabled. XMLTV .xml/.gz file import is also available.

Choose a guide match for each channel, or use **Add channels from downloaded guide** to populate names and mappings. This does not discover video page links: paste those separately, remove unwanted channels, and save. Your own Plex channel numbers are preserved independently of the provider’s stable guide IDs.

Plex continues to use the app’s /guide.xml address. Rescan/map the changed channels and refresh the guide in Plex. Unmapped channels retain placeholder listings. Review the guide’s update status if listings are missing; failed downloads keep the previous cache. NZXMLTV is a third-party listing source, not a video source.

## Validation and limitations

Unit tests cover leases, capacity, cancellation, guide mapping, gzip import and cache preservation. Real HTTP/WebSocket/FFmpeg smoke tests exercise three streams, shared viewers, refusing a fourth, and retuning a released slot. Browser capture and navigation are simulated in that test; actual Sky Go switching, protected-video capture and Plex playback still require manual Windows testing.

The live NZXMLTV feed was downloaded and parsed during development (98 channels, including ESPN and ESPN 2). The installer is unsigned and may trigger a Windows SmartScreen warning.
