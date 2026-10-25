Tohyee TV 0.8.1: sound in step on a server with no speakers.

On a server, the sound in Plex was about **2 seconds behind** the picture. The likely cause: Tohyee TV's sound passed through the computer's sound output (so you can hear the tab), and on a server with no working speakers, or with a switched-off HDMI monitor as the sound output, that output's timing can run late.

The sound sent to Plex is now mixed on its **own clock, with no sound device involved at all**. The tab's sound still plays on the computer's speakers as before, but only so you can hear it. It no longer affects the recording.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.8.1**), then click **Start channels now**.

---

Tohyee TV 0.8.0: a warning when the screen holds the picture back.

Tests on a real server found the reason for slightly uneven motion: with **no monitor plugged in**, Windows' stand-in screen only let Chrome draw about **32 frames a second**, while Sky sends 50. With a monitor set to **50 Hz**, the recording was a perfect, evenly spaced **50 frames a second**.

Tohyee TV now tells you when this is happening. A note appears at the top of the app when:
- the screen's refresh rate doesn't suit your channels (for Sky's 50 frames a second, the screen should be 50 Hz or 100 Hz), or
- while a channel is being watched, Chrome is capturing well below the channel's frame rate. It says how many frames a second it's really getting.

Click **Open display settings** to change the refresh rate. On a computer with no monitor, plug in an **HDMI dummy display plug** first (a small plug that pretends to be a monitor, about $15–25), then choose **1920×1080 at 50 Hz**. The screen's current size and refresh rate also show under **Settings → Screen size**.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.8.0**), then click **Start channels now**.

---

Tohyee TV 0.7.9: smoother picture, and the sound says English.

## Evenly spaced frames

A recording from a real server showed the picture had only about 32 frames a second, unevenly spaced, even though Sky sends 50. That's the slight judder you could see on sport. Chrome only captures a tab when it redraws it, and it redraws in step with the screen: 60 times a second on a computer with no monitor. Tohyee TV told Chrome "at most 50 a second", so Chrome skipped every other redraw. It now captures every redraw, so the frames are evenly spaced.

On a 60 Hz screen that's 60 frames a second (all of Sky's 50 plus a few repeats). For an exact match with Sky's 50, the computer needs a 50 Hz screen. On a computer with no monitor, a cheap HDMI dummy display plug lets you choose 50 Hz in Windows display settings. **Smoothness 25** now gives an even 30 on a 60 Hz screen.

## English sound

Plex showed the sound's language as "Unknown". It's now labelled English.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.7.9**), then click **Start channels now**.

---

Tohyee TV 0.7.8: hardware video encoding, full 50 fps.

Until now Chrome encoded each channel in software. That's heavy on the computer (around 65% CPU on a 4-core i3). It only makes the simple "Constrained Baseline" type of H.264, which Fire TV and some smart-TV Plex apps won't play as it is, so Plex converted it again. And it tops out at 30 frames a second.

The extension now asks Chrome to use the computer's **hardware video encoder** (on Intel computers, Quick Sync, the same thing Plex uses for "Transcode (hw)"). That gives the standard "High" type of H.264 at the full **50 frames a second**, with very little CPU. Plex apps should show **Direct Stream** instead of Transcode.

If Chrome can't use a hardware encoder on your computer, Tohyee TV automatically uses Chrome's own recorder, as before. To see which one is in use, look in **Help & diagnostics**: the line "Chrome is sending picture and sound" ends with "encoded by the computer's hardware video encoder" or "encoded by Chrome's recorder (…reason…)".

Keep **Settings → Video processing** on **Automatic**: the hardware encoder's picture goes straight through to Plex.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.7.8**), then click **Start channels now** (or arm your tabs again).

---

Tohyee TV 0.7.7: channels tune even when Chrome sends no sound.

0.7.6 didn't fix "Could not tune channel" on every computer. Plex's log showed the real cause: the sound track had no sound data at the start, because Chrome sent none (a muted video, or Chrome not letting sound start without a click). Plex can't start a channel without it. Tohyee TV now adds its own steady silent sound track to every channel and mixes Chrome's sound into it, so Plex always gets sound from the first second. Normal sound is unchanged and stays in step with the picture.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.7.7**), then arm your tab or click **Start channels now** again.

---

Tohyee TV 0.7.6: channels tune even when the video is muted.

On some computers Plex said **"Could not tune channel"** every time. Plex's own log showed why: the picture was fine (1920×1080 at 50 frames a second), but Chrome sent no sound at all, for example because the video started muted. Plex can't start a channel with an empty sound track. The extension now always sends Plex a proper sound track: the tab's sound mixed with silence, so there's sound from the very first second. If the video is muted you'll get a picture with no sound instead of an error. Click the speaker on the video to hear it.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.7.6**), then arm your tab or click **Start channels now** again.

---

Tohyee TV 0.7.5: the Chrome window gets out of your way.

## The full-screen Chrome window minimises itself

Once your channels have started, Tohyee TV now minimises its full-screen Chrome window, so you get your desktop back. Your channels keep broadcasting. If Windows ever pauses the picture while that window is minimised, Tohyee TV notices (someone is watching but no picture is arriving), brings the window back, and stops minimising it from then on. You can turn this off in **Settings → Start broadcasting by itself**. With it off, the Tohyee TV app comes in front of the Chrome window instead. There are also **Show Chrome window** and **Minimise Chrome window** buttons, and **Alt+Tab** always switches between them.

## Checking the extension is easier

**Set up Chrome window** now opens the extension's page at `chrome://extensions` straight away, showing its version and its reload arrow.

The app also warns you when Chrome is still running an older copy of the extension than the app. Chrome keeps the old copy until it's reloaded. Copies older than 0.7.2 send only 30 frames a second, which can make 50 fps channels look less smooth.

## The Windows start-up box stays ticked

On Windows the "Start Tohyee TV when I sign in to Windows" box un-ticked itself straight after you ticked it, so it looked as if it couldn't be clicked. Windows only reports the start-up entry as on when asked with the same settings it was saved with, and Tohyee TV wasn't asking that way. It does now.

After updating with **Update now**, click **Set up Chrome window**, click the reload arrow on the extension's page (it shows version **0.7.5**), then click **Start channels now**.

---

Tohyee TV 0.7.4: full 1080p on a computer with no monitor.

## Keep the screen at 1920×1080

Chrome can only draw a tab as big as the screen, and Plex gets what Chrome draws. A computer with no monitor plugged in, used through remote desktop, often drops to 1280×720, so Plex got a 720p picture stretched to fill the TV. Tick **Settings → Screen size → Keep this computer's screen at 1920×1080**. Tohyee TV sets the screen to 1920×1080 when it starts, after unlocking or waking, and whenever the screen size changes. It never lowers a bigger screen. If your remote-desktop app has a "resize to fit" option, turn it off.

## The Tohyee TV Chrome window fills the screen

When it starts your channels, Tohyee TV's own Chrome window now opens in kiosk mode: just the page, no tab strip or address bar. So each channel is exactly the screen's size, full 1080p on a 1920×1080 screen. (Plain full screen still left Chrome's bar showing and cut each tab to 1920×975.) Press Alt+F4 in it to close it. **Set up Chrome window** still opens a normal window.

## The size warning tells the truth

Chrome pads a small tab with black borders to make a 1920×1080 picture, so the extension used to think a small tab was full size. It now goes by the tab's real size, and tells you when Plex is getting less than full 1080p.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.7.4**).

---

Tohyee TV 0.7.3: channel logos in Plex.

Channels with a Sky programme guide match now show their logo in Plex. The logos come from the NZXMLTV Sky guide, which has one for every Sky channel. All 61 channels from **Add Sky Go channels** have a guide match.

To see them: make sure **Use NZXMLTV Sky listings** is ticked under Channels, then in Plex go to **Settings → Live TV & DVR** and refresh the guide. Plex can take a while to show new logos, and some Plex apps cache them.

---

Tohyee TV 0.7.2: smoother picture, matched to Sky, and much less processor use while nothing is being watched.

## Smoother picture: 50 frames a second

Sky Go sends Chrome full 1080p at 50 frames a second (measured on Sky Sport 1). Tohyee TV used to capture 30, which keeps 3 of every 5 frames unevenly and makes movement slightly jerky. It now captures all 50 by default. If your computer struggles, choose **25 frames a second** in the extension (**Smoothness**); that's every second frame, so movement stays even and Chrome does about half the work.

## Full 1080p from the Tohyee TV Chrome window

Tohyee TV captures the whole tab, and Chrome never enlarges a smaller one. When it starts your channels, Tohyee TV's own Chrome window now sizes itself so each tab is exactly 1920×1080. If the screen is too small for that, the starting page says so. When you broadcast a tab yourself, the extension now tells you if the tab is too small or the wrong shape for full 1080p.

The automatic start also no longer misses the starting page if Chrome opens it before the extension is ready.

## Less processor use while idle

The Tohyee TV standby page had a small pulsing dot. While a tab is being captured, Chrome redraws it, and copies it for the capture, every time anything on it moves, so each idle tab kept Chrome busy all the time. In testing, three idle reusable tabs used about a whole processor core with the dot and about 7% without it. The standby page is now completely still.

After updating with **Update now**, reload the extension at `chrome://extensions` (it shows version **0.7.2**) and click **Arm this tab for Plex** in each tab again, or use **Start channels now** if you use automatic start.

---

Tohyee TV 0.7.1: Sky Go's channels built in. Update from the app with **Update now**.

## New: Sky Go channels in one click

In **Channels**, click **Add Sky Go channels**. It fills in all 61 Sky Go live channels: Sky's channel numbers and names, each channel's Sky Go page address, and its programme guide match. Channels you already have are left alone. Remove any you don't want, click **Save channels**, and use **Reusable tabs** (the button selects it for you; click **Apply capture settings**). Turn on **Use NZXMLTV Sky listings** for the programme guide, then rescan channels and refresh the guide in Plex.

The list comes from Sky Go's TV guide in October 2026. Sky can change its addresses; you can edit any channel.

Also: with more than 8 channels, **Start broadcasting by itself** no longer opens one tab per channel. It asks you to choose Reusable tabs instead, because every open Sky Go player can use one of your streams.

---

Tohyee TV 0.7.0: start broadcasting by itself, reusable capture tabs, and real Sky NZ programme listings. FFmpeg and the runtime are included, so there's nothing else to install.

## Upgrading

- **From 0.6.1:** click **Update now** in the app. **From 0.6.0 or earlier:** quit the old app from its tray menu and run this installer.
- **Then re-add the Chrome extension.** It now has a fixed ID, so Chrome treats it as a new extension: at `chrome://extensions`, remove the old Tohyee TV extension, then **Load unpacked** again (the app's Connect to Plex page opens the folder). Set its options again and allow Play and Pause on your video site when asked. Check it shows version **0.7.0**.

## Start broadcasting by itself

Tohyee TV can now start your channels without a click, for example after the computer restarts. It opens its own Chrome window (a separate Chrome profile, with its own sign-ins), started with Chrome's setting that lets the Tohyee TV extension capture tabs without being clicked. The window opens each channel's saved page (or, with reusable tabs, the website's front page) and starts broadcasting. It does this when the app starts, and again after Windows is unlocked or wakes up, reusing the tabs it opened before.

Set up once, in **Settings → Start broadcasting by itself**:
1. Tick **When Tohyee TV starts, open its Chrome window and start broadcasting**, and **Start Tohyee TV when I sign in to Windows**.
2. Click **Set up Chrome window** and follow the page it opens: add the extension in that window (chrome://extensions → Developer mode → Load unpacked), sign in to your video website, and click **Arm this tab for Plex** once on that site so the extension may press Play and Pause.
3. Make sure every channel has its video page address (Channels).

Things to know:
- Windows has to sign in by itself after a restart, and broadcasting stops while Windows is locked (it starts again when unlocked).
- If the video website signs you out, sign in again in the Tohyee TV Chrome window.
- Tested in Chromium (the open-source version of Chrome): no-click start, both capture modes, and starting again after a stop. Not yet tested in Google Chrome on Windows, or with Sky Go.

## Set up reusable tabs

1. In **Channels**, choose **Reusable tabs**, leave the maximum at **3**, and apply. Existing installations keep dedicated mode until you switch. You can choose 1–8 tabs independently of the channel lineup (up to 200 channels).
2. Give each channel its actual HTTPS live-video page address. Open that channel in Sky Go and copy its page address. Use links that load the intended channel directly; a generic homepage or a replay link is not a live-channel selector.
3. Open three tabs on the same video website and sign in. In the extension on each tab, select a different reusable slot and click **Arm this tab for Plex**. Allow the website permission so the extension can press Play. Keep these tabs open; capture still requires your initial click.
4. Select a channel in Plex. An available tab switches to its saved page. Viewers of the same channel share a tab. A fourth different channel is refused while all three are watched. When a slot becomes idle, the player page is closed and the slot can be reused. A website may take time to release a session.

The reusable tabs are dedicated to Tohyee while armed. Do not browse manually in them while someone is watching. All saved channel links must be on the same HTTPS origin as the tab authorised for capture. Channel switching may take several seconds, and login/consent screens or sites without a direct channel link may need manual attention. No DRM or service-limit bypass is provided.

## Programme guide

Enable **Use NZXMLTV Sky listings** in Channels and refresh. The app uses https://nzxmltv.com/sky/guide-static.xml.gz, caches the last successful guide, and refreshes every six hours while enabled. XMLTV .xml/.gz file import is also available.

Choose a guide match for each channel, or use **Add channels from downloaded guide** to populate names and mappings. This does not discover video page links: paste those separately, remove unwanted channels, and save. Your own Plex channel numbers are preserved independently of the provider’s stable guide IDs.

Plex continues to use the app’s /guide.xml address. Rescan/map the changed channels and refresh the guide in Plex. Unmapped channels retain placeholder listings. Review the guide’s update status if listings are missing; failed downloads keep the previous cache. NZXMLTV is a third-party listing source, not a video source.

## Tested, and not yet tested

Unit tests cover leases, capacity, cancellation, guide mapping, gzip import and cache preservation. Real HTTP/WebSocket/FFmpeg smoke tests exercise three streams, shared viewers, refusing a fourth, and retuning a released slot. Browser capture and navigation are simulated in that test; actual Sky Go switching, protected-video capture and Plex playback still require manual Windows testing.

The live NZXMLTV feed was downloaded and parsed during development (98 channels, including ESPN and ESPN 2). The installer is unsigned and may trigger a Windows SmartScreen warning.
