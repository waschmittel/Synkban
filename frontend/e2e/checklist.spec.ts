import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

async function seedCard(request: APIRequestContext, boardTitle: string) {
  const board = await (
    await request.post("/api/boards", { data: { title: boardTitle } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Task card" } })
  ).json();
  return { board, list, card };
}

// Add checklist items through the modal UI (the only way now — checklist is
// card content, persisted via the card Save, not via dedicated endpoints).
async function addItems(page: Page, texts: string[]) {
  const addInput = page.locator(".checklist-add-input");
  for (const t of texts) {
    await addInput.fill(t);
    await addInput.press("Enter");
  }
  await expect(page.locator(".checklist-item")).toHaveCount(texts.length);
}

// Save the card (persists checklist) and wait for the modal to close.
async function saveCard(page: Page) {
  await page.locator(".modal-footer .btn-primary").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
}

async function expectPersistedOrder(
  request: APIRequestContext,
  boardId: string,
  expected: string[]
) {
  await expect
    .poll(async () => {
      const detail = await (await request.get(`/api/boards/${boardId}`)).json();
      return detail.lists[0].cards[0].checklist.map((i: { text: string }) => i.text);
    })
    .toEqual(expected);
}

test("add checklist items, toggle one, card badge shows done/total after save", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Checklist Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await addItems(page, ["Step one", "Step two"]);

  // Items keep insertion order.
  await expect(page.locator(".checklist-item").nth(0)).toContainText("Step one");
  await expect(page.locator(".checklist-item").nth(1)).toContainText("Step two");

  await page.locator(".checklist-item", { hasText: "Step one" }).locator(".checklist-checkbox").check();
  await expect(page.locator(".checklist-progress")).toHaveText("1/2");

  // Checklist persists via Save — the badge then reflects it.
  await saveCard(page);
  await expect(page.locator(".checklist-badge")).toHaveText("1/2");

  // Persists across reload.
  await page.reload();
  await expect(page.locator(".checklist-badge")).toHaveText("1/2");
});

test("closing without saving discards checklist edits", async ({ page, request }) => {
  const { board } = await seedCard(request, "Discard Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await addItems(page, ["throwaway"]);

  // Closing with unsaved checklist edits prompts the unsaved guard; discard.
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
  await page.locator(".unsaved-dialog .btn", { hasText: "Discard" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  // No badge — the item was never persisted.
  await expect(page.locator(".checklist-badge")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".checklist-badge")).toHaveCount(0);
});

test("check all and uncheck all", async ({ page, request }) => {
  const { board } = await seedCard(request, "CheckAll Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await addItems(page, ["a", "b", "c"]);
  await expect(page.locator(".checklist-progress")).toHaveText("0/3");

  await page.locator(".checklist-toggle-all", { hasText: "Check all" }).click();
  await expect(page.locator(".checklist-progress")).toHaveText("3/3");
  for (const cb of await page.locator(".checklist-checkbox").all()) {
    await expect(cb).toBeChecked();
  }

  await saveCard(page);
  const badge = page.locator(".checklist-badge");
  await expect(badge).toHaveText("3/3");
  await expect(badge).toHaveClass(/checklist-badge--complete/);

  await page.locator(".card", { hasText: "Task card" }).click();
  await page.locator(".checklist-toggle-all", { hasText: "Uncheck all" }).click();
  await expect(page.locator(".checklist-progress")).toHaveText("0/3");
  await saveCard(page);
  await expect(badge).toHaveText("0/3");
});

test("keyboard-only: add, toggle, navigate, delete checklist items", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Keyboard Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Leave the title input, then Ctrl+C focuses the checklist add input.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Control+c");
  await expect(page.locator(".checklist-add-input")).toBeFocused();

  await page.keyboard.type("kb one");
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await page.keyboard.type("kb two");
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(2);

  // Shift+Tab from the add input lands on the last item; Space toggles it.
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".checklist-item", { hasText: "kb two" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".checklist-progress")).toHaveText("1/2");

  // ArrowUp to the first item, toggle it too.
  await expect(page.locator(".checklist-item", { hasText: "kb two" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".checklist-item", { hasText: "kb one" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".checklist-progress")).toHaveText("2/2");
  await expect(page.locator(".checklist-item", { hasText: "kb one" })).toBeFocused();

  // Delete asks for inline confirmation; Enter on the focused Yes button
  // confirms, then focus moves to the remaining neighbor.
  await page.keyboard.press("Delete");
  await expect(page.locator(".checklist-confirm-text")).toHaveText("Delete?");
  await expect(page.locator(".checklist-confirm .btn-danger")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await expect(page.locator(".checklist-item", { hasText: "kb two" })).toBeFocused();
  await expect(page.locator(".checklist-progress")).toHaveText("1/1");

  // Save via Ctrl+S, then verify the badge shows the complete state.
  await page.keyboard.press("Control+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  const badge = page.locator(".checklist-badge");
  await expect(badge).toHaveText("1/1");
  await expect(badge).toHaveClass(/checklist-badge--complete/);
});

test("delete confirmation can be cancelled via Escape and No", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Confirm Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await addItems(page, ["keep me", "other"]);

  const first = page.locator(".checklist-item", { hasText: "keep me" });

  // Escape cancels and refocuses the item.
  await first.focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".checklist-confirm-text")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".checklist-confirm-text")).toHaveCount(0);
  await expect(page.locator(".checklist-item")).toHaveCount(2);
  await expect(first).toBeFocused();
  // Modal stayed open (Escape was consumed by the confirmation).
  await expect(page.locator(".modal-overlay")).toHaveCount(1);

  // The × button also asks first; No cancels.
  await first.hover();
  await first.locator(".checklist-delete").click();
  await expect(page.locator(".checklist-confirm-text")).toBeVisible();
  await page.locator(".checklist-confirm .btn-cancel").click();
  await expect(page.locator(".checklist-item")).toHaveCount(2);

  // Yes deletes.
  await first.hover();
  await first.locator(".checklist-delete").click();
  await page.locator(".checklist-confirm .btn-danger").click();
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await expect(page.locator(".checklist-item", { hasText: "other" })).toBeVisible();
});

test("reorder items with Shift+Arrow keys, persists across reload", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Reorder KB Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await addItems(page, ["a", "b", "c"]);

  const items = page.locator(".checklist-item");
  await items.nth(0).focus();

  // a down twice: a,b,c → b,a,c → b,c,a — focus follows the moved item.
  await page.keyboard.press("Shift+ArrowDown");
  await expect(items.nth(1)).toContainText("a");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(items.nth(2)).toContainText("a");
  await expect(items.nth(2)).toBeFocused();

  // At the bottom edge, Shift+ArrowDown is a no-op.
  await page.keyboard.press("Shift+ArrowDown");
  await expect(items.nth(2)).toContainText("a");

  // Move it back up one: b,c,a → b,a,c.
  await page.keyboard.press("Shift+ArrowUp");
  await expect(items.nth(1)).toContainText("a");
  await expect(items.nth(0)).toContainText("b");
  await expect(items.nth(2)).toContainText("c");

  await saveCard(page);
  await expectPersistedOrder(request, board.id, ["b", "a", "c"]);
  await page.reload();
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(items.nth(0)).toContainText("b");
  await expect(items.nth(1)).toContainText("a");
  await expect(items.nth(2)).toContainText("c");
});

test("reorder items via drag and drop", async ({ page, request }) => {
  const { board } = await seedCard(request, "Reorder DnD Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await addItems(page, ["a", "b", "c"]);

  const items = page.locator(".checklist-item");
  // Drag "a" onto the top half of "c" → insert before c: b, a, c.
  // Manual mouse events: locator.dragTo() doesn't trigger Chromium's
  // intercepted HTML5 drag here, and the modal can autoscroll during the
  // drag, so aim at the top edge of the target row.
  const src = (await items.nth(0).boundingBox())!;
  const tgt = (await items.nth(2).boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + 4, { steps: 10 });
  // Autoscroll/render lag can leave the cached coordinates stale, turning the
  // drop into a silent no-op — re-aim at the target's fresh position until
  // the insertion indicator confirms the drop slot, only then release.
  await expect(async () => {
    const fresh = (await items.nth(2).boundingBox())!;
    await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + 4, { steps: 2 });
    await expect(items.nth(2)).toHaveClass(/checklist-item--drop-before/, { timeout: 500 });
  }).toPass();
  await page.mouse.up();
  await expect(items.nth(0)).toContainText("b");
  await expect(items.nth(1)).toContainText("a");
  await expect(items.nth(2)).toContainText("c");

  await saveCard(page);
  await expectPersistedOrder(request, board.id, ["b", "a", "c"]);
  await page.reload();
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(items.nth(0)).toContainText("b");
  await expect(items.nth(1)).toContainText("a");
  await expect(items.nth(2)).toContainText("c");
});
