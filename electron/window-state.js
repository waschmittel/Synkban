// Persist and restore the main window's geometry (ADR-0019). Pure helpers
// (`sanitize`, `fitToDisplays`) are separated from file I/O for unit tests.
const fs = require('fs');
const path = require('path');

const DEFAULT = { width: 1200, height: 800 };
const MIN = { width: 400, height: 300 };

const isInt = (n) => Number.isFinite(n);

// Validate parsed JSON; returns a clean state or null.
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { width, height, x, y } = raw;
  if (!isInt(width) || !isInt(height) || width < MIN.width || height < MIN.height) return null;
  const state = { width: Math.round(width), height: Math.round(height) };
  if (isInt(x) && isInt(y)) {
    state.x = Math.round(x);
    state.y = Math.round(y);
  }
  state.maximized = raw.maximized === true;
  state.fullScreen = raw.fullScreen === true;
  return state;
}

// `workAreas`: [{x,y,width,height}] of all displays. The window ends up fully
// inside one display: it is shrunk to fit that display and nudged back in. The
// display is the one it overlaps most; with no overlap (monitor unplugged) the
// position is dropped so the OS centres it, on the largest display's size.
function fitToDisplays(state, workAreas) {
  const out = { ...state };
  const overlap = (a) => {
    if (out.x === undefined) return 0;
    const w = Math.min(out.x + out.width, a.x + a.width) - Math.max(out.x, a.x);
    const h = Math.min(out.y + out.height, a.y + a.height) - Math.max(out.y, a.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const area = (a) => a.width * a.height;
  const best = workAreas.reduce((a, b) => (overlap(b) > overlap(a) ? b : a), workAreas[0]);
  const target =
    best && overlap(best) > 0
      ? best
      : workAreas.reduce((a, b) => (area(b) > area(a) ? b : a), workAreas[0]);
  if (!target) return out;
  out.width = Math.min(out.width, target.width);
  out.height = Math.min(out.height, target.height);
  if (out.x === undefined) return out;
  if (overlap(target) === 0) {
    delete out.x;
    delete out.y;
    return out;
  }
  out.x = Math.min(Math.max(out.x, target.x), target.x + target.width - out.width);
  out.y = Math.min(Math.max(out.y, target.y), target.y + target.height - out.height);
  return out;
}

function load(file) {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

function save(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    /* geometry is best effort */
  }
}

// Wire a BrowserWindow to `file`. Platform conventions:
// - Windows/Linux: restore the maximised state; fullscreen (F11) is transient
//   and not restored.
// - macOS: "zoom" is just a size, so only fullscreen is restored.
function track(win, file, platform = process.platform) {
  const isMac = platform === 'darwin';
  let timer = null;
  let lastBounds = null;
  // Windows/Linux: while maximised keep the last *normal* rect. macOS: a
  // window tiled by a window manager (Rectangle, …) counts as "zoomed", and
  // getNormalBounds() then returns a stale pre-zoom rect — use the real
  // bounds, except in fullscreen where they are the whole screen.
  const capture = () => {
    if (win.isDestroyed()) return;
    if (!isMac) lastBounds = win.getNormalBounds();
    else if (!win.isFullScreen()) lastBounds = win.getBounds();
  };
  const snapshot = () => {
    if (win.isDestroyed()) return;
    capture();
    const b = lastBounds ?? win.getBounds();
    save(file, { ...b, maximized: !isMac && win.isMaximized(), fullScreen: isMac && win.isFullScreen() });
  };
  const onChange = () => {
    capture();
    clearTimeout(timer);
    timer = setTimeout(snapshot, 500);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(ev, onChange);
  }
  win.on('close', () => {
    clearTimeout(timer);
    snapshot();
  });
}

module.exports = { DEFAULT, MIN, sanitize, fitToDisplays, load, save, track };
