// The release tag this build was published as (without the leading "v").
// The release workflow reads this value to name the GitHub release, so
// bump it here when making a new test build.
export const CURRENT_VERSION = '0.1.0-alpha.2';
export const REPO = 'Willy-nz/tohyee-tv';
// Only releases with a download whose name starts with this count as updates,
// so other builds published to the same repository (e.g. Chrome) are ignored.
export const ASSET_PREFIX = 'Tohyee-TV-Firefox-Capture-';
