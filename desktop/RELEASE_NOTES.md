Windows x64 installer for Tohyee TV: broadcast Chrome tabs to Plex as live TV channels. FFmpeg and the runtime are included, so there's nothing else to install.

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

Processing starts when Plex watches a channel. Paused website players may still consume a provider’s viewing slot; this release does not guarantee those slots are released, or bypass service limits or protected capture. Pause in Plex does not necessarily pause the browser. Start with ordinary unprotected videos or the built-in test picture.

Automated tests cover isolated captures, channel routing, guide entries, concurrent media streams and packaged Windows startup. Actual Chrome/Plex playback, minimized capture and provider behaviour still require manual testing.

The installer isn't code-signed yet, so Windows may show an unknown-publisher/SmartScreen warning. Choose **More info → Run anyway** if you trust this download. Bundled encoder licences and matching source archives are available from Settings.
