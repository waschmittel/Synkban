// Minimal bridge for the two shell-only operations the web UI can't do over
// HTTP: opening the native directory picker and relaunching the app after a
// data-dir change. Settings themselves are persisted by the backend in
// ~/.config/synkban/synkban.toml via PUT /api/settings.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('synkbanDesktop', {
  // Native folder picker; resolves the chosen path or null when cancelled.
  pickDataDir: (currentDir) => ipcRenderer.invoke('synkban:pick-data-dir', currentDir),
  // Full app relaunch (respawns the backend so it picks up the new data dir).
  relaunch: () => ipcRenderer.invoke('synkban:relaunch'),
});
