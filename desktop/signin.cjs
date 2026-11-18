// Saved sign-ins, so the extension can sign a channel tab back in when a
// website (Sky Go) signs it out. The password is encrypted with Windows' own
// protection for this Windows account (Electron's safeStorage), and never goes
// back to the app's window: only the extension on this computer gets it, from
// the tuner's /signin address (see tuner/src/server.js).
const fs = require('node:fs');
const path = require('node:path');

// Websites the extension knows how to sign in to (see extension/signin.js).
const SITES = [{site: 'https://www.skygo.co.nz', name: 'Sky Go'}];

class SignInStore {
  constructor({file, safeStorage}) { this.file = file; this.safe = safeStorage; this.saved = {}; this.load(); }

  load() {
    try { this.saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) ?? {}; } catch { this.saved = {}; }
  }

  write() {
    fs.mkdirSync(path.dirname(this.file), {recursive: true});
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.saved, null, 2));
    fs.renameSync(temp, this.file);
  }

  save({site, email, password}) {
    if (!SITES.some(s => s.site === site)) throw new Error('Tohyee TV can only sign in to Sky Go for now.');
    email = String(email ?? '').trim();
    password = String(password ?? '');
    if (!email || email.length > 200) throw new Error('Enter the email you sign in with.');
    if (!password || password.length > 500) throw new Error('Enter the password.');
    if (!this.safe.isEncryptionAvailable()) throw new Error('Windows can’t encrypt the password on this computer, so it wasn’t saved.');
    this.saved[site] = {email, password: this.safe.encryptString(password).toString('base64'), savedAt: new Date().toISOString()};
    this.write();
  }

  remove(site) { delete this.saved[site]; this.write(); }

  // Email and password for the extension, or null.
  get(site) {
    const entry = this.saved[site];
    if (!entry) return null;
    return {email: entry.email, password: this.safe.decryptString(Buffer.from(entry.password, 'base64'))};
  }

  // What the app's window shows: never the password.
  list() {
    return SITES.map(({site, name}) => ({site, name, email: this.saved[site]?.email ?? '', savedAt: this.saved[site]?.savedAt ?? ''}));
  }
}

module.exports = {SignInStore, SITES};
