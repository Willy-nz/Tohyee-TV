// Builds FFmpeg command lines and finds the FFmpeg program.
// Arguments are always passed as an array (never through a shell).

import {existsSync} from 'node:fs';
import {join} from 'node:path';

// Output Plex can play as live TV: H.264 video + AAC audio in MPEG-TS,
// with a keyframe every 2 seconds so a new viewer gets a picture quickly.
export function outputArgs({fps = 30, videoBitrate = '4M', tsOffset = 0} = {}) {
  return [
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
    '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
    '-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', '8M',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    ...tsOffsetArgs(tsOffset),
    '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', '-muxpreload', '0',
    'pipe:1'
  ];
}

// `tsOffset` (seconds) shifts output timestamps so a replacement encoder can
// continue an existing stream without its clock jumping backwards.
function tsOffsetArgs(tsOffset) {
  return tsOffset > 0 ? ['-output_ts_offset', tsOffset.toFixed(3)] : [];
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
// FFmpeg's standard input. Re-encode to a steady frame rate (tab capture is
// variable-rate), cap at 1080p, and keep audio in step with the video.
//
// Plex needs sound data from the very first seconds, or it gives up with
// "Could not tune channel" (its recorder can't read the sound's sample rate).
// Chrome sends none while a tab is silent or muted, or when it doesn't let
// sound start without a click. So Chrome's sound is always mixed with a steady
// silent track made here, paced in real time.
export function chromeInputArgs({fps = 30, maxWidth = 1920, copyVideo = false, tsOffset = 0, chromeAudio = true} = {}) {
  const sound = chromeAudio
    ? ['-filter_complex', '[0:a:0]aresample=48000:async=1000:first_pts=0,aformat=sample_rates=48000:channel_layouts=stereo[tab];[1:a][tab]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[sound]', '-map', '[sound]']
    : ['-map', '1:a'];
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt', '-probesize', '2M', '-analyzeduration', '1500000',
    '-thread_queue_size', '1024', '-i', 'pipe:0',
    '-re', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo,aformat=sample_fmts=s16',
    '-map', '0:v:0', ...sound,
    // The silent track never ends: stop when Chrome's picture does.
    '-shortest',
    ...(copyVideo ? [] : ['-vf', `fps=${fps},scale='trunc(min(${maxWidth},iw)/2)*2':-2,format=yuv420p`]),
    ...(copyVideo ? ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', ...tsOffsetArgs(tsOffset), '-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-muxdelay', '0', 'pipe:1'] : outputArgs({fps, videoBitrate: '6M', tsOffset}))
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
