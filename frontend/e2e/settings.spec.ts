import { test, expect } from "@playwright/test";

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

  // The settings gear only exists on the board overview.
  await expect(page.locator(".btn-header-settings")).toHaveCount(0);
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

  // No Electron bridge in the browser → explanatory hint with the live path
  // instead of a folder picker.
  await expect(dialog.locator(".settings-hint")).toContainText("--data-dir");
  await expect(dialog.locator(".settings-path--inline code")).toHaveText(settings.data_dir);
  await expect(dialog.getByRole("button", { name: "Browse…" })).toHaveCount(0);

  // Overlay click closes (discard semantics).
  await page.locator(".settings-overlay").click({ position: { x: 5, y: 5 } });
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
});
