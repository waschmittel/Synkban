const { app, BrowserWindow, shell, dialog, ipcMain, screen } = process.versions.electron
  ? require('electron')
  : {};
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const windowState = require('./window-state');

let mainWindow = null;
let backendProcess = null;

// Height of the app's own header (.app-header in frontend/src/styles/app.css).
// The window-controls overlay is sized to match so the native controls sit in
// the same band as the header content — keep the two in sync.
const HEADER_HEIGHT = 52;

// Diameter of the macOS traffic lights, measured off a screenshot of the real
// window (14px — not the 12px the buttons are often quoted as). Used to centre
// them vertically in the header; `trafficLightPosition` takes a top offset, so
// the centre has to be worked out here.
const TRAFFIC_LIGHT_HEIGHT = 14;
const TRAFFIC_LIGHT_INSET = {
  x: 14,
  y: Math.round((HEADER_HEIGHT - TRAFFIC_LIGHT_HEIGHT) / 2),
};

// Settings (data dir, startup view) are owned by the Rust backend, persisted
// in ~/.config/synkban/synkban.toml. The shell only contributes what the web
// UI can't do itself: the native directory picker and a full relaunch (the
// backend reads its data dir once at spawn, so a change needs a restart).
function registerSettingsIpc() {
  ipcMain.handle('synkban:pick-data-dir', async (_event, currentDir) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose data folder',
      defaultPath: typeof currentDir === 'string' && currentDir ? currentDir : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('synkban:pick-mirror-dir', async (_event, currentDir) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose readable mirror folder',
      defaultPath: typeof currentDir === 'string' && currentDir ? currentDir : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('synkban:relaunch', () => {
    app.relaunch();
    app.quit();
  });
}

// Build version written by build.sh (release tag or dated snapshot).
// Falls back to the package.json version for unstamped dev runs.
let appVersion, buildStamp;
try {
  const v = require('./app-version.json');
  appVersion = v.version;
  buildStamp = [v.build, v.commit].filter(Boolean).join(' · ');
} catch {
  appVersion = app?.getVersion?.() ?? '';
  buildStamp = '';
}

// On Linux the icon is a property of the window, and an AppImage that hasn't
// been desktop-integrated has no installed .desktop entry to fall back on — so
// without this the window shows Electron's default icon in the dock/alt-tab.
// macOS takes it from the .app bundle, and a packaged Windows build takes it
// from the multi-size .ico electron-builder writes into the exe (better than
// the single downscale below), so both opt out.
function getWindowIconPath() {
  if (process.platform === 'darwin') return undefined;
  if (process.platform === 'win32' && app.isPackaged) return undefined;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'backend', 'icons', 'png', '512x512.png');
}

function getBackendPath() {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.resourcesPath, `synkban${ext}`);
  }
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(__dirname, '..', 'backend', 'target', 'release', `synkban${ext}`);
}

const MAX_STARTUP_STDERR = 4096;

function startBackend(token, command = getBackendPath(), args = []) {
  return new Promise((resolve, reject) => {
    // No DATA_DIR: the binary resolves its data dir from synkban.toml (or an
    // inherited DATA_DIR/--data-dir override in dev).
    const env = { ...process.env, DESKTOP_TOKEN: token };
    const proc = spawn(command, args, { env });
    backendProcess = proc;

    let settled = false;
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      if (settled) return;
      stdout += data.toString();
      if (stdout.length > 65536) stdout = stdout.slice(-8192);
      const match = stdout.match(/DESKTOP_PORT=(\d+)\r?\n/);
      if (match) {
        settled = true;
        stdout = '';
        stderr = '';
        resolve(parseInt(match[1], 10));
      }
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(data);
      if (!settled && stderr.length < MAX_STARTUP_STDERR) {
        stderr += data.toString().slice(0, MAX_STARTUP_STDERR - stderr.length);
      }
    });

    proc.on('error', (err) => {
      if (backendProcess === proc) backendProcess = null;
      if (settled) return;
      settled = true;
      stdout = '';
      stderr = '';
      reject(err);
    });

    proc.on('exit', () => {
      if (backendProcess === proc) backendProcess = null;
    });

    proc.on('close', (code, signal) => {
      if (backendProcess === proc) backendProcess = null;
      if (settled) return;
      settled = true;
      const detail = stderr.trim();
      stdout = '';
      stderr = '';
      const reason = code !== null ? `code ${code}` : `signal ${signal}`;
      const message = detail
        ? `Backend exited with ${reason}:\n${detail}`
        : `Backend exited with ${reason}`;
      reject(new Error(message));
    });
  });
}

async function createWindow() {
  const token = crypto.randomUUID().replace(/-/g, '');
  const port = await startBackend(token);

  const isMac = process.platform === 'darwin';
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const saved = windowState.load(stateFile);
  const bounds = windowState.fitToDisplays(
    saved ?? windowState.DEFAULT,
    screen.getAllDisplays().map((d) => d.workArea),
  );
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: windowState.MIN.width,
    minHeight: windowState.MIN.height,
    title: 'Synkban',
    // Seamless titlebar: the window is frameless and the app's own .app-header
    // extends to the top edge, with the OS window controls drawn over it
    // (macOS traffic lights on the left, Windows caption buttons on the right,
    // Linux wherever the desktop environment puts them).
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    icon: getWindowIconPath(),
    // titleBarOverlay is enabled on every platform: besides painting the
    // controls (the colours apply on Windows/Linux only), it publishes the
    // env(titlebar-area-*) CSS variables that app.css uses to keep the header
    // clear of them. Without it macOS exposes no geometry and the stylesheet
    // would be back to guessing a fixed inset. `height` matches .app-header so
    // the controls sit in the same band as the header content.
    titleBarOverlay: isMac
      ? { height: HEADER_HEIGHT }
      : { color: '#00000000', symbolColor: '#ffffff', height: HEADER_HEIGHT },
    trafficLightPosition: isMac ? TRAFFIC_LIGHT_INSET : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (saved?.maximized) mainWindow.maximize();
  if (saved?.fullScreen) mainWindow.setFullScreen(true);
  windowState.track(mainWindow, stateFile);

  const appOrigin = `http://127.0.0.1:${port}`;

  // Links in card descriptions open via window.open(_blank). Hand external
  // http/https/mailto URLs to the OS default browser instead of spawning a
  // child BrowserWindow; deny everything else.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
    }
  });

  // The page vetoes unloading while the Notes pane has unsaved edits
  // (beforeunload, ADR-0022). Electron would silently keep the window open, so ask.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Leave and discard them?',
    });
    if (choice === 0) event.preventDefault();
  });

  mainWindow.loadURL(`${appOrigin}/?token=${token}`);
}

function openMainWindow() {
  createWindow().catch((err) => {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Synkban failed to start: ${detail}\n`);
    dialog.showErrorBox('Synkban failed to start', detail);
    killBackend();
    app.exit(1);
  });
}

function killBackend() {
  if (backendProcess && !backendProcess.killed) {
    try {
      backendProcess.kill();
    } catch {
      /* already gone */
    }
    backendProcess = null;
  }
}

if (app) {
  app.whenReady().then(() => {
    // Windows groups taskbar buttons (and resolves the pinned shortcut's icon) by
    // AppUserModelID. Without this the running window is its own anonymous group
    // with Electron's default icon instead of the installed shortcut's.
    app.setAppUserModelId('com.synkban.app');
    app.setAboutPanelOptions({
      applicationName: 'Synkban',
      applicationVersion: appVersion,
      version: buildStamp,
    });
    registerSettingsIpc();
    openMainWindow();
  });

  app.on('window-all-closed', () => {
    killBackend();
    app.quit();
  });

  // Kill the spawned backend whenever the main process goes away — not just on
  // window-all-closed. Force-quit, an external SIGTERM (e.g. a test harness
  // closing the app), or any quit path would otherwise orphan the Rust child.
  app.on('before-quit', killBackend);
  process.on('exit', killBackend);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      killBackend();
      process.exit(0);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });
}

module.exports = { startBackend, killBackend };
