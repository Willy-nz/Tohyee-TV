import {CaptureSession} from './session.js';
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
