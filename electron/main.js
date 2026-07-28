const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

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
  appVersion = app.getVersion();
  buildStamp = '';
}

function getBackendPath() {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.resourcesPath, `synkban${ext}`);
  }
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(__dirname, '..', 'backend', 'target', 'release', `synkban${ext}`);
}

function startBackend(token) {
  return new Promise((resolve, reject) => {
    // No DATA_DIR: the binary resolves its data dir from synkban.toml (or an
    // inherited DATA_DIR/--data-dir override in dev).
    const env = { ...process.env, DESKTOP_TOKEN: token };
    backendProcess = spawn(getBackendPath(), [], { env });

    backendProcess.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/DESKTOP_PORT=(\d+)/);
      if (match) {
        resolve(parseInt(match[1], 10));
      }
    });

    backendProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    backendProcess.on('error', reject);

    backendProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Backend exited with code ${code}`));
      }
    });
  });
}

async function createWindow() {
  const token = crypto.randomUUID().replace(/-/g, '');
  const port = await startBackend(token);

  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Synkban',
    // Seamless titlebar: the window is frameless and the app's own .app-header
    // extends to the top edge, with the OS window controls drawn over it
    // (macOS traffic lights on the left, Windows caption buttons on the right,
    // Linux wherever the desktop environment puts them).
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
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

  mainWindow.loadURL(`${appOrigin}/?token=${token}`);
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Synkban',
    applicationVersion: appVersion,
    version: buildStamp,
  });
  registerSettingsIpc();
  createWindow();
});

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
    createWindow();
  }
});
