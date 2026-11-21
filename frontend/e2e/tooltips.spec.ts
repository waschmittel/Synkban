import { test, expect, type Page } from "@playwright/test";

// Requirement (CLAUDE.md, "Shortcut discoverability"): every control that has a
// keyboard shortcut advertises it in its tooltip, as "Label (KEY)". This spec
// is the guard — extend the tables when adding a shortcut.
//
// Accelerator chords render as "⌘X" on macOS and "Ctrl+X" elsewhere.
const A = (k: string) => `(?:⌘|Ctrl\\+)${k}`;

async function expectTitles(page: Page, table: [string, RegExp][]) {
  for (const [selector, re] of table) {
    await expect(page.locator(selector).first(), selector).toHaveAttribute("title", re);
  }
}

test("home controls show their shortcuts", async ({ page, request }) => {
  await request.post("/api/boards", { data: { title: "Tooltip Home" } });
  await page.goto("/");
  await expect(page.locator(".board-card-link", { hasText: "Tooltip Home" })).toBeVisible();

  await expectTitles(page, [
    [".btn-header-shortcuts", /\(\?\)$/],
    [".board-archive-toggle", /\(A\)$/],
    [".board-card.add-board", /\(N\)$/],
    [".board-card-delete", /\(Del\)$/],
  ]);
});

test("board controls show their shortcuts", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Tooltip Board" } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Tip card" } });

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".card", { hasText: "Tip card" })).toBeVisible();

  await expectTitles(page, [
    [".app-logo-home", /\(B\)$/],
    [".btn-header-labels", /\(G\)$/],
    [".btn-header-shortcuts", /\(\?\)$/],
    [".board-filter-btn", /\(F\)$/],
    [".board-archive-btn", /\(A\)$/],
    [".list .add-trigger", /\(N\)$/],
    [".add-list-wrapper .add-trigger", /\(L\)$/],
    [".list-title", /\(R\)$/],
    [".list-collapse", /^Collapse list \(C\)$/],
    [".card-archive", /\(Del\)$/],
    [".board-dock-dot", /\(, \/ \.\)$/],
    [".board-mode-btn:has-text('Board')", /\(V\)$/],
    [".board-mode-btn:has-text('Notes')", /\(V\)$/],
  ]);
});

test("notes view controls show their shortcuts", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Tooltip Notes" } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Later" } });
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Note card" } });
  await request.put(`/api/boards/${board.id}`, { data: { mode: "notes" } });

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".notes-detail")).toBeVisible();

  await expectTitles(page, [
    [".notes-tab:not(.notes-tab--active) .notes-tab-btn", /\(← \/ →\)$/],
    [".notes-tab--active .notes-tab-btn", /click to rename \(R\)$/],
    [".notes-master .add-trigger", /\(N\)$/],
    [".notes-tabs .add-list-wrapper .add-trigger", /\(L\)$/],
    [".notes-master .card-archive", /\(Del\)$/],
    [".notes-detail .modal-title-input", new RegExp(`${A("E")}\\)$`)],
    [".notes-detail .modal-save-btn", new RegExp(`${A("S")}\\)$`)],
    // Empty checklist / attachments collapse into "+" buttons with the section keys.
    [".notes-detail .detail-add-checklist", new RegExp(`^Add checklist \\(${A("L")}\\)$`)],
    [".notes-detail .detail-add-attachment", new RegExp(`^Add attachment \\(${A("O")}\\)$`)],
    [".notes-detail .due-chip", new RegExp(`^Set due date \\(${A("U")}\\)$`)],
    [".notes-detail .modal-export-btn", new RegExp(`${A("P")}\\)$`)],
    [".notes-detail .modal-history-btn", new RegExp(`${A("J")}\\)$`)],
  ]);
});

test("card detail controls show their shortcuts", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Tooltip Detail" } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Detail card" } });
  const card = await (
    await request.get(`/api/boards/${board.id}`)
  ).json();
  const cardId = card.lists[0].cards[0].id;
  await request.put(`/api/cards/${cardId}`, {
    data: { checklist: [{ id: "c1", text: "Step", done: false }] },
  });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Detail card" }).click();
  await expect(page.locator(".modal-title-input")).toBeVisible();
  await page.locator(".attachment-file-input").setInputFiles({
    name: "a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("x"),
  });
  await expect(page.locator(".attachment-item").first()).toBeVisible();

  await page.locator(".editor-wrapper .ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("e");
  await page.keyboard.type("return 1");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".lua-block-status")).toHaveText("Ran");

  await expectTitles(page, [
    [".modal-title-input", new RegExp(`${A("E")}\\)$`)],
    [".modal-close", /\(Esc\)$/],
    // Section icons carry the section name and its shortcut.
    [".due-date-area .detail-row-label", new RegExp(`^Due date \\(${A("U")}\\)$`)],
    [".label-section .detail-row-label", new RegExp(`^Labels \\(${A("G")}\\)$`)],
    [".description-row .detail-row-label", new RegExp(`^Description \\(${A("D")}\\)$`)],
    [".checklist-area .detail-row-label", new RegExp(`^Checklist \\(${A("L")}\\)$`)],
    [".attachments-area .detail-row-label", new RegExp(`^Attachments \\(${A("O")}\\)$`)],
    [".due-chip", new RegExp(`${A("U")}\\)$`)],
    [".checklist-add-input", new RegExp(`${A("L")}\\)$`)],
    [".checklist-item .checklist-delete, .checklist-item [title^='Remove item']", /\(Del\)$/],
    [".attachment-upload", new RegExp(`${A("O")}\\)$`)],
    [".attachment-delete", /\(Del\)$/],
    [".modal-save-btn", new RegExp(`${A("S")}\\)$`)],
    [".modal-export-btn", new RegExp(`${A("P")}\\)$`)],
    [".modal-history-btn", new RegExp(`${A("J")}\\)$`)],
    [".lua-block-run", new RegExp(`^Run Lua \\(${A("Enter")}\\)$`)],
    [".lua-block-clear", /^Clear output$/],
  ]);
  // The history button carries an icon, not just text.
  await expect(page.locator(".modal-history-btn svg")).toHaveCount(1);
});
