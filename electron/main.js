const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

let mainWindow = null;
let backendProcess = null;

// Build version written by build.sh (release tag or dated snapshot).
// Falls back to the package.json version for unstamped dev runs.
let appVersion;
try {
  appVersion = require('./app-version.json').version;
} catch {
  appVersion = app.getVersion();
}

function getBackendPath() {
  if (app.isPackaged) {
    const ext = process.platform === 'win32' ? '.exe' : '';
    return path.join(process.resourcesPath, `synkban${ext}`);
  }
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(__dirname, '..', 'backend', 'target', 'release', `synkban${ext}`);
}

function startBackend(token, dataDir) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DESKTOP_TOKEN: token, DATA_DIR: dataDir };
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
  const dataDir = app.getPath('userData');
  const port = await startBackend(token, dataDir);

  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Synkban',
    // Seamless titlebar: macOS gets traffic-light overlay (hiddenInset),
    // Windows/Linux get an overlay that paints native controls over the
    // app's own header so content can extend to the very top edge.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac
      ? undefined
      : { color: '#00000000', symbolColor: '#ffffff', height: 36 },
    trafficLightPosition: isMac ? { x: 14, y: 16 } : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const appOrigin = `http://127.0.0.1:${port}`;

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
  });
  createWindow();
});

app.on('window-all-closed', () => {
  backendProcess?.kill();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
