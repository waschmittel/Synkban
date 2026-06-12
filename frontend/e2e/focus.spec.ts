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

const focusInsideModal = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector(".modal-overlay")?.contains(document.activeElement) === true &&
      document.activeElement !== document.body
  );

test("unsaved dialog: cancel via Escape keeps modal keyboard alive and guard intact", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Guard Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  const titleInput = page.locator(".modal-title-input");
  await titleInput.fill("Dirty title");

  // Escape opens the unsaved-changes dialog.
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();

  // Escape again cancels the dialog — modal must stay open and focus must
  // return into the modal (previously it fell to <body>).
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(1);
  await expect(titleInput).toBeFocused();

  // Guard is still intact: the next Escape must show the dialog again, NOT
  // close the dirty modal.
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
  await expect(page.locator(".modal-overlay")).toHaveCount(1);

  // Discard closes without saving.
  await page.locator(".unsaved-dialog .btn-danger", { hasText: "Discard" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.locator(".card", { hasText: "Task card" })).toBeVisible();
});

test("modal shortcuts still work after dialog round-trip", async ({ page, request }) => {
  const { board } = await seedCard(request, "Shortcut Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await page.locator(".modal-title-input").fill("Dirty title");
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);

  // Focus restored to the title input — leave it, then use a modal shortcut.
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("c");
  await expect(page.locator(".checklist-add-input")).toBeFocused();
});

test("Ctrl+S saves; Ctrl+Enter neither saves nor closes", async ({ page, request }) => {
  const { board } = await seedCard(request, "Save Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await page.locator(".ProseMirror").click();
  await page.keyboard.type("hello description");

  // Ctrl+Enter must not save/close anymore (ProseMirror would insert a hard
  // break right before the save, corrupting the description).
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".modal-overlay")).toHaveCount(1);

  await page.keyboard.press("Control+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  // Persisted.
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("hello description");
});

test("Ctrl+S saves without adding a line break to the description", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "NoBreak Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await page.locator(".ProseMirror").click();
  await page.keyboard.type("single line");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("single line");
  await expect(page.locator(".ProseMirror br")).toHaveCount(0);
  await expect(page.locator(".ProseMirror p")).toHaveCount(1);
});

// Regression: the modal must only unmount after the board refetch resolves.
// Previously the modal closed first with the refetch still in flight, so an
// immediate re-open snapshotted the stale (empty) card from board().
test("immediate reopen after Ctrl+S shows the saved description", async ({ page, request }) => {
  const { board } = await seedCard(request, "Reopen Board");
  await page.goto(`/board/${board.id}`);

  for (let i = 1; i <= 3; i++) {
    await page.locator(".card", { hasText: "Task card" }).click();
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.type(`description v${i}`);
    await page.keyboard.press("Control+s");
    await expect(page.locator(".modal-overlay")).toHaveCount(0);

    // Reopen immediately — no waiting for any refetch to settle.
    await page.locator(".card", { hasText: "Task card" }).click();
    await expect(page.locator(".ProseMirror")).toContainText(`description v${i}`);
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal-overlay")).toHaveCount(0);
  }
});

test("immediate reopen after close shows checklist items saved inside the modal", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Checklist Reopen Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await page.locator(".checklist-add-input").fill("step one");
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(1);

  // Close (checklist saves immediately, not via Save) and reopen at once.
  await page.locator(".modal-footer .btn-cancel").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".checklist-item", { hasText: "step one" })).toHaveCount(1);
});

test("focus is pulled back into the modal when it escapes", async ({ page, request }) => {
  const { board } = await seedCard(request, "Trap Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Programmatically blur — focus falls to <body>; the trap must pull it back.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect.poll(() => focusInsideModal(page)).toBe(true);

  // Keyboard still owned by the modal: Escape closes it (clean, no dirty state).
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
});

test("Tab wraps inside the card detail modal", async ({ page, request }) => {
  const { board } = await seedCard(request, "Tab Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Shift+Tab from the first focusable wraps to the last (footer Cancel).
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".modal-footer .btn-cancel")).toBeFocused();

  // Tab from the last focusable wraps back to the first.
  await page.keyboard.press("Tab");
  await expect(page.locator(".modal-title-input")).toBeFocused();
});

test("archive modal keeps keyboard after inline delete-confirm cancel", async ({
  page,
  request,
}) => {
  const { board, card } = await seedCard(request, "Archive Focus Board");
  await request.put(`/api/cards/${card.id}`, { data: { archived: true } });

  await page.goto(`/board/${board.id}`);
  await page.keyboard.press("a");
  const item = page.locator(".archive-card-item", { hasText: "Task card" });
  await expect(item).toBeVisible();

  // Open the inline delete confirmation, then cancel it — the focused "No"
  // button disappears; focus must stay inside the archive modal.
  await item.locator(".btn-danger", { hasText: "Delete" }).click();
  await item.locator(".btn-cancel", { hasText: "No" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".archive-modal-overlay")?.contains(document.activeElement) ===
            true && document.activeElement !== document.body
      )
    )
    .toBe(true);

  // Escape still closes the modal.
  await page.keyboard.press("Escape");
  await expect(page.locator(".archive-modal-overlay")).toHaveCount(0);
});
