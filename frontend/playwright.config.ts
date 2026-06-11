import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 8091 so a dev server on 8080 doesn't collide with the e2e instance.
const PORT = 8091;
const dataDir = mkdtempSync(join(tmpdir(), "synkban-e2e-"));
const binary = join(
  "..",
  "backend",
  "target",
  "release",
  process.platform === "win32" ? "synkban.exe" : "synkban"
);

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  webServer: {
    command: binary,
    url: `http://127.0.0.1:${PORT}/api/boards`,
    env: { PORT: String(PORT), DATA_DIR: dataDir },
    reuseExistingServer: false,
  },
});
