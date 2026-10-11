# Firefox capture check — 0.1.0-alpha.2

A local preview prototype, **not yet the Windows app or a Plex broadcaster**. It uses Firefox's normal `getDisplayMedia()` picker. It does not extract media URLs, access page contents, bypass protection, record, or send media anywhere.

## Updates
When the control tab opens, it asks GitHub's public Releases API whether a newer test build exists and shows a banner with a link if so. Use **Check for updates now** at the bottom of the page to check manually. Only public release information is downloaded; no account details, capture data or page contents are sent. Firefox can't replace a temporary add-on automatically: download the new zip, remove the old add-on in `about:debugging`, and load the new `manifest.json`.

To publish a new build, bump `CURRENT_VERSION` in `version.js` (and the last number of `version` in `manifest.json`) and push to this branch.

## Run on Windows
1. Download this branch from GitHub using **Code → Download ZIP**, and extract it.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `firefox-prototype/manifest.json` from the extracted folder.
4. Open the Tohyee TV extension from the toolbar/extensions menu. Its Spitz button opens the capture control tab.
5. Open the video/source you want to test in a **separate browser window**. First test ordinary, unprotected video or an animated webpage.
6. In the control tab, click **Choose source & start**, then select the source window in Firefox's picker. Do not select the control tab or its window (that creates a repeated mirror).
7. Check actual moving video in the preview. Read the Audio field. If Firefox returns an audio track, use headphones and **Listen to captured audio** to verify it.
8. Switch windows, then minimise the source window and check each behaviour. Do not assume background/minimised capture works for every source.
9. Click **Stop capture**, use Firefox's stop-sharing control, or close the control tab to stop.

Temporary add-ons disappear when Firefox restarts. No developer tools, Node or build step is needed to load these files. This is unsigned development software, not a permanent add-on release.

## Important limitations
- Firefox does not expose Chrome's `tabCapture` extension API. This test offers Firefox's own window/screen choices; it does not promise isolated tab capture.
- Requesting `audio: true` does not guarantee audio. Firefox may return video only. A future Windows companion may need WASAPI loopback audio capture, with synchronisation tested separately.
- Protected video may be black or unavailable. Black video alone does not identify the cause. If the picture stays completely black for a few seconds, the page shows a warning with things to try (unminimise the window, start playback, reload the source). This prototype does not change DRM settings or work around capture protection.
- The source must remain open. The control tab must also remain open to own the capture session.
- Local capture is not broadcasting: no Plex, FFmpeg, server, startup setting, background refresh, media export or network receiver is implemented.
- There are no host permissions, content scripts, microphone requests or persistent settings. The only network request the extension makes is the GitHub update check. The browser itself may perform its normal background networking.

## Report the result
Record Firefox and Windows versions, source type (window/screen), visible moving picture yes/no, audio track present yes/no, audible sound yes/no, and behaviour when backgrounded/minimised. Do not include account details, private URLs or screenshots containing private information in a public issue.

## Validation
Run `npm test` with a current Node.js to test cancellation, permission denial, browser stop-sharing and track cleanup. These mocked lifecycle tests do not prove actual Firefox/Windows capture compatibility. A real Windows Firefox manual test is still required.

References:
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Temporary_Installation_in_Firefox
