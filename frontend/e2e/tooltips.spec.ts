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
    [".card-archive", /\(Del\)$/],
    [".board-dock-dot", /\(, \/ \.\)$/],
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
  await page.locator('input[type="file"]').setInputFiles({
    name: "a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("x"),
  });
  await expect(page.locator(".attachment-item").first()).toBeVisible();

  await expectTitles(page, [
    [".modal-title-input", new RegExp(`${A("E")}\\)$`)],
    [".modal-close", /\(Esc\)$/],
    [".modal-section-header:has-text('Labels') .modal-label", new RegExp(`${A("G")}\\)$`)],
    [".due-date-calendar-btn", new RegExp(`${A("U")}\\)$`)],
    [".modal-section-header:has-text('Description') .modal-label", new RegExp(`${A("D")}\\)$`)],
    [".checklist-add-input", new RegExp(`${A("L")}\\)$`)],
    [".checklist-item .checklist-delete, .checklist-item [title^='Remove item']", /\(Del\)$/],
    [".attachment-upload", new RegExp(`${A("O")}\\)$`)],
    [".attachment-delete", /\(Del\)$/],
    [".modal-footer .btn-primary", new RegExp(`${A("S")}\\)$`)],
    [".modal-footer .btn-cancel", /\(Esc\)$/],
    [".modal-history-btn", new RegExp(`${A("J")}\\)$`)],
  ]);
  // The history button carries an icon, not just text.
  await expect(page.locator(".modal-history-btn svg")).toHaveCount(1);
});
