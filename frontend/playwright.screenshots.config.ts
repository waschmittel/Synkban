import { defineConfig } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Screenshot generator config: boots the release binary on an isolated port
// against clean temporary data/config directories so real user boards and
// ~/.config/synkban/synkban.toml are never touched.
const PORT = 8094;

const root =
  process.platform === "win32"
    ? join(tmpdir(), "synkban-screenshots")
    : "/tmp/synkban";

const dataDir = join(root, "data");
const configDir = join(root, "config");

rmSync(dataDir, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(configDir, { recursive: true });

const binary = join(
  "..",
  "backend",
  "target",
  "release",
  process.platform === "win32" ? "synkban.exe" : "synkban",
);

export default defineConfig({
  testDir: "./screenshots",
  outputDir: join(tmpdir(), "synkban-screenshots-results"),
  reporter: "list",
  timeout: 120_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1240, height: 840 },
    deviceScaleFactor: 2,
    locale: "en-US",
  },
  webServer: {
    command: binary,
    url: `http://127.0.0.1:${PORT}/api/boards`,
    env: {
      PORT: String(PORT),
      DATA_DIR: dataDir,
      SYNKBAN_CONFIG_DIR: configDir,
      SYNKBAN_DRAFTS: "0",
    },
    reuseExistingServer: false,
  },
});
