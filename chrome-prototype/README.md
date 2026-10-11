# Tohyee TV Chrome capture check — 0.2.0 alpha

This is a local **30-second recording test**, not a Plex broadcaster. The offscreen extension document owns capture, so closing the popup does not stop the test. It requests both video and audio from the selected tab through Chrome's supported tabCapture API. It does not access source URLs, cookies or page contents.

## Install
1. Extract the Chrome release ZIP into a folder you will keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.
4. Pin **Tohyee TV Chrome Capture Check** from Chrome's extensions menu.

Use current desktop Chrome (minimum version 116). No Node installation/build is needed. Chrome does not support SVG manifest icons; the Spitz is shown inside the popup, and the toolbar shows a status badge.

## Test
1. First open an ordinary unprotected video with sound. Click this extension while that source tab is active.
2. Click **Start 30-second test**. The tab's picture and audio are recorded locally in memory. A red REC badge appears on the pinned extension.
3. Close the popup, switch tabs for about 10 seconds, then minimise Chrome for about 10 seconds. Leave the source tab open and the computer awake.
4. After 30 seconds, restore Chrome and open the extension. Play the test clip with its video controls to check picture and sound throughout the test.
5. Repeat on your intended source. Do not assume protected content will be available or that all players behave the same when minimised.
6. Use **Stop early** to finish sooner, or **Delete test clip** to discard the result.

The clip expires after 10 minutes, is replaced on the next test, and is not persisted across browser restarts. No download/upload or Plex transmission occurs. Capture stops automatically after 30 seconds (or at a 32 MB safety cap). Normal browser stop-sharing and closing the captured tab also stop capture. Tab audio is routed back to the computer while capturing; verify sound in the recorded clip even if local listening is silent.

## What to report
- Chrome and Windows versions.
- Whether the replay has moving video and audible sound.
- Whether either stops during the background or minimised portions.
- Visible error and track counts, without sharing private video/account details publicly.

## Limits and validation
No DRM bypass, source extraction, automatic refresh, startup, Windows installer or Plex connection. A browser API success or audio track does not prove playable content. Real Windows/Chrome capture and minimised behaviour remain manual compatibility tests. The offscreen page is kept alive to retain the temporary replay until it expires.

References: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture and https://developer.chrome.com/docs/extensions/reference/api/tabCapture
