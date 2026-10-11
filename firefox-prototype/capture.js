import {CaptureSession} from './session.js';
import {CURRENT_VERSION, REPO} from './version.js';
import {checkForUpdate} from './updates.js';
import {isBlackFrame, BlackFrameMonitor} from './blackframe.js';
const el = id => document.getElementById(id);
const preview = el('preview');
const errors = {
  NotAllowedError: 'Sharing was cancelled or denied. Choose a source again when ready.',
  NotReadableError: 'Firefox could not read that source. Check whether it is still open and try again.',
  InvalidStateError: 'Return to this tab and click Start to open the sharing picker.',
  NotFoundError: 'No capture source is available.',
  AbortError: 'Capture could not start. Try selecting the source again.'
};
function describe(stream) {
  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  el('videoInfo').textContent = track ? `${settings.width ?? '?'} × ${settings.height ?? '?'} · ${settings.displaySurface ?? 'selected source'}` : 'Not capturing';
  const audio = stream?.getAudioTracks().filter(t => t.readyState === 'live') ?? [];
  el('audioInfo').textContent = !stream ? 'Not capturing' : audio.length ? 'Audio track available — verify by listening' : 'No audio returned by Firefox';
  el('listen').disabled = audio.length === 0;
}
const session = new CaptureSession(options => navigator.mediaDevices.getDisplayMedia(options), ({state, stream, error}) => {
  el('start').disabled = state === 'starting' || state === 'live';
  el('stop').disabled = state !== 'starting' && state !== 'live';
  el('audio').disabled = state === 'starting' || state === 'live';
  preview.muted = true;
  el('listen').textContent = 'Listen to captured audio';
  preview.srcObject = stream;
  describe(stream);
  el('status').classList.toggle('live', state === 'live');
  el('status').textContent = {idle:'Not capturing', starting:'Choosing source…', live:'LIVE · Local preview', error:'Capture unavailable'}[state];
  document.title = state === 'live' ? '● LIVE — Tohyee TV preview' : 'Tohyee TV · Capture check';
  el('message').textContent = {
    idle:'Capture is stopped. Nothing is being shared by this prototype.',
    starting:'Select a source in Firefox’s picker. Stop cancels this attempt even if the picker stays open.',
    live:'Local capture is active. Check the moving picture and audio status below.',
    error:errors[error?.name] ?? 'Capture failed. Check browser support and source availability, then try again.'
  }[state];
  watchForBlack(state === 'live' ? stream : null);
  if (stream) {
    const refresh = () => { if (session.stream === stream) describe(stream); };
    stream.getTracks().forEach(track => track.addEventListener('ended', refresh));
    preview.play().catch(() => {
      if (session.stream === stream) el('message').textContent = 'Capture started but preview playback failed. Stop and try again.';
    });
  }
});
el('start').addEventListener('click', () => session.start(el('audio').checked));
el('stop').addEventListener('click', () => session.stop());
el('listen').addEventListener('click', () => {
  preview.muted = !preview.muted;
  el('listen').textContent = preview.muted ? 'Listen to captured audio' : 'Mute preview audio';
});
window.addEventListener('pagehide', () => session.stop());
if (!navigator.mediaDevices?.getDisplayMedia) {
  el('start').disabled = true;
  el('message').textContent = 'Screen capture is unavailable in this context. Load this as a temporary Firefox extension using the README instructions.';
}

// --- Black picture detection ---------------------------------------------
// Samples a tiny copy of the preview once a second. This only labels what is
// on screen; it cannot tell the cause and does not alter capture protection.
const sampler = document.createElement('canvas');
sampler.width = 32; sampler.height = 18;
const sampleContext = sampler.getContext('2d', {willReadFrequently: true});
const monitor = new BlackFrameMonitor(4);
let blackTimer;
function showBlack(show) {
  const warning = el('blackWarning');
  warning.hidden = !show;
  warning.textContent = show
    ? 'The captured picture is completely black. Try these first: make sure the source window is not minimised, start the video playing, or reload the source page and choose it again. If it stays black, the website may be protecting its video from screen capture, which Tohyee TV cannot get around.'
    : '';
}
function watchForBlack(stream) {
  clearInterval(blackTimer);
  monitor.reset();
  showBlack(false);
  if (!stream) return;
  blackTimer = setInterval(() => {
    if (session.stream !== stream || preview.readyState < 2) return;
    try {
      sampleContext.drawImage(preview, 0, 0, sampler.width, sampler.height);
      const pixels = sampleContext.getImageData(0, 0, sampler.width, sampler.height).data;
      showBlack(monitor.add(isBlackFrame(pixels)));
    } catch {
      clearInterval(blackTimer); // Firefox refused to let us read the picture; skip detection.
    }
  }, 1000);
}

// --- Update check ---------------------------------------------------------
el('version').textContent = `v${CURRENT_VERSION}`;
const banner = el('update');
let checking = false;
async function runUpdateCheck(manual) {
  if (checking) return;
  checking = true;
  el('checkUpdates').disabled = true;
  if (manual) { banner.hidden = false; banner.className = 'update muted'; banner.textContent = 'Checking GitHub for updates…'; }
  const result = await checkForUpdate({current: CURRENT_VERSION, repo: REPO});
  checking = false;
  el('checkUpdates').disabled = false;
  banner.replaceChildren();
  if (result.status === 'update') {
    banner.className = 'update';
    const link = document.createElement('a');
    link.href = result.release.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open the release page to download it';
    banner.append(`A newer test build is available: ${result.release.name}. You have v${CURRENT_VERSION}. `, link,
      '. After downloading, remove this add-on in about:debugging and load the new manifest.json.');
    banner.hidden = false;
  } else if (manual) {
    banner.className = 'update muted';
    banner.textContent = result.status === 'current'
      ? `You have the newest test build (v${CURRENT_VERSION}).`
      : `Update check failed: ${result.message}`;
    banner.hidden = false;
  } else {
    banner.hidden = true; // Automatic check: stay quiet unless there is an update.
  }
}
el('checkUpdates').addEventListener('click', () => runUpdateCheck(true));
runUpdateCheck(false);
