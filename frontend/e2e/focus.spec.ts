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

// A real 1x1 PNG so server-side thumbnail generation succeeds.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

async function attachPng(request: APIRequestContext, cardId: string, filename: string) {
  await request.post(`/api/cards/${cardId}/attachments?filename=${filename}`, {
    data: PIXEL_PNG,
    headers: { "content-type": "image/png" },
  });
}

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

// Regression: a fast keypress can arrive before a dialog's rAF-deferred
// auto-focus, while focus is still on the element *behind* the overlay — the
// dialog's keys must work anyway (dialogKeys document-capture ownership).
// Freezing rAF holds the dialog in that pre-focus state deterministically.
test("unsaved dialog owns Escape before its auto-focus lands", async ({ page, request }) => {
  const { board } = await seedCard(request, "Unsaved Race Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  const titleInput = page.locator(".modal-title-input");
  await titleInput.fill("Dirty title");

  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
  // Auto-focus suppressed: focus is still on the input behind the dialog.
  await expect(titleInput).toBeFocused();

  // Escape must still cancel the dialog (and not leak to the modal behind).
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(1);

  // Guard intact.
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
});

test("confirm dialog owns Escape before its auto-focus lands", async ({ page, request }) => {
  const { board } = await seedCard(request, "Confirm Race Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).focus();
  await expect(page.locator(".card", { hasText: "Task card" })).toBeFocused();

  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

  await page.keyboard.press("Delete");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
  // Escape must cancel the confirmation even though focus never entered it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
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

test("immediate reopen after save shows checklist items persisted via Save", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Checklist Reopen Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  await page.locator(".checklist-add-input").fill("step one");
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(1);

  // Checklist persists as card content via Save. Save (closes) and reopen at
  // once — the refetch must settle before unmount so the reopen isn't stale.
  await page.keyboard.press("Control+s");
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

// Regression: the link dialog portals to <body>, outside the card modal's
// focus trap. Previously the trap reclaimed focus the instant the dialog's
// input focused, so the dialog was unusable. The overlay-layer stack now lets
// the trap yield to overlays stacked above it (even portaled ones).
test("link dialog keeps focus when opened over the card modal", async ({ page, request }) => {
  const { board } = await seedCard(request, "Link Board");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  // Type text and select it so the link menu item is enabled.
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("example");
  await page.keyboard.press("ControlOrMeta+a");

  await page.locator('[title="Add or remove link"]').click();

  const input = page.locator(".link-dialog-input");
  await expect(input).toBeVisible();

  // The trap must NOT have pulled focus back into the modal title input.
  await expect(input).toBeFocused();

  // Focus stays put long enough to actually type a URL.
  await input.fill("https://example.com");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("https://example.com");

  // Applying the link closes the dialog and marks the selection.
  await page.locator(".link-dialog .btn-primary", { hasText: "Apply" }).click();
  await expect(page.locator(".link-dialog-overlay")).toHaveCount(0);
  await expect(page.locator('.ProseMirror a[href="https://example.com"]')).toBeVisible();
});

// ImagePreviewOverlay is nested inside the card modal. Escape must close the
// preview only (not the modal), and focus must stay inside the modal — the
// preview's focus trap composes with the modal's via DOM containment.
test("image preview overlay: Escape closes preview only, focus stays in modal", async ({
  page,
  request,
}) => {
  const { board, card } = await seedCard(request, "Preview Board");
  await attachPng(request, card.id, "pixel.png");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".attachment-item--image")).toBeVisible();

  // Open the preview.
  await page.locator(".attachment-thumb").click();
  await expect(page.locator(".image-preview-overlay")).toBeVisible();

  // Escape closes the preview but leaves the card modal open.
  await page.keyboard.press("Escape");
  await expect(page.locator(".image-preview-overlay")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(1);
  await expect.poll(() => focusInsideModal(page)).toBe(true);

  // A second Escape now closes the modal itself (no unsaved changes).
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
});

// ShortcutHelp opens as a Board-level sibling of the card modal. Its Escape
// must close only the help overlay (dialogKeys owns it on top of the stack),
// leaving the modal open with focus still inside it.
test("shortcut help over card modal: Escape closes help only, modal survives", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Help Over Modal");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  // Move focus off the auto-focused title input onto a modal button so the
  // single-letter `?` shortcut fires (it's suppressed while typing).
  await page.locator(".modal-close").focus();
  await page.keyboard.press("?");

  await expect(page.locator(".shortcut-help-overlay")).toBeVisible();
  await expect(page.locator(".modal-overlay")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator(".shortcut-help-overlay")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(1);
  await expect.poll(() => focusInsideModal(page)).toBe(true);
});

// ConfirmDialog (archive-card flow) auto-focuses its Confirm button so Enter
// confirms and Escape cancels — both owned via dialogKeys even before the
// rAF-deferred auto-focus lands.
test("archive confirm dialog auto-focuses confirm; Escape cancels, Enter archives", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Confirm Board");
  await page.goto(`/board/${board.id}`);

  const card = page.locator(".card", { hasText: "Task card" });
  await card.focus();
  await page.keyboard.press("Delete");

  const dialog = page.locator(".unsaved-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".btn-primary", { hasText: "Archive" })).toBeFocused();

  // Escape cancels — card stays.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeVisible();

  // Re-open and confirm with Enter — card is archived (removed from the list).
  await card.focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".unsaved-dialog")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".card", { hasText: "Task card" })).toHaveCount(0);
});
