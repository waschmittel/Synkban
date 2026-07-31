import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { existsSync, readdirSync, readFileSync, mkdtempSync } from "node:fs";
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
    // --user-data-dir isolates getPath('userData'); DATA_DIR and
    // SYNKBAN_CONFIG_DIR isolate the spawned backend (it resolves both from
    // the environment / ~/.config/synkban otherwise), so the test's seeded
    // board and its settings writes never land in the real user dirs.
    const userDataDir = mkdtempSync(join(tmpdir(), "synkban-electron-e2e-"));
    app = await electron.launch({
      executablePath: exe!,
      args: [
        join(__dirname, "..", "..", "electron", "main.js"),
        `--user-data-dir=${userDataDir}`,
      ],
      env: {
        ...process.env,
        DATA_DIR: mkdtempSync(join(tmpdir(), "synkban-electron-e2e-data-")),
        SYNKBAN_CONFIG_DIR: mkdtempSync(join(tmpdir(), "synkban-electron-e2e-config-")),
      },
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

// The Linux menu/taskbar icon is looked up by name in the hicolor theme, whose
// index.theme only declares sizes up to 512 — electron-builder installs one
// directory per *source* PNG, so a lone 1024px source lands in a directory no
// desktop environment ever searches and the app shows no icon at all. These are
// fs-only checks: they run everywhere, including where Electron itself can't.
test.describe("desktop icon assets", () => {
  const iconDir = join(__dirname, "..", "..", "backend", "icons", "png");

  // Width/height live in the IHDR chunk at a fixed offset — enough to catch a
  // resize that didn't match the filename electron-builder derives sizes from.
  function pngSize(file: string): { width: number; height: number } {
    const header = readFileSync(file).subarray(16, 24);
    return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
  }

  test("the linux icon set covers the hicolor sizes and every file matches its name", () => {
    const sizes = readdirSync(iconDir)
      .filter((f) => f.endsWith(".png"))
      .map((f) => {
        const { width, height } = pngSize(join(iconDir, f));
        expect(f, `${f} must be named <size>x<size>.png`).toMatch(/^(\d+)x\1\.png$/);
        expect({ f, width, height }).toEqual({ f, width: parseInt(f, 10), height: parseInt(f, 10) });
        return parseInt(f, 10);
      });

    for (const required of [16, 24, 32, 48, 64, 128, 256, 512]) {
      expect(sizes, `hicolor size ${required} is missing from ${iconDir}`).toContain(required);
    }
  });

  test("electron-builder points at the icon set and main.js at a real dev icon", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "electron", "package.json"), "utf8"),
    );
    // A directory, not a single png: one png makes electron-builder emit a
    // single-entry "set" at that png's own size.
    expect(pkg.build.linux.icon).toBe("../backend/icons/png");
    // Electron derives the window's app_id from desktopName; the generated
    // .desktop file's StartupWMClass follows it, and the two must agree or the
    // running window is never linked to its launcher entry (= no dock icon).
    expect(pkg.desktopName).toBe("synkban.desktop");
    expect(existsSync(join(iconDir, "512x512.png"))).toBe(true);
  });
});
