import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendBinary = join(
  __dirname,
  "..",
  "..",
  "backend",
  "target",
  "release",
  process.platform === "win32" ? "synkban.exe" : "synkban",
);

// Dedicated server instance (see playwright.config.ts): settings are global
// server state in synkban.toml, so these tests must not share a server with
// the parallel board/card specs.
test.use({ baseURL: "http://127.0.0.1:8092" });
test.describe.configure({ mode: "serial" });

test("startup preference: saved via dialog and honored on launch", async ({ page, request }) => {
  await request.put("/api/settings", {
    data: { startup_view: "overview", last_board_id: null },
  });
  const board = await (
    await request.post("/api/boards", { data: { title: "Startup Board" } })
  ).json();

  // Visiting a board records it server-side as the last used board.
  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".app-logo--board")).toHaveText("Startup Board");

  // The settings gear is available on board pages too.
  await expect(page.locator(".btn-header-settings")).toBeVisible();
  await page.locator(".app-logo-home").click();
  await expect(page.locator(".btn-header-settings")).toBeVisible();

  // Stage "last used board" and Save.
  await page.locator(".btn-header-settings").click();
  await expect(page.locator(".settings-dialog")).toBeVisible();
  await page.getByRole("radio", { name: /Last used board/ }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".settings-overlay")).toHaveCount(0);

  // Persisted server-side (synkban.toml), including the recorded board.
  const saved = await (await request.get("/api/settings")).json();
  expect(saved.startup_view).toBe("last");
  expect(saved.last_board_id).toBe(board.id);

  // A fresh load of "/" bounces to the board before the router initializes.
  await page.goto("/");
  await expect(page).toHaveURL(`/board/${board.id}`);
  await expect(page.locator(".app-logo--board")).toHaveText("Startup Board");

  // In-app navigation back to the overview must NOT bounce.
  await page.locator(".app-logo-home").click();
  await expect(page).toHaveURL("/");
  await expect(page.locator(".home")).toBeVisible();
});

test("cancel and escape discard staged changes", async ({ page, request }) => {
  await request.put("/api/settings", { data: { startup_view: "overview" } });
  await page.goto("/");

  // Stage a change, then Cancel — nothing persists.
  await page.locator(".btn-header-settings").click();
  await page.getByRole("radio", { name: /Last used board/ }).check();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
  let settings = await (await request.get("/api/settings")).json();
  expect(settings.startup_view).toBe("overview");

  // Reopening starts from the persisted state, not the discarded staging.
  await page.locator(".btn-header-settings").click();
  await expect(page.getByRole("radio", { name: /Board overview/ })).toBeChecked();

  // Escape discards too.
  await page.getByRole("radio", { name: /Last used board/ }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
  settings = await (await request.get("/api/settings")).json();
  expect(settings.startup_view).toBe("overview");
});

test("stale last board id is filtered out server-side", async ({ page, request }) => {
  await request.put("/api/settings", {
    data: {
      startup_view: "last",
      last_board_id: "00000000-0000-0000-0000-000000000000",
    },
  });

  // GET self-heals: an id that no longer resolves to an active board is absent.
  const settings = await (await request.get("/api/settings")).json();
  expect(settings.last_board_id).toBeNull();

  // So launching at "/" stays on the overview instead of a dead board.
  await page.goto("/");
  await expect(page.locator(".home")).toBeVisible();

  await request.put("/api/settings", { data: { startup_view: "overview" } });
});

test("web mode shows the server-managed data folder", async ({ page, request }) => {
  const settings = await (await request.get("/api/settings")).json();

  await page.goto("/");
  await page.locator(".btn-header-settings").click();
  const dialog = page.locator(".settings-dialog");
  await expect(dialog).toBeVisible();

  // No Electron bridge in the browser → explanatory hints with the live path
  // and `synkban export` CLI command instead of folder pickers.
  const dataSec = dialog.locator('[data-section="data-dir"]');
  await expect(dataSec.locator(".settings-hint")).toContainText("--data-dir");
  await expect(dataSec.locator(".settings-path--inline code")).toHaveText(settings.data_dir);
  await expect(dataSec.getByRole("button", { name: "Browse…" })).toHaveCount(0);

  const mirrorSec = dialog.locator('[data-section="readable-mirror"]');
  await expect(mirrorSec.locator(".settings-hint")).toContainText("synkban export");
  await expect(mirrorSec.getByRole("button", { name: "Browse…" })).toHaveCount(0);

  // Overlay click closes (discard semantics).
  await page.locator(".settings-overlay").click({ position: { x: 5, y: 5 } });
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
});

test("appearance: theme persists, previews live, and discards on Escape", async ({ page, request }) => {
  await request.put("/api/settings", { data: { theme: "system" } });
  await page.goto("/");
  const html = page.locator("html");

  // Force Dark via the dialog. The preview flips <html> before Save.
  await page.locator(".btn-header-settings").click();
  await expect(page.locator(".settings-dialog")).toBeVisible();
  await page.getByRole("radio", { name: /Dark/ }).check();
  await expect(html).toHaveClass(/theme-dark/);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".settings-overlay")).toHaveCount(0);

  // Persisted server-side and still applied.
  expect((await (await request.get("/api/settings")).json()).theme).toBe("dark");
  await expect(html).toHaveClass(/theme-dark/);

  // Survives a fresh load (index.html sets the OS default, bootstrap applies
  // the persisted "dark" — even though the test browser reports a light OS).
  await page.goto("/");
  await expect(html).toHaveClass(/theme-dark/);

  // Preview + discard: switch to Light, Escape, and the preview rolls back to
  // the persisted Dark — nothing is written.
  await page.locator(".btn-header-settings").click();
  await page.getByRole("radio", { name: /Light/ }).check();
  await expect(html).not.toHaveClass(/theme-dark/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
  await expect(html).toHaveClass(/theme-dark/);
  expect((await (await request.get("/api/settings")).json()).theme).toBe("dark");

  // Reset so later runs / other specs start from the default.
  await request.put("/api/settings", { data: { theme: "system" } });
});

test("synkban export produces a file://-browseable master-detail mirror", async ({ page, request }) => {
  const settings = await (await request.get("/api/settings")).json();
  const board = await (
    await request.post("/api/boards", { data: { title: "Mirror Board" } })
  ).json();
  await request.put(`/api/boards/${board.id}`, { data: { color: "#2b6cb0" } });
  const label = await (
    await request.post(`/api/boards/${board.id}/labels`, {
      data: { name: "**Priority**", color: "#111111" },
    })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Specs" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, {
      data: { title: "Mirror *Card*", label_ids: [label.id] },
    })
  ).json();

  // 1x1 PNG so inline image naturalWidth > 0 works offline over file://
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const attPng = await (
    await request.post(`/api/cards/${card.id}/attachments?filename=diagram.png`, {
      headers: { "Content-Type": "image/png" },
      data: tinyPng,
    })
  ).json();
  const attTar = await (
    await request.post(
      `/api/cards/${card.id}/attachments?filename=${encodeURIComponent("Release (v1).tar.gz")}`,
      {
        headers: { "Content-Type": "application/gzip" },
        data: Buffer.from("tarball"),
      },
    )
  ).json();

  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "image", attrs: { att: attPng.id, alt: "diagram" } },
          { type: "footnote_ref", attrs: { id: "fn1" } },
        ],
      },
      {
        type: "alert",
        attrs: { kind: "warning" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Heads up" }] }],
      },
      {
        type: "table",
        attrs: { matrix: false },
        content: [
          {
            type: "table_row",
            content: [
              {
                type: "table_header",
                attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Key" }] }],
              },
            ],
          },
          {
            type: "table_row",
            content: [
              {
                type: "table_cell",
                attrs: { colspan: 1, rowspan: 1, colwidth: null, align: "right" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Val" }] }],
              },
            ],
          },
        ],
      },
      {
        type: "footnote_list",
        content: [
          {
            type: "footnote_def",
            attrs: { id: "fn1" },
            content: [{ type: "footnote_paragraph", content: [{ type: "text", text: "Note one" }] }],
          },
        ],
      },
    ],
  };
  await request.put(`/api/cards/${card.id}`, {
    data: { description: JSON.stringify(doc) },
  });

  const mirrorDir = mkdtempSync(join(tmpdir(), "synkban-mirror-e2e-"));
  const cfgDir = mkdtempSync(join(tmpdir(), "synkban-mirror-cfg-"));
  execFileSync(backendBinary, ["export", mirrorDir, "--data-dir", settings.data_dir], {
    env: { ...process.env, SYNKBAN_CONFIG_DIR: cfgDir },
  });

  expect(existsSync(join(mirrorDir, "README.md"))).toBe(true);
  expect(existsSync(join(mirrorDir, "style.css"))).toBe(true);
  expect(existsSync(join(mirrorDir, "index.html"))).toBe(true);
  expect(
    existsSync(join(mirrorDir, "boards", board.id, "cards", card.id, "attachments", "diagram.png")),
  ).toBe(true);
  expect(
    existsSync(
      join(mirrorDir, "boards", board.id, "cards", card.id, "attachments", `${attTar.id}.tar.gz`),
    ),
  ).toBe(true);

  await page.goto(pathToFileURL(join(mirrorDir, "index.html")).href);
  await expect(page.locator(".mirror-shell")).toHaveCSS("display", "grid");

  // Explorer tree starts collapsed by default
  const link = page.locator(`a.card-link[data-card="${card.id}"]`);
  await expect(page.locator(".board-group[open]")).toHaveCount(0);
  await expect(page.locator(".list-group[open]")).toHaveCount(0);
  await expect(link).toBeHidden();

  // Expand the board and list, then click the card link to verify iframe navigation + hash deep-linking on file://
  await page.locator(".board-summary", { hasText: "Mirror Board" }).click();
  await page.locator(".list-summary", { hasText: "Specs" }).click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#${board.id}/${card.id}$`));

  const frame = page.frameLocator("#detail-frame");
  await expect(frame.locator("h1.card-title")).toContainText("Mirror Card");
  await expect(frame.locator("h1.card-title em")).toHaveText("Card");
  await expect(frame.locator(".alert--warning")).toContainText("Heads up");
  await expect(frame.locator(".doc-table td")).toHaveCSS("border-top-style", "solid");
  await expect
    .poll(() => frame.locator(".inline-image").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  // Hash persists across reload
  await page.reload();
  await expect(frame.locator("h1.card-title")).toContainText("Mirror Card");

  // Live filter works and Escape clears it
  const search = page.locator("#mirror-search");
  await search.fill("nonexistent-xyz");
  await expect(page.locator("#mirror-no-match")).toBeVisible();
  await search.press("Escape");
  await expect(link).toBeVisible();
});
