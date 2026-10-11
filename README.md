# Tohyee-TV
Turns a **Chrome tab** (picture and sound) into a live TV channel in **Plex**, using FFmpeg and HDHomeRun-compatible tuner emulation. No physical TV tuner required. Chrome only.

- `tuner/` — the Windows program Plex sees as a network tuner (Node.js + FFmpeg). Setup and usage: [tuner/README.md](tuner/README.md).
- `extension/` — the Chrome extension that captures the chosen tab and sends it to the tuner while Plex is watching.
- `docs/DEVELOPMENT_PLAN.md` — product and development plan.

Run the tests with `npm test` (Node 20+). `scripts/e2e-chrome.mjs` runs the real extension code against a running tuner, with Chrome's recorder simulated by FFmpeg.
