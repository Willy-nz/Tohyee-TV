# Tohyee TV — Chrome tab to Plex (version 0.3.1)

Tohyee TV turns a **Chrome tab** (picture and sound) into a **live TV channel in Plex**. It works with **Chrome only**.

It has two parts, both in this download:

- **The tuner** — a small Windows program. Plex sees it as a TV tuner with one channel, "Tohyee TV". Keep its window open while you want the channel available.
- **The Chrome extension** — you click it on the tab you want to show (for example Sky Go) and choose **Broadcast this tab to Plex**.

Picture and sound are **only sent while someone is watching** the channel in Plex. When someone starts watching, the extension can **reload the tab** and press Play; about 5 seconds after the last person stops watching, it can **pause the video**. Both are tickboxes in the extension, on by default.

## What you need
- Windows, Chrome (version 116 or newer), and Plex Media Server on the same home network (or the same PC).
- **FFmpeg**, which converts the tab's video into TV format (step 1). It isn't included yet because its licence needs checking before we bundle it.
- Plex says **recording needs an active Plex Pass**. Plex's Live TV page doesn't say whether *watching* through a tuner also needs it, so check your account if setup is blocked.

## 1. Get FFmpeg (once)
Download `ffmpeg-release-essentials.zip` from https://www.gyan.dev/ffmpeg/builds/, open it, go into its `bin` folder, and copy **ffmpeg.exe** into this **Tohyee TV Tuner** folder (next to *Start Tohyee TV Tuner*).

Alternative: in Windows Terminal run `winget install --id Gyan.FFmpeg -e`. If the tuner then says FFmpeg can't be found, sign out of Windows and back in, or use the copy method.

## 2. Start the tuner
1. Keep this folder somewhere permanent (for example `Documents\Tohyee TV Tuner`).
2. Double-click **Start Tohyee TV Tuner**. A window shows the **Tuner address** and **XMLTV guide address**. Leave it open.
3. If Windows Defender Firewall asks about **Node.js**, tick **Private networks** and click **Allow** so Plex can reach it.

If you see several network addresses, use the one on the same network as Plex (usually starting 192.168.).

## 3. Add the Chrome extension (once)
1. In Chrome go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the **Chrome extension** folder inside this folder.
3. Click the puzzle-piece icon in Chrome's toolbar and **pin Tohyee TV** so you can see its badge.

Chrome may show a banner about developer-mode extensions; that's expected for test builds.

## 4. Broadcast a tab
1. Open the video you want (for example Sky Go) in a Chrome tab and start it playing.
2. Click the **Tohyee TV** icon and click **Broadcast this tab to Plex**.
3. With "Reload the tab…" or "Pause the video…" ticked, Chrome asks once whether Tohyee TV may **read and change data on that site**. Allowing it lets Tohyee TV press Play and Pause on the video. You can say no; it will still reload the tab, but you'll need to press Play yourself and it can't pause.
4. The badge shows **ON** (ready, waiting for Plex) and **LIVE** while someone is watching. Chrome also shows its own sharing indicator on the tab.

You can minimise Chrome or switch to another tab; capture keeps going. Closing the tab, or clicking **Stop broadcasting**, ends it.

## 5. Add the tuner to Plex (once)
**If Plex already has a DVR or tuner set up, stop and ask first.** Plex says using an XMLTV guide means deleting the existing DVR and creating a new one, which would affect its guide and recordings.

1. Open Plex Web, go to **Settings**, pick your server, then **Live TV & DVR**.
2. Click **DVR Setup**. If Tohyee TV isn't listed, use the link to enter the device's address manually and type the **Tuner address** without `http://` (for example `192.168.1.20:34500`).
3. Choose **Tohyee TV** and click **Setup Device**.
4. Pick **Cable**, any country, and continue. A scan isn't needed; there is one channel.
5. On the guide screen, click the link about having an **XMLTV** guide. Choose English, paste the **XMLTV guide address**, give it a name, and continue.
6. Check channel **1 · Tohyee TV** is ticked and mapped, then **Continue**.
7. Go to **Live TV** in Plex and play **Tohyee TV**.

Exact Plex labels can differ between versions. If a screen doesn't match, note what it says.

**Tip:** to check the Plex side on its own, close the tuner and double-click **Test Plex with test picture** instead. The channel then shows a colour test picture with a beep, without Chrome.

## What to check and report
- Does Plex find the tuner, and does the guide show "Live Desktop"?
- When you play the channel in Plex, does the extension badge change to **LIVE**, does the tab reload, and does the video start by itself?
- Do picture and sound play in Plex Web? On your TV's Plex app? Are they in sync?
- Does it keep playing for 30+ minutes? When you stop watching, does the badge go back to **ON** and the Sky Go video pause within about 10 seconds?
- How far back can you rewind in Plex while watching? (Plex can only rewind what it received since you started watching.)
- Plex Media Server version, where Plex runs, and any messages in the tuner window or extension popup.

## Settings
Saved in `%APPDATA%\Tohyee TV\tuner.json`, created on first start. You can change the port, channel name or number, or point `ffmpegPath` at a specific `ffmpeg.exe`; restart the tuner after editing. Keep `deviceId` the same — Plex recognises the tuner by it. If you change the port, also change it under **Advanced** in the extension popup.

## Limits of this test build
- One channel and one tab at a time.
- Tested automatically (including the real extension code feeding the real tuner, on Linux and a Windows build machine). **Not yet tested in real Chrome or with a real Plex server** — that's what this build is for.
- Some sites protect their video from capture, which shows as black. A reload may need you to sign in or press Play.
- When someone starts watching, Plex shows whatever the tab shows — including the page reloading.
- Nothing is sent while nobody is watching, so Plex can't rewind to before you started watching.
- The tuner can be reached by devices on your home network (that's how Plex connects). Only Chrome on this computer can send it video. Nothing is exposed to the internet or changes your router.
- No installer, tray icon or start-with-Windows option yet.
