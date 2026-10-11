Windows x64 test installer with FFmpeg included. No separate encoder or Node download.

- Guided Chrome extension and Plex setup in a desktop app.
- Spitz tray icon, optional start at Windows sign-in, visible LIVE indicator and Stop control.
- Automatic H.264 video passthrough, AAC audio conversion, and software encoding fallback.
- Local-only tuner by default; opt into home-network access if Plex runs on another device.
- Capture stops when Windows locks or sleeps. App startup does not silently start Chrome capture.

Run **Tohyee-TV-Setup-0.4.0-alpha.1.exe**. Close the old command-window tuner first. Open the installed app and follow **Connect to Plex**. Chrome still requires a one-time Load unpacked step and an explicit click to broadcast a tab.

The bundled FFmpeg build includes GPL notices, matching source archives and build instructions under its installation directory (also accessible from Settings). Electron licence notices accompany the app.

This installer is unsigned: Windows may show an unknown-publisher/SmartScreen warning. Automated media and packaged-launch checks are run during the build; actual Plex/Chrome playback and Windows startup behaviour still need user testing. Protected video capture is not guaranteed. Not yet a production release.
