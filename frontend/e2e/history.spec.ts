import { test, expect, type APIRequestContext } from "@playwright/test";

async function seedCard(request: APIRequestContext, boardTitle: string) {
  const board = await (await request.post("/api/boards", { data: { title: boardTitle } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Original title" } })
  ).json();
  return { board, card };
}

const edit = (request: APIRequestContext, id: string, data: object) =>
  request.put(`/api/cards/${id}`, { data });

test("history lists versions newest first and diffs the selection against the current card", async ({
  page,
  request,
}) => {
  const { board, card } = await seedCard(request, "History Board");
  await edit(request, card.id, { title: "Second title" });
  await edit(request, card.id, {
    title: "Third title",
    checklist: [{ id: "a", text: "Step", done: true }],
  });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Third title" }).click();
  await page.locator(".modal-history-btn").click();

  // Original + two edits, newest first; the newest is flagged as current.
  const items = page.locator(".history-item");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0).locator(".history-item-badge")).toHaveText("Current");

  // The previous version is preselected: its title is removed, the current one added.
  await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
  const titleField = page.locator(".history-field", { hasText: "Title" }).first();
  await expect(titleField.locator(".history-line--removed")).toHaveText(/Second title/);
  await expect(titleField.locator(".history-line--added")).toHaveText(/Third title/);

  // Arrow keys walk to the oldest version, where the checklist item is new.
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(titleField.locator(".history-line--removed")).toHaveText(/Original title/);
  await expect(
    page.locator(".history-field", { hasText: "Checklist" }).locator(".history-line--added")
  ).toHaveText(/Step/);

  // The current version has no differences.
  await items.nth(0).click();
  await expect(page.locator(".history-note")).toHaveText("This is the current version.");
  await expect(page.locator(".history-line--added, .history-line--removed")).toHaveCount(0);
});

test("history Escape closes only the history dialog", async ({ page, request }) => {
  const { board, card } = await seedCard(request, "History Esc Board");
  await edit(request, card.id, { title: "Changed" });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Changed" }).click();
  await page.locator(".modal-history-btn").click();
  await expect(page.locator(".history-dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".history-dialog")).toHaveCount(0);
  await expect(page.locator(".modal-content")).toBeVisible();
});

test("a card without edits says so; attachments appear by name", async ({ page, request }) => {
  const { board, card } = await seedCard(request, "History Empty Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Original title" }).click();
  await page.locator(".modal-history-btn").click();
  await expect(page.locator(".history-message")).toHaveText("No changes recorded yet.");
  await page.keyboard.press("Escape");

  await request.post(`/api/cards/${card.id}/attachments?filename=notes.txt`, {
    headers: { "Content-Type": "text/plain" },
    data: "hello",
  });
  const history = await (await request.get(`/api/cards/${card.id}/history`)).json();
  expect(history.entries.map((e: { attachments: string[] }) => e.attachments)).toEqual([
    ["notes.txt"],
    [],
  ]);
  // Card payloads stay slim: no inline history.
  const detail = await (await request.get(`/api/boards/${board.id}`)).json();
  expect(detail.lists[0].cards[0].history).toBeUndefined();
});

test("Accel+J opens and closes history; Home/End jump to the ends", async ({ page, request }) => {
  const { board, card } = await seedCard(request, "History Keys Board");
  await edit(request, card.id, { title: "Two" });
  await edit(request, card.id, { title: "Three" });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Three" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();

  await page.keyboard.press("ControlOrMeta+j");
  const items = page.locator(".history-item");
  await expect(items).toHaveCount(3);

  await page.keyboard.press("End");
  await expect(items.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(items.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("PageDown");
  await expect(items.nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.locator(".history-dialog")).toHaveCount(0);
  await expect(page.locator(".modal-content")).toBeVisible();
});

// A history field's block, found by its heading (not by text, which would also
// match the field's own content).
const field = (page: import("@playwright/test").Page, name: string) =>
  page.locator(".history-field").filter({
    has: page.locator(".history-field-title", { hasText: new RegExp(`^${name}`) }),
  });

test("saving through the modal records every tracked field, and the diff shows each", async ({
  page,
  request,
}) => {
  const { board, card } = await seedCard(request, "History UI Board");
  await request.post(`/api/boards/${board.id}/labels`, { data: { name: "Urgent" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Original title" }).click();

  // Attachments persist immediately (not on Save), so this is its own version.
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.locator(".attachment-item").first()).toBeVisible();

  // Everything else goes through one Save.
  await page.locator(".modal-title-input").fill("Edited title");
  await page.locator(".editor-wrapper .ProseMirror").click();
  await page.keyboard.type("Brand new description");
  await page.locator(".label-add-btn").click();
  await page.locator(".label-picker-item", { hasText: "Urgent" }).click();
  await page.locator(".due-date-input").fill("2031-05-06");
  await page.locator(".modal-footer .btn-primary").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  await page.locator(".card", { hasText: "Edited title" }).click();
  await page.locator(".modal-history-btn").click();

  // Original → with attachment → saved: three versions, newest first.
  const items = page.locator(".history-item");
  await expect(items).toHaveCount(3);

  // Previous version (has the attachment, still the old fields).
  await expect(items.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(field(page, "Title").locator(".history-line--removed")).toHaveText(/Original title/);
  await expect(field(page, "Title").locator(".history-line--added")).toHaveText(/Edited title/);
  await expect(field(page, "Description").locator(".history-line--added")).toHaveText(
    /Brand new description/
  );
  await expect(field(page, "Labels").locator(".history-line--added")).toHaveText(/Urgent/);
  await expect(field(page, "Due date").locator(".history-line--added")).toHaveText(/2031-05-06/);
  await expect(field(page, "Attachments")).toContainText("unchanged");
  await expect(field(page, "Attachments").locator(".history-line--same")).toHaveText(/notes\.txt/);

  // Oldest version: the attachment was not there yet.
  await page.keyboard.press("End");
  await expect(items.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(field(page, "Attachments").locator(".history-line--added")).toHaveText(/notes\.txt/);

  // And the persisted record agrees (names only for attachments).
  const history = await (await request.get(`/api/cards/${card.id}/history`)).json();
  expect(history.entries.map((e: { attachments: string[] }) => e.attachments)).toEqual([
    ["notes.txt"],
    ["notes.txt"],
    [],
  ]);
});

test("unsaved edits in the modal are not part of the history diff", async ({ page, request }) => {
  const { board, card } = await seedCard(request, "History Unsaved Board");
  await edit(request, card.id, { title: "Saved title" });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Saved title" }).click();
  await page.locator(".modal-title-input").fill("Typed but never saved");
  await page.locator(".modal-history-btn").click();

  await expect(page.locator(".history-item")).toHaveCount(2);
  await expect(page.locator(".history-detail")).not.toContainText("Typed but never saved");
  await expect(field(page, "Title").locator(".history-line--added")).toHaveText(/Saved title/);
});

test("history keeps only the newest 100 versions", async ({ request }) => {
  const { card } = await seedCard(request, "History Cap Board");
  for (let i = 1; i <= 105; i++) await edit(request, card.id, { title: `Title ${i}` });

  const history = await (await request.get(`/api/cards/${card.id}/history`)).json();
  expect(history.entries).toHaveLength(100);
  expect(history.entries[0].title).toBe("Title 105");
  expect(history.entries[99].title).toBe("Title 6");
});
