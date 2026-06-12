import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Demo recording config: boots the release binary on its own port with a
// fresh temp DATA_DIR (same pattern as playwright.config.ts) and records a
// video of the demo script in demo/. record-demo.sh converts it to demo.gif.
const PORT = 8092;
const dataDir = mkdtempSync(join(tmpdir(), "synkban-demo-"));
const binary = join(
  "..",
  "backend",
  "target",
  "release",
  process.platform === "win32" ? "synkban.exe" : "synkban"
);

export default defineConfig({
  testDir: "./demo",
  outputDir: "./demo-results",
  reporter: "list",
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
  },
  webServer: {
    command: binary,
    url: `http://127.0.0.1:${PORT}/api/boards`,
    env: { PORT: String(PORT), DATA_DIR: dataDir },
    reuseExistingServer: false,
  },
});
