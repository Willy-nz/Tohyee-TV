// Builds FFmpeg command lines and finds the FFmpeg program.
// Arguments are always passed as an array (never through a shell).

import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Output Plex can play as live TV: H.264 video + AAC audio in MPEG-TS.
const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];

// `tsOffset` (seconds) shifts the output timestamps, so a replacement encoder
// can continue an existing stream without its clock jumping backwards.
function muxArgs(tsOffset = 0) {
  return [
    ...(tsOffset > 0 ? ['-output_ts_offset', tsOffset.toFixed(3)] : []),
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-muxpreload', '0',
    'pipe:1'
  ];
}

// Re-encode with a keyframe every 2 seconds so a new viewer gets a picture quickly.
export function outputArgs({fps = 30, videoBitrate = '4M', tsOffset = 0} = {}) {
  return [
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
    '-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', '8M',
    ...AUDIO_ARGS,
    ...muxArgs(tsOffset)
  ];
}

// Stage 1 source: a moving test picture with a frame counter and a 440 Hz
// tone, generated in real time. Proves the Plex path without any capture.
export function testPatternArgs({width = 1280, height = 720, fps = 30} = {}) {
  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-re', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=${fps}`,
    '-re', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-map', '0:v', '-map', '1:a',
    ...outputArgs({fps})
  ];
}

const CHROME_INPUT = [
  '-hide_banner', '-loglevel', 'warning',
  '-fflags', '+genpts+discardcorrupt', '-probesize', '2M', '-analyzeduration', '1500000',
  '-thread_queue_size', '1024', '-i', 'pipe:0',
  '-map', '0:v:0', '-map', '0:a:0?',
  '-af', 'aresample=async=1000:first_pts=0'
];

// Chrome's tab capture arrives as WebM (VP8/VP9/H.264 video, Opus audio) on
// FFmpeg's standard input. Re-encode to a steady 30 fps (tab capture is
// variable-rate), cap at 1080p, and keep audio in step with the video.
// Used when Chrome's video can't be passed through as it is.
export function chromeInputArgs({fps = 30, maxWidth = 1920, tsOffset = 0} = {}) {
  return [
    ...CHROME_INPUT,
    '-vf', `fps=${fps},scale='min(${maxWidth},iw)':-2,format=yuv420p`,
    ...outputArgs({fps, videoBitrate: '6M', tsOffset})
  ];
}

// When Chrome already sends H.264, pass the picture through untouched and
// only convert the sound (Opus -> AAC). Measured on a 1080p30 test clip, this
// used about 3% of the CPU of re-encoding, with a picture identical to what
// Chrome produced (re-encoding scored SSIM 0.971).
export function chromeCopyArgs({tsOffset = 0} = {}) {
  return [...CHROME_INPUT, '-c:v', 'copy', ...AUDIO_ARGS, ...muxArgs(tsOffset)];
}

// Which video codec a MediaRecorder type string means ('h264', 'vp8', 'vp9', or '').
export function recorderCodec(mimeType) {
  const t = String(mimeType ?? '').toLowerCase();
  if (/h264|avc1/.test(t)) return 'h264';
  if (/vp9|vp09/.test(t)) return 'vp9';
  if (/vp8/.test(t)) return 'vp8';
  return '';
}

// Order: the path in settings, ffmpeg.exe in one of the app folders (e.g. next
// to "Start Tohyee TV Tuner"), then whatever is on the PATH.
export function findFfmpeg(config, appDirs, exists = existsSync, platform = process.platform) {
  if (config.ffmpegPath) return config.ffmpegPath;
  const name = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of [appDirs].flat()) {
    const local = join(dir, name);
    if (exists(local)) return local;
  }
  return 'ffmpeg';
}
