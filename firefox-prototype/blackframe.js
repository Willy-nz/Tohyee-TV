// Detects a captured picture that is entirely (or almost entirely) black.
// This only labels what the user is seeing; it cannot tell *why* the picture
// is black and does not change or work around any capture protection.

// `pixels` is RGBA data (e.g. from canvas getImageData). A frame counts as
// black when no pixel is brighter than `threshold` (0–255).
export function isBlackFrame(pixels, threshold = 20) {
  if (!pixels || pixels.length < 4) return false;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > threshold || pixels[i + 1] > threshold || pixels[i + 2] > threshold) return false;
  }
  return true;
}

// Tracks consecutive black samples so a brief fade-to-black in a normal
// video doesn't trigger the warning.
export class BlackFrameMonitor {
  constructor(samplesNeeded = 4) {
    this.samplesNeeded = samplesNeeded;
    this.count = 0;
  }
  reset() { this.count = 0; }
  // Returns true while the picture has been black for long enough.
  add(black) {
    this.count = black ? this.count + 1 : 0;
    return this.count >= this.samplesNeeded;
  }
}
