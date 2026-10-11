// Builds FFmpeg command lines and finds the FFmpeg program.
// Arguments are always passed as an array (never through a shell).

import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Output Plex can play as live TV: H.264 video + AAC audio in MPEG-TS,
// with a keyframe every 2 seconds so a new viewer gets a picture quickly.
export function outputArgs({fps = 30, videoBitrate = '4M'} = {}) {
  return [
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
    '-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', '8M',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-muxpreload', '0',
    'pipe:1'
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

// Chrome's tab capture arrives as WebM (VP8/VP9/H.264 video, Opus audio) on
// FFmpeg's standard input. Re-encode to a steady 30 fps (tab capture is
// variable-rate), cap at 1080p, and keep audio in step with the video.
export function chromeInputArgs({fps = 30, maxWidth = 1920, copyVideo = false} = {}) {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt', '-probesize', '2M', '-analyzeduration', '1500000',
    '-thread_queue_size', '1024', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?',
    ...(copyVideo ? [] : ['-vf', `fps=${fps},scale='trunc(min(${maxWidth},iw)/2)*2':-2,format=yuv420p`]),
    '-af', 'aresample=async=1000:first_pts=0',
    ...(copyVideo ? ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', 'pipe:1'] : outputArgs({fps, videoBitrate: '6M'}))
  ];
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
