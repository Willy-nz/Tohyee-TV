// Keeps the computer's screen at 1920×1080 when asked to. A computer with no
// monitor attached (used over remote desktop) often falls back to 1280×720 or
// smaller, and Chrome can only draw — and Tohyee TV only capture — a tab as big
// as the screen. This uses Windows' own display functions (the same thing
// Settings → Display does), run through PowerShell. It only ever raises a
// smaller screen to the target, never lowers a bigger one, and does nothing if
// the graphics driver doesn't offer that size.
const {execFile} = require('node:child_process');

const TARGET = {width: 1920, height: 1080};

// Whether a screen of this many real pixels is too small for full 1080p.
function needsFix({width, height}, target = TARGET) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && (width < target.width || height < target.height);
}

// Real pixels of an Electron display (its size is in scaled units).
function physicalSize(display) {
  const f = display?.scaleFactor || 1;
  return {width: Math.round((display?.size?.width ?? 0) * f), height: Math.round((display?.size?.height ?? 0) * f)};
}

// PowerShell that sets the primary screen to width×height if the driver offers
// it, and prints one line of JSON: {before, after, result}.
function powershellScript({width, height}) {
  const w = Math.trunc(width), h = Math.trunc(height);
  if (!(w >= 640 && w <= 7680 && h >= 480 && h <= 4320)) throw new Error('Unsupported screen size');
  return `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TohyeeDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields;
    public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent;
    public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2;
    public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);
  public static DEVMODE Current() { var d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); EnumDisplaySettings(null, -1, ref d); return d; }
  public static bool Offered(int w, int h) {
    var d = new DEVMODE(); d.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    for (int i = 0; EnumDisplaySettings(null, i, ref d); i++) if (d.dmPelsWidth == w && d.dmPelsHeight == h) return true;
    return false;
  }
  public static string Set(int w, int h) {
    var d = Current(); string before = d.dmPelsWidth + "x" + d.dmPelsHeight;
    if (d.dmPelsWidth >= w && d.dmPelsHeight >= h) return "{\\"before\\":\\"" + before + "\\",\\"after\\":\\"" + before + "\\",\\"result\\":\\"already\\"}";
    if (!Offered(w, h)) return "{\\"before\\":\\"" + before + "\\",\\"after\\":\\"" + before + "\\",\\"result\\":\\"unsupported\\"}";
    d.dmPelsWidth = w; d.dmPelsHeight = h; d.dmFields = 0x80000 | 0x100000; // DM_PELSWIDTH | DM_PELSHEIGHT
    int test = ChangeDisplaySettings(ref d, 2); // CDS_TEST
    int code = test == 0 ? ChangeDisplaySettings(ref d, 1) : test; // CDS_UPDATEREGISTRY: keep it after a restart
    var now = Current(); string after = now.dmPelsWidth + "x" + now.dmPelsHeight;
    return "{\\"before\\":\\"" + before + "\\",\\"after\\":\\"" + after + "\\",\\"result\\":\\"" + (code == 0 ? "changed" : "failed:" + code) + "\\"}";
  }
}
'@
[TohyeeDisplay]::Set(${w}, ${h})
`;
}

// Runs the script; resolves to {before, after, result} or {result: 'error', message}.
function setResolution(target = TARGET, {execFileFn = execFile, platform = process.platform} = {}) {
  if (platform !== 'win32') return Promise.resolve({result: 'unsupported', message: 'Only on Windows'});
  const encoded = Buffer.from(powershellScript(target), 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFileFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {windowsHide: true, timeout: 60000}, (error, stdout, stderr) => {
      const line = String(stdout ?? '').trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
      try { const parsed = JSON.parse(line); if (parsed?.result) return resolve(parsed); } catch { /* fall through */ }
      resolve({result: 'error', message: shortReason(stderr, error)});
    });
  });
}

// One short, readable reason from PowerShell's error output.
function shortReason(stderr, error) {
  const text = String(stderr ?? '').replace(/_x001B_\[[0-9;]*m|\x1b\[[0-9;]*m|_x000A_/g, ' ').replace(/<[^>]+>/g, ' ');
  const found = text.match(/argument\(s\):\s*"([^"]{3,160})/) || text.match(/(?:Exception|Error):\s*([^|<]{3,160})/);
  if (found) return found[1].trim().slice(0, 160);
  if (error?.killed) return 'Windows took too long to answer';
  return error?.code === 'ENOENT' ? 'PowerShell was not found' : 'No answer from Windows';
}

function describe(outcome, target = TARGET) {
  const size = `${target.width}×${target.height}`;
  switch (String(outcome?.result).split(':')[0]) {
    case 'changed': return `Screen set to ${size} (was ${String(outcome.before).replace('x', '×')}).`;
    case 'already': return `Screen is already ${String(outcome.before).replace('x', '×')}.`;
    case 'unsupported': return `This computer’s graphics don’t offer ${size} right now. A dummy display plug (a small plug that pretends to be a 1080p monitor) fixes that.`;
    case 'failed': return `Windows didn’t accept ${size} (code ${String(outcome.result).split(':')[1]}).`;
    default: return `Couldn’t change the screen size: ${outcome?.message ?? 'unknown problem'}.`;
  }
}

module.exports = {TARGET, needsFix, physicalSize, powershellScript, setResolution, describe};
