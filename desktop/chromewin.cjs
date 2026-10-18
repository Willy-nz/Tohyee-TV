// Moves Tohyee TV's own Chrome window out of the way once its channels have
// started, and brings it back. Chrome's kiosk window ignores the extension's
// own minimise request, so this asks Windows directly (the same as pressing
// Win+Down on it), through PowerShell. Only windows of Chrome processes using
// Tohyee TV's profile folder are touched, never your usual Chrome.
//
// Windows may stop drawing a minimised window. Chrome normally keeps drawing a
// tab that's being captured, but in case it doesn't, StallWatch notices a
// channel that someone is watching but no picture is arriving for, so the
// window can be brought back (see main.cjs).
const {execFile} = require('node:child_process');

const SHOW = {hide: 6, show: 9}; // SW_MINIMIZE, SW_RESTORE

// PowerShell that minimises (hide) or restores (show) every visible Chrome
// window belonging to a chrome.exe started with --user-data-dir=<profile>.
// Prints one line of JSON: {count}.
function windowScript({profile, action}) {
  if (!(action in SHOW)) throw new Error('Unknown window action');
  const dir = String(profile ?? '');
  if (!dir || /[\r\n\0]/.test(dir)) throw new Error('Bad profile folder');
  const quoted = `'${dir.replace(/'/g, "''")}'`;
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TohyeeChromeWindow {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  public static int Apply(uint[] pids, int cmd) {
    int count = 0; // plain array search: Windows PowerShell 5.1 compiles with only the basic libraries
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(pids, pid) < 0 || !IsWindowVisible(h) || GetWindowTextLength(h) == 0) return true;
      var name = new StringBuilder(64); GetClassName(h, name, 64);
      if (name.ToString() != "Chrome_WidgetWin_1") return true;
      ShowWindow(h, cmd); if (cmd == 9) SetForegroundWindow(h); count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
'@
$tohyeeProfile = ${quoted}
$pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir=' + $tohyeeProfile) } | ForEach-Object { [uint32]$_.ProcessId })
$count = if ($pids.Count) { [TohyeeChromeWindow]::Apply([uint32[]]$pids, ${SHOW[action]}) } else { 0 }
'{"count":' + $count + '}'
`;
}

// Resolves to {count} (windows changed) or {error}.
function setChromeWindow(action, {profile, execFileFn = execFile, platform = process.platform} = {}) {
  if (platform !== 'win32') return Promise.resolve({error: 'Only on Windows'});
  let script;
  try { script = windowScript({profile, action}); } catch (error) { return Promise.resolve({error: error.message}); }
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFileFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {windowsHide: true, timeout: 60000}, (error, stdout) => {
      const line = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
      try { const parsed = JSON.parse(line); if (Number.isInteger(parsed?.count)) return resolve({count: parsed.count}); } catch { /* fall through */ }
      resolve({error: error?.killed ? 'Windows took too long to answer' : error?.code === 'ENOENT' ? 'PowerShell was not found' : 'No answer from Windows'});
    });
  });
}

// Notices a channel someone is watching that gets no picture from Chrome.
// Feed it the tuner's flow() every few seconds; it returns the channels that
// have had a viewer but received nothing new for `limitMs`.
class StallWatch {
  constructor({limitMs = 25000} = {}) { this.limitMs = limitMs; this.seen = new Map(); }
  check(flow, now = Date.now()) {
    const stalled = [], active = new Set();
    for (const {key, viewers, bytes} of flow ?? []) {
      if (!(viewers > 0)) continue;
      active.add(key);
      const last = this.seen.get(key);
      if (!last || last.bytes !== bytes) this.seen.set(key, {bytes, since: now});
      else if (now - last.since >= this.limitMs) stalled.push(key);
    }
    for (const key of [...this.seen.keys()]) if (!active.has(key)) this.seen.delete(key);
    return stalled;
  }
  reset() { this.seen.clear(); }
}

module.exports = {windowScript, setChromeWindow, StallWatch};
