# Tohyee TV — development plan

Status: proposed implementation plan, not implemented or Plex-certified.
Date: 11 October 2026.

## Update — 11 October 2026: Chrome only
Testing showed Firefox window capture gives no sound and stops when the source window is minimised or switched to another tab. Chrome tab capture (tested on Sky Go with a 30-second recording) kept picture and sound going while minimised. Decision: **Chrome only**.

Built so far (test build 0.3.0-alpha.1, not yet tested with real Plex or real Chrome):
- `tuner/`: Node.js tuner instead of the provisional C#/.NET choice, so it shares a language with the extension and is fully testable in CI. Provides `/discover.json`, `/lineup.json`, `/lineup_status.json`, `/lineup.post`, `/device.xml`, `/guide.xml` (rolling XMLTV) and `/stream/1` (H.264/AAC MPEG-TS from FFmpeg). One shared encoder; new viewers start at a keyframe; stops 5 s after the last viewer leaves. A test-picture mode proves the Plex path without Chrome.
- `extension/`: MV3 Chrome extension. The user clicks Broadcast on a tab (required by Chrome); an offscreen document holds the tab capture and a WebSocket to the tuner on 127.0.0.1. The tuner tells it when Plex starts and stops watching; media is only recorded and sent while someone is watching. Optional reload-on-watch reloads the tab when watching starts (tab capture survives navigation) and presses Play on the largest video if the user granted that site's permission.
- 0.4.0 — pass-through: Chrome's MediaRecorder already produces H.264 (asked for a keyframe every 2 s via `videoKeyFrameIntervalDuration`), so the tuner copies it into MPEG-TS and only converts Opus to AAC. Measured on a 1080p30 clip: 0.8 CPU-s per 30 s vs 30.4 for re-encoding, picture identical to Chrome's (re-encoding SSIM 0.971). Falls back to re-encoding if Chrome sends another codec or keyframes are >6 s apart (seamless swap with continued timestamps). `video` setting: auto/copy/encode.
- Not yet: installer/tray/startup, bundled FFmpeg (licence review), reconnect slate, long-session recovery beyond reload-on-watch.

## Product goal
A friendly Windows desktop app that broadcasts a selected screen, window or supported direct video stream as a live TV channel in Plex. One installer, clear controls, guided Plex setup and no separate OBS, MediaMTX or Threadfin installation.

## Experience and visual direction
- Plex-inspired charcoal backgrounds, warm amber actions, clean typography, left navigation and spacious cards; original Tohyee TV branding and assets.
- Small white Japanese Spitz face in the top-left corner and Windows notification-area (system tray) icon. Recognisable silhouette at 16–32 px, with original multi-resolution artwork. Mascot is a quiet identity element, not an interrupting assistant.
- Navigation: Broadcast, Connect to Plex, Settings, Help.
- Broadcast page: source preview, source name/type, audio meter, channel name, prominent Start/Stop control and readable status.
- Default simple quality presets; technical options tucked into Advanced.
- Keyboard access, screen-reader labels, DPI scaling, adequate contrast and reduced-motion support.

## Broadcasting must be obvious
App running does not mean broadcasting. Use explicit states:
| State | Meaning | Visible treatment |
| --- | --- | --- |
| Not broadcasting | No source is being distributed | Neutral badge and tray icon |
| Starting | Preparing source/encoder | Amber status text |
| Broadcasting | Live source is available to Plex | Red LIVE badge, source name, elapsed time and Stop |
| Reconnecting | Source interrupted; no new live frames | Amber warning with retry status |
| Error | Broadcast failed | Error text and actionable recovery |

- Persistent small desktop corner indicator while broadcasting, with LIVE, source name and Stop; draggable, not merely a temporary notification.
- Tray tooltip and menu repeat status; red-dot Spitz icon supplements text rather than replacing it.
- Toast at broadcast start/stop and automatic startup broadcast. Keep the indicator visible when the main window is minimised.
- Request capture exclusion for the indicator/preview where supported; verify on target capture backend.
- Closing the main window minimises to tray with a first-use explanation. Tray offers Open, Stop broadcasting and Exit. Exit stops capture and child processes.
- Stop immediately terminates delivery and clears app-controlled buffers. Explain that already buffered video in Plex may play briefly afterward.
- Show stream connections, if useful, as connections, not people/viewers; Plex may proxy multiple viewers.
- No remote tuning request may start a stopped desktop broadcast without the user's enabled auto-broadcast setting.

## Startup
- First-run choice: “Start Tohyee TV when I sign in to Windows”.
- Separate “Start broadcasting automatically” setting, off by default. Enabling it shows the selected source and explains the visible indicator.
- Default to launch minimised after setup, with tray presence and a startup notification.
- This is user-sign-in startup, not pre-login screen capture. Windows service session isolation makes a service unsuitable for capturing the interactive desktop.
- Revalidate saved display/window identity; never silently substitute a different display.
- For capture sources, stop on workstation lock, source closure or lost capture permission; require manual resume by default. Do not broadcast the lock screen.
- Define and test sleep/resume, RDP disconnect, monitor removal and Windows shutdown. Direct-stream sources may continue on lock if explicitly configured, with status restored on unlock.

## First-run wizard and Plex walkthrough
1. Welcome: describe what will be broadcast and show requirements.
2. Pick Screen, Window or Direct stream URL. Show preview, audio selection and a test. System audio means all sounds on the chosen output device; microphone off by default.
3. Name the channel; default “Tohyee TV”, with stable internal channel ID.
4. Choose quality: start with 1080p/30 SDR and a lower-load 720p preset; adjust to source capability.
5. Choose Plex location: same computer or another device on the home network. Select the correct LAN interface and check port conflicts.
6. Explain/apply a narrowly scoped Windows firewall rule when needed; no router port forwarding.
7. “Open Plex” opens Plex Web. An adjacent in-app walkthrough explains server Settings → Live TV & DVR → add/setup tuner. Provide copy buttons for tuner address and XMLTV guide URL, plus manual-address fallback if discovery fails.
8. Walk through selecting the Tohyee channel, guide mapping and playing it in Plex. Exact UI labels are version-sensitive and must be validated during implementation.
9. Show individual checks: local stream works; tuner endpoint reachable locally; Plex requested tuner/guide; Plex requested stream. None alone proves playback. Ask user to confirm visible video and audible sound in Plex.
10. Offer startup options and finish on the Broadcast page.

Existing DVR users need a separate branch in the wizard. Plex documents that moving to XMLTV may require recreating DVR setup. Do not automatically delete or reconfigure an existing DVR; explain potential guide/recording impact and provide a deliberate migration path after compatibility testing.

Plex account/subscription prerequisites must be verified against the tested server version. Third-party tuner documentation lists Plex Pass; do not promise universal free support. The wizard should explain any prerequisites before lengthy setup. No Plex password collection or brittle automatic clicking through Plex in v1.

## Source modes and browser forwarding
| Mode | Behaviour | Scope |
| --- | --- | --- |
| Screen/window | Continuous Windows capture, encoded as video with selected audio | First release |
| Direct stream URL | Fetch supported unprotected HLS/HTTP media, remux/copy compatible codecs or transcode when necessary | First release after tuner proof |
| Browser helper | Optional extension to send an explicitly selected supported stream, or capture a selected tab | Later prototype |

Direct forwarding is possible when there is an accessible media URL and compatible media. It can avoid video decoding/re-encoding, lowering CPU use and preserving quality. A webpage URL is not necessarily a media URL. Browser blob URLs, Media Source Extensions, expiring signed links, cookies, separate audio/video tracks and DRM complicate or prevent forwarding.

“Capture a browser tab” and HTML media-element capture are rendered-media capture, not guaranteed compressed packet forwarding. Tab capture can avoid showing the rest of the desktop but generally still needs encoding for Plex. Do not describe captureStream() as universal zero-copy passthrough.

- Probe the source before starting; show “Direct forwarding” or “Encoding for compatibility”, with a plain-language reason.
- Initially support explicit unprotected HLS/HTTP media URLs; reject unsupported schemes and give useful errors.
- Do not automatically scrape arbitrary browser sessions or export cookies. Add authenticated sources only through deliberate, narrowly scoped future support; redact URL tokens from logs.
- DRM-protected media is unsupported for direct forwarding; screen/tab capture may also be blocked or black. No promise that all browser video works.
- Optional Chromium extension later: explicit user action, least-privilege access, authenticated pairing to the desktop app and permission to access only the selected source. Firefox support is a separate compatibility task.
- Never silently change from direct stream to full-screen capture. Offer fallback and let the user select the capture source.

## Proposed architecture
Provisional Windows-first choice: C#/.NET with WPF UI, an in-process ASP.NET Core endpoint host, Windows capture/audio APIs and FFmpeg. Validate the capture-to-encoder integration in a spike before locking the design. Choose a supported .NET release at implementation time.

Components:
- Desktop UI and tray lifecycle.
- Broadcast coordinator: authoritative state machine, source validation, cancellation and recovery.
- Capture adapter: Windows.Graphics.Capture for display/window video; WASAPI loopback for audio. FFmpeg alone is not assumed to provide turnkey Windows audio capture.
- Encoder/relay adapter: FFmpeg for codec probing, encoding, remuxing and stream output; hardware encoding when available with tested software fallback.
- Tuner adapter: minimum HDHomeRun-compatible HTTP/discovery surface that Plex actually uses, verified against real Plex.
- Guide generator: local rolling XMLTV schedule with one channel and “Live Desktop” or a chosen source label; valid timestamps/timezone offsets and stable IDs.
- Settings and diagnostics: per-user configuration, bounded logs, redaction and export.

Suggested solution folders: src/TohyeeTV.App, src/TohyeeTV.Core, src/TohyeeTV.Media, src/TohyeeTV.Tuner, tests, docs.

Candidate tuner endpoints: /discover.json, /lineup.json, /lineup_status.json, any required scan/device metadata endpoints, /stream/1.ts and /guide.xml. These are an implementation checklist, not a complete protocol specification. Determine required discovery behaviour from primary protocol references and compatibility tests. Keep stable device identity across restarts. Manual IP/port setup is the first fallback, automatic discovery follows.

Initial output target: H.264 video and AAC audio in HTTP MPEG-TS, subject to real Plex/client testing. One channel/source at a time. Share one encoder across allowed connections; bound buffers and disconnect slow clients without freezing others. Advertise only tuner capacity actually supported. Stopped broadcast must not expose old frames or silently resume.

## Networking, packaging and reliability
- Listen only on the intended interface. Same-machine mode may use loopback; remote Plex mode must advertise a reachable LAN address, not localhost.
- Limit network/firewall access to the configured Plex host where practical; keep control APIs local and authenticated. LAN stream/tuner endpoints are not inherently private.
- No public listener, UPnP router mapping or independent internet exposure. Remote playback, if configured, remains Plex's responsibility.
- Supervise FFmpeg, avoid shell-built command strings, bound retries and memory, cleanly dispose capture/audio resources, and redact secrets.
- Distribute required components through a single installer with checksummed dependencies. Review the actual FFmpeg build's licence obligations before bundling; do not assume all builds have the same licence.
- Build/test on Windows CI. Code signing is a release requirement to plan for, not something already available.
- Uninstall removes startup entries and app-created firewall rules. Updates preserve settings and do not unexpectedly resume broadcasting.

## Delivery sequence and acceptance gates
### 1. Prove the Plex path
Generate a test picture and tone; expose a single virtual tuner/channel and XMLTV; manually add to Plex, then test discovery. Test an isolated DVR setup before changing any existing DVR.
Done when Plex Web and at least one target TV client play audio/video for 30 minutes, stop/re-tune works, and versions/settings/results are documented. Do not spend time polishing UI before this passes.

### 2. Screen/window and audio
Implement source picker, live preview, audio meter, encode pipeline and broadcast state. Test multiple monitors, DPI, source closure, lock/unlock, silence and audio-device changes.
Done when a 60-minute screen broadcast has no accumulating A/V drift, stop prevents further source delivery, and a missing source never switches to another display.

### 3. Desktop experience and startup
Build Plex-inspired UI, original Spitz assets, tray, persistent LIVE indicator, startup settings and clean exit.
Done when a nontechnical user can see whether broadcasting is active while minimised; sign-in launch works; auto-broadcast remains separately controlled; Exit leaves no encoder running.

### 4. Guided Plex setup
Build wizard, copyable addresses, staged diagnostics, same-machine/LAN modes and existing-DVR guidance.
Done when a fresh user can complete installation and tune the channel using the walkthrough, without command-line tools. Verify both local and separate-machine Plex configurations and an existing-DVR scenario.

### 5. Direct stream input
Probe supported URLs, copy compatible streams, transcode only as required and explain unsupported/expired inputs.
Done when test HLS sources work through Plex, passthrough is demonstrably used for compatible codecs, failure messages are actionable, and no capture fallback happens without source selection.

### 6. Release hardening
Installer, licences, Windows CI, performance checks, update/uninstall and recovery tests.
Done when a clean supported Windows machine installs successfully, a two-hour stream remains stable with bounded resource use, and reboot/resume/firewall failure paths behave as documented.

### 7. Optional browser helper
Prototype explicit “Send to Tohyee TV” for supported sources and selected-tab capture. Publish a tested browser/source support matrix before promising compatibility. This must not block the first usable desktop release.

## Test strategy and open decisions
Automated tests: broadcast state transitions, guide timestamps/escaping, stable tuner identity, source validation, secrets redaction, stop/cancellation and bounded connection handling.
Integration tests: FFmpeg failure/restart, slow client, source expiry and tuner HTTP contracts.
Real Windows/Plex tests are mandatory; Linux CI or HTTP mocks cannot prove capture, system audio or Plex playback.
Record CPU/GPU, memory, latency and audio sync on actual hardware rather than promising latency figures.

Resolve in stage 1: user's target Plex TV client/server version and subscription; existing HDHomeRun/DVR setup; supported Windows baseline; capture/FFmpeg frame transport; installer and signing approach. Browser/service-specific compatibility remains source-dependent.

## References
- Plex setup: https://support.plex.tv/articles/225877347-live-tv-dvr/
- Plex XMLTV: https://support.plex.tv/articles/using-an-xmltv-guide/
- Threadfin reference implementation: https://github.com/Threadfin/Threadfin
- FFmpeg streamcopy: https://ffmpeg.org/ffmpeg.html#Streamcopy
- Windows capture: https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture
- Chromium tab capture: https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- Media-element capture: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream
- W3C media capture draft (not a final standard): https://www.w3.org/TR/mediacapture-fromelement/

## Browser-source feasibility and long-session recovery
Before promising support for a particular streaming service, test ordinary capture compatibility on the target browser. DRM-protected streams are not supported by direct passthrough; protected capture can also be blocked. Generic desktop streaming success does not establish service compatibility.

- Confirm intended Plex accounts have Plex Home Live TV access; ordinary library sharing does not grant the same access.
- Diagnose long-session failures before choosing a refresh interval: record elapsed time, player errors and whether a manual reload and Play recover.
- Prioritise an explicitly enabled browser helper if recovery is required. A desktop capture process alone cannot reliably inspect or restart browser playback.
- Prefer confirmed stall/error recovery over scheduled interruption. Use playback progress and player events where available; silence or static pixels alone are insufficient.
- Offer optional “Refresh selected tab every …”, off by default, with a configurable interval, countdown, Skip and Refresh now. Do not claim an untested interval fixes a service.
- Target only the user-selected tab through an authorised helper; never send global refresh keys to the active window.
- Reload, wait for readiness, attempt normal playback where allowed and verify progress. Login, CAPTCHA, playback/device limits and protection errors require user action. Browser autoplay may prevent automatic resume.
- Use bounded retries/backoff and cancel all recovery on Stop.
- Investigate a continuous encoded “Reconnecting…” card with silent audio to preserve the Plex session during recovery. Verify client tolerance and timestamps. Never relay login screens during recovery.
- Refresh interrupts the live source and can lose footage; buffering cannot reconstruct missing content.
- Test beyond observed failure duration, plus network loss, expired login and static scenes. Log outcomes with secrets redacted.
- Verify source capture and access before extensive UI work. Unsupported sources must be labelled honestly.

Reference: https://support.plex.tv/articles/204232573-restricting-the-shares/
