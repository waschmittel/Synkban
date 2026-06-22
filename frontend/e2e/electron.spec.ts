import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Electron is the only environment with a *distinct* link requirement: a
// description link's window.open(_blank) must NOT spawn a child BrowserWindow
// (setWindowOpenHandler denies it) and must instead hand the URL to the OS
// default browser via shell.openExternal. The web/PWA builds share one code
// path (window.open opens a new tab / the OS browser) already covered by
// board.spec.ts — there is nothing PWA-specific observable at the JS layer.

// Resolve the Electron executable. A correct install exports the path string
// from require("electron"); when the postinstall didn't write path.txt (CI
// caches, offline installs) fall back to the unpacked dist binary.
function electronExecutable(): string | null {
  try {
    const p = require("electron");
    if (typeof p === "string" && existsSync(p)) return p;
  } catch {
    /* fall through to dist scan */
  }
  const pnpm = join(__dirname, "..", "..", "electron", "node_modules", ".pnpm");
  if (!existsSync(pnpm)) return null;
  const dir = readdirSync(pnpm).find((d) => d.startsWith("electron@"));
  if (!dir) return null;
  const dist = join(pnpm, dir, "node_modules", "electron", "dist");
  const candidates =
    process.platform === "darwin"
      ? [join(dist, "Electron.app", "Contents", "MacOS", "Electron")]
      : process.platform === "win32"
        ? [join(dist, "electron.exe")]
        : [join(dist, "electron")];
  return candidates.find(existsSync) ?? null;
}

const exe = electronExecutable();
const backendBuilt = existsSync(
  join(
    __dirname,
    "..",
    "..",
    "backend",
    "target",
    "release",
    process.platform === "win32" ? "synkban.exe" : "synkban",
  ),
);

// Electron needs a display; skip on headless Linux. Skip if the executable or
// backend binary is missing rather than failing the whole suite.
const canRun =
  !!exe && backendBuilt && !(process.platform === "linux" && !process.env.DISPLAY);

test.describe("electron desktop shell", () => {
  test.skip(!canRun, "electron executable / backend binary / display unavailable");

  let app: ElectronApplication;

  test.afterEach(async () => {
    await app?.close();
  });

  test("description link opens via shell.openExternal, not a child window", async () => {
    // --user-data-dir isolates getPath('userData') to a temp dir so the test's
    // seeded board never lands in the real desktop app's data directory.
    const userDataDir = mkdtempSync(join(tmpdir(), "synkban-electron-e2e-"));
    app = await electron.launch({
      executablePath: exe!,
      args: [
        join(__dirname, "..", "..", "electron", "main.js"),
        `--user-data-dir=${userDataDir}`,
      ],
    });

    // Stub shell.openExternal in the main process and record its calls. main.js
    // captured the same `shell` singleton, so the live setWindowOpenHandler
    // calls this stub. Also block any real OS browser launch.
    await app.evaluate(({ shell }) => {
      (globalThis as any).__opened = [];
      shell.openExternal = (url: string) => {
        (globalThis as any).__opened.push(url);
        return Promise.resolve();
      };
    });

    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const origin = new URL(page.url()).origin;

    // Seed a board + card whose description holds a link mark. The token cookie
    // was set by the initial page load, so same-origin fetch is authenticated.
    const boardId = await page.evaluate(async () => {
      const post = (url: string, body: unknown) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then((r) => r.json());
      const board = await post("/api/boards", { title: "Electron Link Board" });
      const list = await post(`/api/boards/${board.id}/lists`, { title: "Todo" });
      const card = await post(`/api/lists/${list.id}/cards`, { title: "Link card" });
      const doc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "link", attrs: { href: "https://example.com/", title: null } }],
                text: "example link",
              },
            ],
          },
        ],
      };
      await fetch(`/api/cards/${card.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: JSON.stringify(doc) }),
      });
      return board.id as string;
    });

    await page.goto(`${origin}/board/${boardId}`);
    await page.locator(".card", { hasText: "Link card" }).click();
    await expect(page.locator(".modal-overlay")).toBeVisible();

    const windowsBefore = app.windows().length;

    await page
      .locator(".editor-wrapper .ProseMirror a", { hasText: "example link" })
      .click();

    // The URL was handed to the OS browser…
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).__opened))
      .toEqual(["https://example.com/"]);
    // …and no child BrowserWindow was spawned (handler returned deny).
    expect(app.windows().length).toBe(windowsBefore);
  });
});
