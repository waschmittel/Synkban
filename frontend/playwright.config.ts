import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 8091 so a dev server on 8080 doesn't collide with the e2e instance.
const PORT = 8091;
// Dedicated instance for settings.spec.ts: settings (startup view, last board)
// are global server state persisted in synkban.toml, so tests that mutate them
// must not share a server with the parallel-running board/card specs — a
// concurrently-set "open last used board" would redirect their goto("/").
export const SETTINGS_PORT = 8092;

const binary = join(
  "..",
  "backend",
  "target",
  "release",
  process.platform === "win32" ? "synkban.exe" : "synkban"
);

// Every instance gets a temp SYNKBAN_CONFIG_DIR so tests never touch the real
// ~/.config/synkban/synkban.toml (recordLastBoard writes it on board visits).
const serverEnv = () => ({
  DATA_DIR: mkdtempSync(join(tmpdir(), "synkban-e2e-data-")),
  SYNKBAN_CONFIG_DIR: mkdtempSync(join(tmpdir(), "synkban-e2e-config-")),
});

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: [
    {
      command: binary,
      url: `http://127.0.0.1:${PORT}/api/boards`,
      env: { PORT: String(PORT), ...serverEnv() },
      reuseExistingServer: false,
    },
    {
      command: binary,
      url: `http://127.0.0.1:${SETTINGS_PORT}/api/boards`,
      env: { PORT: String(SETTINGS_PORT), ...serverEnv() },
      reuseExistingServer: false,
    },
  ],
});
