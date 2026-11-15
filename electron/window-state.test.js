const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const ws = require('./window-state');

const screen = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 1920, height: 1080 };

test('sanitize rejects garbage and tiny sizes', () => {
  for (const bad of [null, 'x', {}, { width: 'a', height: 5 }, { width: 100, height: 100 }, { width: NaN, height: 500 }]) {
    assert.equal(ws.sanitize(bad), null);
  }
});

test('sanitize keeps valid state, drops half positions, coerces flags', () => {
  assert.deepEqual(ws.sanitize({ width: 900.4, height: 700, x: 10, y: -5, maximized: true }), {
    width: 900, height: 700, x: 10, y: -5, maximized: true, fullScreen: false,
  });
  assert.deepEqual(ws.sanitize({ width: 900, height: 700, x: 10 }), {
    width: 900, height: 700, maximized: false, fullScreen: false,
  });
  assert.equal(ws.sanitize({ width: 900, height: 700, maximized: 'yes' }).maximized, false);
});

test('fitToDisplays keeps a reachable position', () => {
  const s = { width: 800, height: 600, x: 2000, y: 100 };
  assert.deepEqual(ws.fitToDisplays(s, [screen, second]), s);
});

test('fitToDisplays drops the position when its display is gone', () => {
  const out = ws.fitToDisplays({ width: 800, height: 600, x: 2000, y: 100 }, [screen]);
  assert.equal(out.x, undefined);
  assert.equal(out.y, undefined);
  assert.equal(out.width, 800);
});

test('fitToDisplays nudges a partly off-screen window fully into view', () => {
  const out = ws.fitToDisplays({ width: 800, height: 600, x: 1900, y: -50 }, [screen]);
  assert.deepEqual([out.x, out.y], [1120, 0]);
});

test('fitToDisplays picks the display with most overlap and fits inside it', () => {
  const out = ws.fitToDisplays({ width: 800, height: 600, x: 1700, y: 100 }, [screen, second]);
  assert.deepEqual([out.x, out.y], [1920, 100]);
});

test('fitToDisplays shrinks to the display the window is on', () => {
  const small = { x: 1920, y: 0, width: 1000, height: 700 };
  const out = ws.fitToDisplays({ width: 1500, height: 900, x: 2000, y: 0 }, [screen, small]);
  assert.deepEqual([out.x, out.y, out.width, out.height], [1920, 0, 1000, 700]);
});

test('fitToDisplays accepts negative-origin displays', () => {
  const left = { x: -1280, y: 0, width: 1280, height: 1024 };
  const s = { width: 800, height: 600, x: -1000, y: 50 };
  assert.deepEqual(ws.fitToDisplays(s, [left, screen]), s);
});

test('load tolerates missing and corrupt files; save round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const file = path.join(dir, 'sub', 'state.json');
  assert.equal(ws.load(file), null);
  ws.save(file, { width: 900, height: 700, x: 1, y: 2, maximized: false, fullScreen: false });
  assert.equal(ws.load(file).width, 900);
  fs.writeFileSync(file, '{oops');
  assert.equal(ws.load(file), null);
});

function fakeWin({ maximized = false, fullScreen = false } = {}) {
  const win = new EventEmitter();
  Object.assign(win, {
    isDestroyed: () => false,
    isMaximized: () => maximized,
    isFullScreen: () => fullScreen,
    getNormalBounds: () => ({ x: 5, y: 6, width: 900, height: 700 }),
    getBounds: () => ({ x: 0, y: 25, width: 1920, height: 1055 }),
  });
  return win;
}

for (const [platform, maximized, fullScreen, expect] of [
  ['win32', true, true, { maximized: true, fullScreen: false }],
  ['linux', true, false, { maximized: true, fullScreen: false }],
]) {
  test(`track on ${platform} (max=${maximized}, fs=${fullScreen}) saves normal bounds on close`, () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 's.json');
    const win = fakeWin({ maximized, fullScreen });
    ws.track(win, file, platform);
    win.emit('close');
    assert.deepEqual(ws.load(file), { width: 900, height: 700, x: 5, y: 6, ...expect });
  });
}

test('track on darwin saves real bounds when tiled/zoomed (stale normal bounds ignored)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 's.json');
  const win = fakeWin({ maximized: true });
  ws.track(win, file, 'darwin');
  win.emit('close');
  assert.deepEqual(ws.load(file), { width: 1920, height: 1055, x: 0, y: 25, maximized: false, fullScreen: false });
});

test('track on darwin fullscreen keeps the last non-fullscreen bounds', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')), 's.json');
  const win = fakeWin();
  ws.track(win, file, 'darwin');
  win.isFullScreen = () => false;
  win.getBounds = () => ({ x: 10, y: 20, width: 1000, height: 700 });
  win.emit('move');
  win.isFullScreen = () => true;
  win.getBounds = () => ({ x: 0, y: 0, width: 3000, height: 2000 });
  win.emit('close');
  assert.deepEqual(ws.load(file), { width: 1000, height: 700, x: 10, y: 20, maximized: false, fullScreen: true });
});
