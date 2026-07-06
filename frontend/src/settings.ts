// Settings live server-side in ~/.config/synkban/synkban.toml, accessed via
// GET/PUT /api/settings. They can NOT live in localStorage: the desktop shell
// serves the UI from a random port each launch, and localStorage is scoped
// per origin (scheme+host+port), so client-side state never survives a
// desktop restart.

import { api } from "./api";

let lastRecorded: string | null = null;

/// Persist the currently open board as the "last used board" (startup-view
/// preference). Deduped per page load so board refetches (15s polling) don't
/// rewrite the config file on every tick.
export function recordLastBoard(id: string) {
  if (lastRecorded === id) return;
  lastRecorded = id;
  api.updateSettings({ last_board_id: id }).catch(() => {
    lastRecorded = null; // retry on the next load/navigation
  });
}

// --- Electron shell bridge (exposed by electron/preload.js) ---
// Only the two operations the web UI can't do over HTTP.

export interface DesktopBridge {
  /** Native folder picker; resolves the chosen path or null when cancelled. */
  pickDataDir(currentDir: string): Promise<string | null>;
  /** Relaunch the app (respawns the backend on the new data dir). */
  relaunch(): Promise<void>;
}

export function desktopBridge(): DesktopBridge | undefined {
  return (window as { synkbanDesktop?: DesktopBridge }).synkbanDesktop;
}
