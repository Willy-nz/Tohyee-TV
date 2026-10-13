Test build of Tohyee TV 0.6.1: broadcast Chrome tabs to Plex as live TV channels. FFmpeg and the runtime are included, so there's nothing else to install.

**New in 0.6.1 — steadier passthrough.** The extension now asks Chrome for a keyframe (a "fresh start" picture) every 2 seconds, which Plex needs to start the channel quickly and to let a second screen join cleanly. If Chrome doesn't send them, the tuner notices within about 6 seconds and switches that channel to compatibility encoding without disconnecting anyone. The tuner window says when that happens.

**New in 0.6.1 — update checker.** The app checks GitHub when it starts and once a day, and tells you when a new version is out: a Windows notification, a banner with a **Download** button, and an item in the tray menu. It only reads the public list of releases and never installs anything itself. Turn it off, or include test builds, under **Settings → Updates**. After you upgrade, the app reminds you to reload the Chrome extension.

After installing, reload the extension at `chrome://extensions` so it shows version **0.6.1**.

---

**New in 0.6.0 — standby frees your stream.** Services such as Sky Go limit how many devices can watch at once, and a paused video still counts. Now, when nobody is watching a channel in Plex, the extension pauses the video straight away and, after a set time (1 minute by default), moves the tab to a Tohyee TV standby page. That closes the site's player, the same as leaving the page yourself. When someone starts watching, it goes back to the same video page and presses Play — no need to click Broadcast again.

Choose what happens in the extension under **When nobody is watching in Plex**: *Leave the video page* (default), *Pause the video*, or *Keep playing*, and how long to wait before leaving. Pressing Play and Pause needs the one-time site permission Chrome asks for.

After installing, reload the extension at `chrome://extensions` so it shows version **0.6.0**.

How quickly a service frees the stream after the player closes is up to the service; some take a few minutes.

---

- Add up to eight named channels in the Windows app, each with its own Plex stream and guide entry.
- Assign a different Chrome tab to each channel using the extension’s channel dropdown.
- Each channel has its own capture, encoder and Stop control. Multiple viewers of the same channel share one output.
- Compatible H.264 video uses passthrough; other formats use the bundled encoder.

## Upgrade and test

1. Quit the old Tohyee TV app from its tray menu, then run the installer.
2. Open **Channels**, add names and unique numbers, and click **Save channels & restart tuner**. Your existing channel is retained when upgrading.
3. Reload the Tohyee TV extension at `chrome://extensions` so Chrome loads version **0.5.0**. If it points to an older extracted folder, remove that old extension and load the folder opened by the new app’s **Connect to Plex** page. Chrome may ask for the new permission to read the local tuner’s channel list.
4. Open each source tab, click the extension, choose its channel and click **Broadcast this tab to Plex**. Click **Refresh channels** if needed. Each tab can be assigned to one channel.
5. In Plex, rescan the tuner’s channels, refresh the XMLTV guide, and map the new channels. Keep existing channel numbers to preserve mappings. The guide contains generic channel labels, not provider schedules.
6. Try two channels at once, then stop one and check that the other keeps playing. Saving the channel list or restarting the tuner stops all captures; reconnect the tabs afterwards.

Processing starts when Plex watches a channel. Standby closes the website's player but can't control when the service frees the stream, and it doesn't bypass service limits or protected capture. Pause in Plex does not necessarily pause the browser. Start with ordinary unprotected videos or the built-in test picture.

Automated tests cover isolated captures, channel routing, guide entries, concurrent media streams and packaged Windows startup. Actual Chrome/Plex playback, minimized capture and provider behaviour still require manual testing.

The installer isn't code-signed yet, so Windows may show an unknown-publisher/SmartScreen warning. Choose **More info → Run anyway** if you trust this download. Bundled encoder licences and matching source archives are available from Settings.
