import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8080",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    command: "./backend/target/release/synkban",
    port: 8080,
    reuseExistingServer: false,
    env: { DATA_DIR: "./test-data", HOST: "127.0.0.1", PORT: "8080" },
  },
});
