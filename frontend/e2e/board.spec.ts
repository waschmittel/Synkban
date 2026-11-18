import { test, expect, type Page } from "@playwright/test";

// Board ids in the bottom dock's render order. The dock is a snapshot taken at
// page-mount and is the exact list `cycleBoard` navigates, so reading it makes
// the cycling assertions deterministic even though other test files create
// boards against the shared backend. Only re-read after a full page.goto()
// (which remounts and refreshes the snapshot), not after keyboard cycling.
const dockBoardIds = (page: Page): Promise<string[]> =>
  page
    .locator(".board-dock-dot")
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-board-id")).filter((id): id is string => !!id)
    );

test("unknown board shows not-found state instead of stuck loading", async ({ page }) => {
  await page.goto("/board/does-not-exist");

  await expect(page.locator(".board-error h2")).toHaveText("Board not found");
  await expect(page.locator(".loading")).toHaveCount(0);

  await page.locator(".board-error-home").click();
  await expect(page).toHaveURL(/\/$/);
});

test("valid board loads lists and cards", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "E2E Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Test card" } });

  await page.goto(`/board/${board.id}`);

  await expect(page.getByText("Todo")).toBeVisible();
  await expect(page.locator(".card", { hasText: "Test card" })).toBeVisible();
  await expect(page.locator(".board-error")).toHaveCount(0);
});

test("arrow navigation stops at empty list between non-empty lists", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Nav Board" } })
  ).json();
  const listA = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "A" } })
  ).json();
  const listB = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "B empty" } })
  ).json();
  const listC = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "C" } })
  ).json();
  await request.post(`/api/lists/${listA.id}/cards`, { data: { title: "Card A" } });
  await request.post(`/api/lists/${listC.id}/cards`, { data: { title: "Card C" } });

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".card", { hasText: "Card A" })).toBeVisible();

  // Focus card in list A, navigate right → must land on empty list B's
  // add-trigger, not skip ahead to list C.
  await page.locator(".card", { hasText: "Card A" }).focus();
  await page.keyboard.press("ArrowRight");

  const listBLocator = page.locator(`.list[data-list-id="${listB.id}"]`);
  await expect(listBLocator.locator(".add-trigger")).toBeFocused();

  // And navigating left from list C's card must also stop at list B.
  await page.locator(".card", { hasText: "Card C" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(listBLocator.locator(".add-trigger")).toBeFocused();
});

test("ArrowRight/ArrowLeft remembers vertical row across shorter and empty lists", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Sticky Row" } })
  ).json();
  const listA = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "A" } })
  ).json();
  const listB = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "B short" } })
  ).json();
  const listC = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "C empty" } })
  ).json();
  const listD = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "D" } })
  ).json();

  for (let i = 0; i < 5; i++) {
    await request.post(`/api/lists/${listA.id}/cards`, { data: { title: `A${i}` } });
    await request.post(`/api/lists/${listD.id}/cards`, { data: { title: `D${i}` } });
  }
  await request.post(`/api/lists/${listB.id}/cards`, { data: { title: "B0" } });
  await request.post(`/api/lists/${listB.id}/cards`, { data: { title: "B1" } });

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".card", { hasText: "A3" })).toBeVisible();

  // Start at row 3 in A -> clamp to row 1 in B -> stay on empty C -> restore row 3 in D.
  await page.locator(".card", { hasText: "A3" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".card", { hasText: "B1" })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator(`.list[data-list-id="${listC.id}"] .add-trigger`),
  ).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".card", { hasText: "D3" })).toBeFocused();

  // Navigating back left also restores row 3 in A, and ArrowUp resets the target row.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".card", { hasText: "B1" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".card", { hasText: "B0" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".card", { hasText: "A0" })).toBeFocused();
});

test("create board from home page and open it", async ({ page }) => {
  await page.goto("/");

  await page.locator(".add-board, .empty-state .btn-primary").first().click();
  await page.locator(".add-board-form input").fill("Created via UI");
  await page.locator(".add-board-form input").press("Enter");

  const boardCard = page.locator(".board-card", { hasText: "Created via UI" });
  await expect(boardCard).toBeVisible();

  await boardCard.click();
  await expect(page).toHaveURL(/\/board\/.+/);
  await expect(page.locator(".app-header")).toContainText("Created via UI");
});

test("add list and card through the UI, persists after reload", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "UI Build Board" } })
  ).json();

  await page.goto(`/board/${board.id}`);

  await page.locator(".add-list-wrapper .add-trigger").click();
  await page.locator(".add-list-wrapper .add-form input").fill("Backlog");
  await page.locator(".add-list-wrapper .add-form input").press("Enter");
  const list = page.locator(".list", { hasText: "Backlog" });
  await expect(list).toBeVisible();

  await list.locator(".add-trigger").click();
  await list.locator(".add-form input").fill("First task");
  await list.locator(".add-form input").press("Enter");
  await expect(list.locator(".card", { hasText: "First task" })).toBeVisible();

  await page.reload();
  await expect(
    page.locator(".list", { hasText: "Backlog" }).locator(".card", { hasText: "First task" }),
  ).toBeVisible();
});

test("add-card draft survives cancel, clears after create, is per-list", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Draft Board" } })
  ).json();
  const listA = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "A" } })
  ).json();
  await request.post(`/api/boards/${board.id}/lists`, { data: { title: "B" } });

  await page.goto(`/board/${board.id}`);
  const la = page.locator(`.list[data-list-id="${listA.id}"]`);
  const lb = page.locator(".list", { hasText: "B" });

  // Type a draft in list A and cancel via Escape.
  await la.locator(".add-trigger").click();
  await la.locator(".add-form input").fill("Half typed");
  await la.locator(".add-form input").press("Escape");
  await expect(la.locator(".add-form")).toHaveCount(0);

  // Reopening list A restores the draft.
  await la.locator(".add-trigger").click();
  await expect(la.locator(".add-form input")).toHaveValue("Half typed");

  // List B is unaffected (per-list draft, not global).
  await lb.locator(".add-trigger").click();
  await expect(lb.locator(".add-form input")).toHaveValue("");
  await lb.locator(".add-form input").press("Escape");

  // Opening B closed A's form but kept its draft; creating the card from A
  // clears it.
  await expect(la.locator(".add-form")).toHaveCount(0);
  await la.locator(".add-trigger").click();
  await expect(la.locator(".add-form input")).toHaveValue("Half typed");
  await la.locator(".add-form input").press("Enter");
  await expect(la.locator(".card", { hasText: "Half typed" })).toBeVisible();
  await la.locator(".add-trigger").click();
  await expect(la.locator(".add-form input")).toHaveValue("");
});

test("edit card title in detail modal and save", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Edit Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Old title" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Old title" }).click();

  const titleInput = page.locator(".modal-title-input");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("New title");
  await page.locator(".modal-footer .btn-primary", { hasText: "Save" }).click();

  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.locator(".card", { hasText: "New title" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".card", { hasText: "New title" })).toBeVisible();
});

test("dirtiness reflects serialized state: reverting an edit clears it", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Dirty Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Original" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Original" }).click();

  const titleInput = page.locator(".modal-title-input");
  await expect(titleInput).toBeVisible();
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Editing marks dirty.
  await titleInput.fill("Changed");
  await expect(page.locator(".unsaved-indicator")).toBeVisible();

  // Reverting back to the persisted value clears dirty (no boolean flag).
  await titleInput.fill("Original");
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Closing now skips the unsaved-changes guard entirely.
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
});

test("archive card via keyboard and restore it from archive modal", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Archive Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Doomed card" } });

  await page.goto(`/board/${board.id}`);
  const card = page.locator(".card", { hasText: "Doomed card" });
  await card.focus();
  await page.keyboard.press("Delete");

  // Confirmation dialog before archiving.
  await page.locator(".unsaved-dialog .btn-primary", { hasText: "Archive" }).click();
  await expect(card).toHaveCount(0);

  // Open archive modal, restore the card.
  await page.keyboard.press("a");
  const item = page.locator(".archive-card-item", { hasText: "Doomed card" });
  await expect(item).toBeVisible();
  await item.locator(".btn", { hasText: "Restore" }).click();
  await page.keyboard.press("Escape");

  await expect(page.locator(".card", { hasText: "Doomed card" })).toBeVisible();
});

test("text filter hides non-matching cards", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Filter Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Buy milk" } });
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Walk dog" } });

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".card")).toHaveCount(2);

  await page.keyboard.press("f");
  await page.locator(".filter-text-input").fill("milk");

  await expect(page.locator(".card", { hasText: "Buy milk" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Walk dog" })).toHaveCount(0);

  // Clearing the filter brings everything back.
  await page.locator(".filter-input-clear").click();
  await expect(page.locator(".card")).toHaveCount(2);
});

test("Shift+ArrowRight moves card to adjacent list and persists", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Move Board" } })
  ).json();
  const listA = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "A" } })
  ).json();
  const listB = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "B" } })
  ).json();
  await request.post(`/api/lists/${listA.id}/cards`, { data: { title: "Mover" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Mover" }).focus();
  await page.keyboard.press("Shift+ArrowRight");

  const inListB = page
    .locator(`.list[data-list-id="${listB.id}"]`)
    .locator(".card", { hasText: "Mover" });
  await expect(inListB).toBeVisible();

  await page.reload();
  await expect(inListB).toBeVisible();
});

test("Home and End focus the first and last card in the list", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "HomeEnd Nav" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const alpha = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Alpha" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Bravo" } });
  const charlie = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Charlie" } })
  ).json();

  await page.goto(`/board/${board.id}`);
  const bravo = page.locator(".card", { hasText: "Bravo" });
  await bravo.focus();
  await expect(bravo).toBeFocused();

  // Home jumps to the top card, End to the bottom card — both within the list.
  await page.keyboard.press("Home");
  await expect(page.locator(`.card[data-card-id="${alpha.id}"]`)).toBeFocused();

  await page.keyboard.press("End");
  await expect(page.locator(`.card[data-card-id="${charlie.id}"]`)).toBeFocused();

  // PageUp/PageDown are aliases for the same jumps.
  await page.keyboard.press("PageUp");
  await expect(page.locator(`.card[data-card-id="${alpha.id}"]`)).toBeFocused();

  await page.keyboard.press("PageDown");
  await expect(page.locator(`.card[data-card-id="${charlie.id}"]`)).toBeFocused();
});

test("Shift+Home and Shift+End move a card to the top/bottom of its list", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "HomeEnd Move" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Alpha" } });
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Bravo" } });
  const charlie = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Charlie" } })
  ).json();

  const titles = () =>
    page.locator(`.list[data-list-id="${list.id}"] .card-title`).allTextContents();

  await page.goto(`/board/${board.id}`);
  await expect.poll(titles).toEqual(["Alpha", "Bravo", "Charlie"]);

  const charlieCard = page.locator(`.card[data-card-id="${charlie.id}"]`);
  await charlieCard.focus();

  // A move is a PUT plus a refetch that recreates the card nodes, so focus
  // comes back asynchronously. Wait for it before pressing again: a key that
  // lands while focus is still on <body> is delivered nowhere and the move is
  // silently lost (the order assertion alone doesn't imply focus is back yet).
  const move = async (key: string, expected: string[]) => {
    await expect(charlieCard).toBeFocused();
    await page.keyboard.press(key);
    await expect.poll(titles).toEqual(expected);
    await expect(charlieCard).toBeFocused();
  };

  // Shift+Home sends the bottom card (Charlie) to the top; focus follows it.
  await move("Shift+Home", ["Charlie", "Alpha", "Bravo"]);
  // No-op when already at the edge: Shift+Home on the top card changes nothing.
  await move("Shift+Home", ["Charlie", "Alpha", "Bravo"]);
  // Shift+End sends it back to the bottom.
  await move("Shift+End", ["Alpha", "Bravo", "Charlie"]);
  // Shift+PageUp/PageDown are aliases for the same moves.
  await move("Shift+PageUp", ["Charlie", "Alpha", "Bravo"]);
  await move("Shift+PageDown", ["Alpha", "Bravo", "Charlie"]);

  // Order persists across a reload (positions written to disk).
  await page.reload();
  await expect.poll(titles).toEqual(["Alpha", "Bravo", "Charlie"]);
});

test("create a new label inline in card detail and auto-assign it", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Label Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Labelled card" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Labelled card" }).click();
  await expect(page.locator(".modal-overlay")).toBeVisible();

  // The create form is hidden behind the "New label" chip until clicked.
  await expect(page.locator(".label-create")).toHaveCount(0);
  await page.locator(".label-new-chip").click();
  await page.locator(".label-create-input").fill("Urgent");
  await page.locator(".label-create-btn").click();

  // New label is auto-assigned (selected toggle), the inline create form is
  // gone, and focus returns to the "New label" chip.
  await expect(page.locator(".label-toggle--selected", { hasText: "Urgent" })).toBeVisible();
  await expect(page.locator(".label-create")).toHaveCount(0);
  await expect(page.locator(".label-new-chip")).toBeFocused();

  // Save and confirm the label persists on the card in the list view.
  await page.locator(".modal-footer .btn-primary", { hasText: "Save" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.locator(".card-label-chip", { hasText: "Urgent" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".card-label-chip", { hasText: "Urgent" })).toBeVisible();
});

test("inline label create form closes when focus leaves the label row", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Blur Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Blur card" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Blur card" }).click();

  await page.locator(".label-new-chip").click();
  await expect(page.locator(".label-create")).toBeVisible();

  // Moving focus out of the label row (to the title input) collapses the form.
  await page.locator(".modal-title-input").focus();
  await expect(page.locator(".label-create")).toHaveCount(0);
});

test("inline create form collapses to the chip when focus moves to a label toggle", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Collapse Board" } })
  ).json();
  await request.post(`/api/boards/${board.id}/labels`, { data: { name: "Existing" } });
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Collapse card" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Collapse card" }).click();

  await page.locator(".label-new-chip").click();
  await expect(page.locator(".label-create")).toBeVisible();

  // Click a label toggle: the form collapses back to the chip and the click
  // still toggles the label.
  await page.locator(".label-toggle", { hasText: "Existing" }).click();
  await expect(page.locator(".label-create")).toHaveCount(0);
  await expect(page.locator(".label-new-chip")).toBeVisible();
  await expect(page.locator(".label-toggle--selected", { hasText: "Existing" })).toBeVisible();
});

test("card-detail accelerator shortcuts focus each section", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Shortcut Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Shortcut card" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Shortcut card" }).click();
  // The title is focused a frame after mount; a shortcut pressed before that
  // targets <body>, never reaches the modal's key handler, and the late focus
  // then lands on the title instead. Wait for it (flaky on slow CI otherwise).
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Accel+D → description editor.
  await page.keyboard.press("ControlOrMeta+d");
  await expect(page.locator(".editor-wrapper .ProseMirror")).toBeFocused();

  // Accel+E → back to title.
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Accel+L → opens the collapsed checklist at its add input (L = list; C would steal copy).
  await expect(page.locator(".checklist-add-input")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+l");
  await expect(page.locator(".checklist-add-input")).toBeFocused();

  // Accel+U → the due-date picker, on its text field.
  await page.keyboard.press("ControlOrMeta+u");
  await expect(page.locator(".due-picker-input")).toBeFocused();

  // Accel+G from inside the picker closes it and focuses the label row
  // (no board labels here → "New label" chip).
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.locator(".due-picker")).toHaveCount(0);
  await expect(page.locator(".label-new-chip")).toBeFocused();
  // Leaving the empty checklist collapses it again.
  await expect(page.locator(".checklist-add-input")).toHaveCount(0);
  await expect(page.locator(".detail-add-checklist")).toBeVisible();
});

// Regression: the checklist shortcut used to be Ctrl/Cmd+C and fired even
// while typing, so every copy made inside the modal was preventDefault()ed
// and silently produced an empty clipboard. No modal shortcut may claim a
// text-editing key. Asserted on the keydown's defaultPrevented (deterministic,
// unlike reading the real clipboard) with both modifiers, since Ctrl is the
// accelerator off macOS and a text-editing modifier on it.
test("card-detail leaves Ctrl+C and Cmd+C to the browser", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Copy Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Copy card" } });

  await page.addInitScript(() => {
    (window as any).__cPrevented = [];
    // window sees the event after SolidJS's document-delegated handler.
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "c") (window as any).__cPrevented.push(e.defaultPrevented);
    });
  });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Copy card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();

  await page.keyboard.press("Control+c");
  await page.keyboard.press("Meta+c");

  await expect(page.locator(".modal-title-input")).toBeFocused();
  await expect(page.locator(".checklist-add-input")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__cPrevented)).toEqual([false, false]);
});

test("card-detail Ctrl/Cmd+O opens the attachment file picker", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Attach Shortcut Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Attach card" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Attach card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Accel+O triggers the hidden file input's click → a native file chooser.
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+o");
  const chooser = await fileChooserPromise;
  expect(chooser).toBeTruthy();
});

test("due date: Accel+U opens the picker; typed and calendar entry, all by keyboard", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Due Shortcut Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Due card" } })
  ).json();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return iso(d);
  };

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Due card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  const chip = page.locator(".due-chip");
  await expect(chip).toHaveText("Set due date");

  // Typed: an offset, Enter sets it and returns to the chip.
  await page.keyboard.press("ControlOrMeta+u");
  const input = page.locator(".due-picker-input");
  await expect(input).toBeFocused();
  await input.fill("+3d");
  await page.keyboard.press("Enter");
  await expect(page.locator(".due-picker")).toHaveCount(0);
  await expect(chip).toBeFocused();
  await expect(chip).toHaveText(/ · in 3 days$/);
  await expect(chip).toHaveClass(/due-chip--future/);

  // Nonsense is refused in place.
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
  await input.fill("someday");
  await page.keyboard.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".due-picker")).toBeVisible();

  // Calendar: ↓ into the grid on the current date, → a day, PgDn a month.
  await input.fill("");
  await input.fill(inDays(3));
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`.due-picker-day[data-date="${inDays(3)}"]`)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(`.due-picker-day[data-date="${inDays(4)}"]`)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(`.due-picker-day[data-date="${inDays(-3)}"]`)).toBeFocused();
  await page.keyboard.press("PageDown");
  const next = await page.evaluate(() => document.activeElement?.getAttribute("data-date"));
  expect(next).not.toBe(inDays(-3));
  await page.keyboard.press("PageUp");
  await expect(page.locator(`.due-picker-day[data-date="${inDays(-3)}"]`)).toBeFocused();
  // Esc closes only the picker; the card stays open with the old date.
  await page.keyboard.press("Escape");
  await expect(page.locator(".due-picker")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(1);
  await expect(chip).toBeFocused();
  await expect(chip).toHaveText(/in 3 days/);

  // Enter on a day picks it: overdue within a week says how much.
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveText(/ · overdue 2 days$/);
  await expect(chip).toHaveClass(/due-chip--overdue/);

  // The clear button empties it; a pointer outside closes the picker.
  await page.locator(".due-date-clear").click();
  await expect(chip).toHaveText("Set due date");
  await chip.click();
  await expect(page.locator(".due-picker")).toBeVisible();
  await page.locator(".modal-title-input").click();
  await expect(page.locator(".due-picker")).toHaveCount(0);

  // Quick pick + save: stored as an ISO day, the card badge words it.
  await chip.click();
  await page.locator(".due-picker-quick", { hasText: "Tomorrow" }).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  const stored = await (await request.get(`/api/boards/${board.id}`)).json();
  expect(stored.lists[0].cards.find((c: { id: string }) => c.id === card.id).due_date).toBe(inDays(1));
  await expect(page.locator(".card .due-badge")).toHaveText("Tomorrow");
});

test("due badges: relative within a week, else the date", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Due Badges" } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const iso = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const cases: [number, RegExp, string][] = [
    [0, /^Today$/, "today"],
    [7, /^in 7d$/, "future"],
    [8, /^[A-Z][a-z]{2} \d+|^\d+ [A-Z][a-z]{2}/, "future"],
    [-7, /^Overdue 7d$/, "overdue"],
    [-8, /^Overdue · /, "overdue"],
  ];
  for (const [days] of cases) {
    const c = await (await request.post(`/api/lists/${list.id}/cards`, { data: { title: `Due ${days}` } })).json();
    await request.put(`/api/cards/${c.id}`, { data: { due_date: iso(days) } });
  }
  await page.goto(`/board/${board.id}`);
  for (const [days, text, tone] of cases) {
    const badge = page.locator(".card", { hasText: new RegExp(`^Due ${days}(?!\\d)`) }).locator(".due-badge");
    await expect(badge).toHaveText(text);
    await expect(badge).toHaveClass(new RegExp(`due-badge--${tone}`));
  }
});

test("clicking a link in the description opens it in a new tab", async ({
  page,
  context,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Link Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Link card" } })
  ).json();

  // Seed a description containing a link mark (the editor's serialized shape).
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
  await request.put(`/api/cards/${card.id}`, {
    data: { description: JSON.stringify(doc) },
  });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Link card" }).click();
  await expect(page.locator(".modal-overlay")).toBeVisible();

  const link = page.locator(".editor-wrapper .ProseMirror a", { hasText: "example link" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);

  // Clicking opens a new browser tab (window.open _blank) rather than
  // navigating the editor or placing the cursor.
  const popupPromise = context.waitForEvent("page");
  await link.click();
  const popup = await popupPromise;
  expect(popup.url()).toBe("https://example.com/");
  await popup.close();
});

test("Cmd/Ctrl+clicking a description link edits or removes it", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Link Edit Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Edit link card" } })
  ).json();
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
  await request.put(`/api/cards/${card.id}`, { data: { description: JSON.stringify(doc) } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Edit link card" }).click();
  await expect(page.locator(".modal-overlay")).toBeVisible();

  const link = page.locator(".editor-wrapper .ProseMirror a", { hasText: "example link" });

  // Cmd/Ctrl+click opens the edit dialog prefilled with the current URL (it
  // does NOT open a new tab).
  await link.click({ modifiers: ["ControlOrMeta"] });
  const urlInput = page.locator(".link-dialog-input");
  await expect(urlInput).toHaveValue("https://example.com/");

  // Editing the URL and applying rewrites the link's href in place.
  await urlInput.fill("https://changed.example.org/");
  await page.locator(".link-dialog .btn-primary").click();
  await expect(link).toHaveAttribute("href", "https://changed.example.org/");

  // Reopen and remove: the anchor is gone but its text survives.
  await link.click({ modifiers: ["ControlOrMeta"] });
  await page.locator(".link-dialog-remove").click();
  await expect(page.locator(".editor-wrapper .ProseMirror a")).toHaveCount(0);
  await expect(page.locator(".editor-wrapper .ProseMirror")).toContainText("example link");
});

test("board deleted while open shows not-found state after poll refetch", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Doomed Board" } })
  ).json();

  await page.goto(`/board/${board.id}`);
  await expect(page.getByText("Doomed Board").first()).toBeVisible();

  await request.put(`/api/boards/${board.id}`, { data: { archived: true } });
  await request.delete(`/api/boards/${board.id}`);

  // Poll interval is 15s; wait up to 25s for the refetch to surface the error.
  await expect(page.locator(".board-error h2")).toHaveText("Board not found", {
    timeout: 25_000,
  });
});

test("',' and '.' cycle through boards in dock order, wrapping at the ends", async ({
  page,
  request,
}) => {
  // Create three of our own so the dock is guaranteed to have >1 entry.
  const a = await (
    await request.post("/api/boards", { data: { title: `Cycle A ${Date.now()}` } })
  ).json();
  await request.post("/api/boards", { data: { title: `Cycle B ${Date.now()}` } });
  await request.post("/api/boards", { data: { title: `Cycle C ${Date.now()}` } });

  await page.goto(`/board/${a.id}`);
  await expect(page.locator(".board-dock")).toBeVisible();

  const ids = await dockBoardIds(page);
  const n = ids.length;
  expect(n).toBeGreaterThan(1);
  const start = ids.indexOf(a.id);
  expect(start).toBeGreaterThanOrEqual(0);

  const urlAt = (k: number) => new RegExp(`/board/${ids[((k % n) + n) % n]}$`);

  // Step '.' forward through every board; the last press wraps back to start.
  for (let s = 1; s <= n; s++) {
    await page.keyboard.press(".");
    await expect(page).toHaveURL(urlAt(start + s));
  }
  await expect(page).toHaveURL(urlAt(start));

  // ',' goes back one, wrapping to the last board when at the first.
  await page.keyboard.press(",");
  await expect(page).toHaveURL(urlAt(start - 1));
});

test("'j' and 'k' are aliases for ',' and '.' board cycling", async ({
  page,
  request,
}) => {
  const a = await (
    await request.post("/api/boards", { data: { title: `JK A ${Date.now()}` } })
  ).json();
  await request.post("/api/boards", { data: { title: `JK B ${Date.now()}` } });

  await page.goto(`/board/${a.id}`);
  await expect(page.locator(".board-dock")).toBeVisible();

  const ids = await dockBoardIds(page);
  const n = ids.length;
  const start = ids.indexOf(a.id);
  const urlAt = (k: number) => new RegExp(`/board/${ids[((k % n) + n) % n]}$`);

  await page.keyboard.press("k"); // next, like '.'
  await expect(page).toHaveURL(urlAt(start + 1));
  await page.keyboard.press("j"); // previous, like ','
  await expect(page).toHaveURL(urlAt(start));
});

test("dock dots highlight the active board, show its name, and navigate on click", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const titleA = `Dock A ${stamp}`;
  const titleB = `Dock B ${stamp}`;
  const a = await (await request.post("/api/boards", { data: { title: titleA } })).json();
  const b = await (await request.post("/api/boards", { data: { title: titleB } })).json();

  await page.goto(`/board/${a.id}`);
  await expect(page.locator(".board-dock")).toBeVisible();

  // Exactly one dot is highlighted, and it's the one for the open board.
  await expect(page.locator(".board-dock-dot--active")).toHaveCount(1);
  const dotA = page.locator(`.board-dock-dot[data-board-id="${a.id}"]`);
  await expect(dotA).toHaveClass(/board-dock-dot--active/);
  // Tooltip carries the board name.
  await expect(dotA).toHaveAttribute("title", `${titleA} (, / .)`);

  // Clicking another board's dot navigates there and moves the highlight.
  const dotB = page.locator(`.board-dock-dot[data-board-id="${b.id}"]`);
  await expect(dotB).toHaveAttribute("title", `${titleB} (, / .)`);
  await dotB.click();
  await expect(page).toHaveURL(new RegExp(`/board/${b.id}$`));
  await expect(dotB).toHaveClass(/board-dock-dot--active/);
});

// The dock is a fixed, centre-anchored pill. Before it was capped and made
// scrollable it simply kept growing, so past a few dozen boards it hung off
// both window edges and the dots at either end could not be seen or clicked.
// A narrow viewport reproduces that with whatever boards the run has.
test("dock stays within the window and reaches its end dots when boards overflow", async ({
  page,
  request,
}) => {
  const stamp = Date.now();
  const a = await (
    await request.post("/api/boards", { data: { title: `Overflow A ${stamp}` } })
  ).json();
  const b = await (
    await request.post("/api/boards", { data: { title: `Overflow B ${stamp}` } })
  ).json();

  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`/board/${a.id}`);

  const dock = page.locator(".board-dock");
  await expect(dock).toBeVisible();
  const box = (await dock.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);

  // The dot for the board you're on is scrolled back into the pill.
  await expect(page.locator(".board-dock-dot--active")).toBeInViewport();

  await page.locator(`.board-dock-dot[data-board-id="${b.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/board/${b.id}$`));
});

test("New-label input stays hidden until the New label chip is clicked, on every card", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Picker Default Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "First card" } });
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Second card" } });

  await page.goto(`/board/${board.id}`);

  // First card: the chip is there, the input is not.
  await page.locator(".card", { hasText: "First card" }).click();
  await expect(page.locator(".modal-overlay")).toBeVisible();
  await expect(page.locator(".label-new-chip")).toBeVisible();
  await expect(page.locator(".label-create")).toHaveCount(0);

  // Clicking the chip reveals the input.
  await page.locator(".label-new-chip").click();
  await expect(page.locator(".label-create")).toBeVisible();

  // Open a different card: the input must start hidden again.
  await page.keyboard.press("Escape"); // collapses the form only
  await expect(page.locator(".label-create")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Second card" }).click();
  await expect(page.locator(".modal-overlay")).toBeVisible();
  await expect(page.locator(".label-new-chip")).toBeVisible();
  await expect(page.locator(".label-create")).toHaveCount(0);
});

test("label row shows each board label once and toggles assignment both ways", async ({
  page,
  request,
}) => {
  const board = await (await request.post("/api/boards", { data: { title: "Toggle Board" } })).json();
  for (const name of ["Alpha", "Beta"]) {
    await request.post(`/api/boards/${board.id}/labels`, { data: { name } });
  }
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Toggle card" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Toggle card" }).click();

  const toggles = page.locator(".label-toggle");
  await expect(toggles).toHaveCount(2); // each label exactly once, board order
  await expect(toggles.locator(".label-toggle-name")).toHaveText(["Alpha", "Beta"]);

  await toggles.nth(1).click();
  await expect(toggles.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(toggles.nth(0)).toHaveAttribute("aria-pressed", "false");
  await toggles.nth(1).click();
  await expect(toggles.nth(1)).toHaveAttribute("aria-pressed", "false");

  // Accel+G focuses the first label toggle.
  await page.keyboard.press("ControlOrMeta+g");
  await expect(toggles.nth(0)).toBeFocused();
});

test("many labels: assigned first, capped with +N more, order frozen while interacting", async ({
  page,
  request,
}) => {
  const board = await (await request.post("/api/boards", { data: { title: "Many Labels" } })).json();
  const ids: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const l = await (
      await request.post(`/api/boards/${board.id}/labels`, { data: { name: `L${i}` } })
    ).json();
    ids.push(l.id);
  }
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const withLabels = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Has labels" } })
  ).json();
  await request.put(`/api/cards/${withLabels.id}`, {
    data: { label_ids: [ids[2], ids[6], ids[19]] },
  });
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "No labels" } });

  await page.goto(`/board/${board.id}`);
  const toggles = page.locator(".label-toggle");
  const names = toggles.locator(".label-toggle-name");

  // 3 assigned (L3, L7, L20) first, then 9 unassigned = 12 visible, 8 hidden.
  await page.locator(".card", { hasText: "Has labels" }).click();
  await expect(toggles).toHaveCount(12);
  await expect(names.nth(0)).toHaveText("L3");
  await expect(names.nth(1)).toHaveText("L7");
  await expect(names.nth(2)).toHaveText("L20");
  await expect(names.nth(3)).toHaveText("L1");
  await expect(page.locator(".label-more-chip")).toHaveText("+8 more");

  await page.locator(".label-more-chip").click();
  await expect(toggles).toHaveCount(20);
  await expect(page.locator(".label-more-chip")).toHaveText("Show fewer");
  await page.locator(".label-more-chip").click();
  await expect(toggles).toHaveCount(12);

  // Fresh card: first 12 in board order. Toggling L5 must not move it while
  // the pointer is over the row; it jumps to the front once pointer+focus leave.
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "No labels" }).click();
  await expect(toggles).toHaveCount(12);
  await toggles.nth(4).click();
  await expect(names.nth(4)).toHaveText("L5");
  await expect(toggles.nth(4)).toHaveAttribute("aria-pressed", "true");

  await page.mouse.move(0, 0);
  await page.locator(".modal-title-input").focus();
  await expect(names.nth(0)).toHaveText("L5");
  await expect(toggles.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(toggles).toHaveCount(12);
});

test("switching boards remembers active card and scroll positions", async ({ page, request }) => {
  const mk = async (title: string, lists: number, cards: number) => {
    const board = await (await request.post("/api/boards", { data: { title } })).json();
    for (let l = 0; l < lists; l++) {
      const list = await (
        await request.post(`/api/boards/${board.id}/lists`, { data: { title: `L${l}` } })
      ).json();
      for (let c = 0; c < cards; c++)
        await request.post(`/api/lists/${list.id}/cards`, { data: { title: `L${l} card ${c}` } });
    }
    return board;
  };
  const a = await mk("View A", 8, 30);
  const b = await mk("View B", 1, 2);

  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`/board/${a.id}`);
  const firstList = page.locator(".list").first();
  const cards = firstList.locator(".cards-container");
  await expect(firstList.locator(".card")).toHaveCount(30);

  const container = page.locator(".lists-container");
  await page.locator(".card", { hasText: /^L0 card 12$/ }).focus();
  // Scroll after focusing: focus() scrolls its card into view.
  await container.evaluate((el) => (el.scrollLeft = 300));
  await cards.evaluate((el) => (el.scrollTop = 200));

  await page.locator(`.board-dock-dot[data-board-id="${b.id}"]`).click();
  await expect(page.locator(".list")).toHaveCount(1);
  await expect(page.locator(".card")).toHaveCount(2);

  await page.locator(`.board-dock-dot[data-board-id="${a.id}"]`).click();
  await expect(page.locator(".list")).toHaveCount(8);
  await expect(page.locator(".card", { hasText: /^L0 card 12$/ })).toBeFocused();
  await expect.poll(() => container.evaluate((el) => el.scrollLeft)).toBe(300);
  await expect
    .poll(() => page.locator(".list").first().locator(".cards-container").evaluate((el) => el.scrollTop))
    .toBe(200);

  // Boards stay independent: B never had a focused card.
  await page.locator(`.board-dock-dot[data-board-id="${b.id}"]`).click();
  await expect(page.locator(".list")).toHaveCount(1);
  await expect(page.locator(".card:focus")).toHaveCount(0);
});

test("switching boards remembers each board's filter and drops deleted labels", async ({
  page,
  request,
}) => {
  const mk = async (title: string) => {
    const board = await (await request.post("/api/boards", { data: { title } })).json();
    const list = await (
      await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })
    ).json();
    for (const t of ["milk", "bread"])
      await request.post(`/api/lists/${list.id}/cards`, { data: { title: t } });
    return board;
  };
  const a = await mk("Filter A");
  const b = await mk("Filter B");
  const dot = (id: string) => page.locator(`.board-dock-dot[data-board-id="${id}"]`);

  await page.goto(`/board/${a.id}`);
  await page.locator(".board-filter-btn").click();
  await page.locator(".filter-text-input").fill("milk");
  await expect(page.locator(".card")).toHaveCount(1);

  // Unvisited board starts unfiltered (the filter must not leak across boards).
  await dot(b.id).click();
  await expect(page.locator(".card", { hasText: "bread" })).toBeVisible();
  await expect(page.locator(".filter-bar")).toHaveCount(0);

  // Back: filter bar open, text kept, list filtered, focus not stolen by the bar.
  await dot(a.id).click();
  await expect(page.locator(".filter-text-input")).toHaveValue("milk");
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".filter-text-input")).not.toBeFocused();

  // Closed-but-active filter stays active (bar closed) on return.
  await page.locator(".board-filter-btn").click();
  await expect(page.locator(".filter-bar")).toHaveCount(0);
  await dot(b.id).click();
  await expect(page.locator(".card")).toHaveCount(2);
  await dot(a.id).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(page.locator(".filter-bar")).toHaveCount(0);
});

test("remembered label filter ignores labels deleted meanwhile", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Lbl A" } })).json();
  const other = await (await request.post("/api/boards", { data: { title: "Lbl B" } })).json();
  const label = await (
    await request.post(`/api/boards/${board.id}/labels`, { data: { name: "Urgent" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "one" } });
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "two" } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".board-filter-btn").click();
  await page.locator(".filter-bar").getByText("Urgent").click();
  await expect(page.locator(".card")).toHaveCount(0);

  await page.locator(`.board-dock-dot[data-board-id="${other.id}"]`).click();
  await expect(page.locator(".filter-bar")).toHaveCount(0);
  await request.delete(`/api/labels/${label.id}`);

  await page.locator(`.board-dock-dot[data-board-id="${board.id}"]`).click();
  // Deleted label is dropped: nothing filters, nothing hides.
  await expect(page.locator(".card")).toHaveCount(2);
});

test("narrow screen: switching boards remembers snapped list, card and list scroll", async ({
  page,
  request,
}) => {
  const mk = async (title: string, lists: number) => {
    const board = await (await request.post("/api/boards", { data: { title } })).json();
    for (let l = 0; l < lists; l++) {
      const list = await (
        await request.post(`/api/boards/${board.id}/lists`, { data: { title: `N${l}` } })
      ).json();
      for (let c = 0; c < 25; c++)
        await request.post(`/api/lists/${list.id}/cards`, { data: { title: `N${l} card ${c}` } });
    }
    return board;
  };
  const a = await mk("Narrow A", 4);
  const b = await mk("Narrow B", 2);
  await page.setViewportSize({ width: 375, height: 667 });
  const dot = (id: string) => page.locator(`.board-dock-dot[data-board-id="${id}"]`);

  await page.goto(`/board/${a.id}`);
  await expect(page.locator(".list")).toHaveCount(4);
  const container = page.locator(".lists-container");
  const card = page.locator(".card", { hasText: /^N2 card 5$/ });
  await card.focus(); // snaps to the third list
  await expect.poll(() => container.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const x = await container.evaluate((el) => el.scrollLeft);
  const cards = page.locator(".list").nth(2).locator(".cards-container");
  await cards.evaluate((el) => (el.scrollTop = 150));
  await page.keyboard.press("Escape");
  await card.focus();

  await dot(b.id).click();
  await expect(page.locator(".list")).toHaveCount(2);
  await expect.poll(() => container.evaluate((el) => el.scrollLeft)).toBe(0);

  await dot(a.id).click();
  await expect(page.locator(".list")).toHaveCount(4);
  await expect(card).toBeFocused();
  await expect.poll(() => container.evaluate((el) => el.scrollLeft)).toBe(x);
  await expect
    .poll(() => page.locator(".list").nth(2).locator(".cards-container").evaluate((el) => el.scrollTop))
    .toBe(150);
});

test("board view survives a page reload (sessionStorage)", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Reload" } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })
  ).json();
  for (let c = 0; c < 30; c++)
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: `r${c}` } });
  await page.setViewportSize({ width: 800, height: 500 });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: /^r7$/ }).focus();
  await page.locator(".cards-container").evaluate((el) => (el.scrollTop = 120));
  await page.locator(".board-filter-btn").click();
  await page.locator(".filter-text-input").fill("r");

  await page.reload();
  await expect(page.locator(".filter-text-input")).toHaveValue("r");
  await expect(page.locator(".card", { hasText: /^r7$/ })).toBeFocused();
  await expect
    .poll(() => page.locator(".cards-container").evaluate((el) => el.scrollTop))
    .toBe(120);

  // A fresh tab (new sessionStorage) starts clean.
  const tab = await page.context().newPage();
  await tab.goto(`/board/${board.id}`);
  await expect(tab.locator(".card").first()).toBeVisible();
  await expect(tab.locator(".filter-bar")).toHaveCount(0);
});

test("closing the card dialog keeps every list's scroll position", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Close" } })).json();
  for (const t of ["A", "B"]) {
    const list = await (
      await request.post(`/api/boards/${board.id}/lists`, { data: { title: t } })
    ).json();
    for (let c = 0; c < 30; c++)
      await request.post(`/api/lists/${list.id}/cards`, { data: { title: `${t}${c}` } });
  }
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(`/board/${board.id}`);
  const scroller = (n: number) => page.locator(".list").nth(n).locator(".cards-container");
  await expect(page.locator(".card")).toHaveCount(60);

  await scroller(1).evaluate((el) => (el.scrollTop = 250));
  await scroller(0).evaluate((el) => (el.scrollTop = 120));
  await page.locator(".card", { hasText: /^A3$/ }).click({ force: true });
  await expect(page.locator(".modal-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  await expect.poll(() => scroller(1).evaluate((el) => el.scrollTop)).toBe(250);
  await expect.poll(() => scroller(0).evaluate((el) => el.scrollTop)).toBe(120);
});

test("Arrow Up/Down wrap between cards; Shift+Arrow wraps when moving a card", async ({
  page,
  request,
}) => {
  const board = await (await request.post("/api/boards", { data: { title: "Wrap" } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })
  ).json();
  const solo = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Solo" } })
  ).json();
  for (const t of ["one", "two", "three"])
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: t } });
  await request.post(`/api/lists/${solo.id}/cards`, { data: { title: "only" } });

  await page.goto(`/board/${board.id}`);
  const order = () => page.locator(".list").first().locator(".card").allInnerTexts();
  const card = (t: string) => page.locator(".card", { hasText: new RegExp(`^${t}$`) });

  // Focus moves: bottom → top, top → bottom.
  await card("three").focus();
  await page.keyboard.press("ArrowDown");
  await expect(card("one")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(card("three")).toBeFocused();

  // Move: bottom card down → top; then back up from the top → bottom.
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(order).toEqual(["three", "one", "two"]);
  await expect(card("three")).toBeFocused();
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(order).toEqual(["one", "two", "three"]);
  await expect(card("three")).toBeFocused();

  // Plain (non-wrapping) steps still work, and the order persists.
  await card("one").focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(order).toEqual(["two", "three", "one"]);
  await page.reload();
  await expect.poll(order).toEqual(["two", "three", "one"]);

  // A lone card has nowhere to wrap to.
  const only = card("only");
  await only.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(only).toBeFocused();
  await expect(page.locator(".list").nth(1).locator(".card")).toHaveCount(1);
});

test("list rename: Enter commits, Esc cancels (the unmount blur doesn't commit)", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Rename lists" } })).json();
  await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Before" } });
  const title = async () =>
    (await (await request.get(`/api/boards/${board.id}`)).json()).lists[0].title;
  await page.goto(`/board/${board.id}`);
  const input = page.locator(".list-title-input");

  await page.locator(".list-title").click();
  await input.fill("After");
  await page.keyboard.press("Enter");
  await expect(page.locator(".list-title")).toHaveText("After");
  await expect.poll(title).toBe("After");

  await page.locator(".list-title").click();
  await input.fill("Discarded");
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(page.locator(".list-title")).toHaveText("After");
  await page.waitForTimeout(300); // a stray commit would land by now
  expect(await title()).toBe("After");

  // Clicking away still commits.
  await page.locator(".list-title").click();
  await input.fill("Blurred");
  await page.locator(".board-page").click({ position: { x: 5, y: 5 } });
  await expect.poll(title).toBe("Blurred");
});

test("board controls live in the top bar with centered title", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Header Layout" } })).json();
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".app-logo--board")).toHaveText("Header Layout");
  await expect(page.locator(".board-title-bar")).toHaveCount(0);

  const left = page.locator(".app-header-left");
  const title = page.locator(".app-logo--board");
  const right = page.locator(".app-header-actions");

  await expect(left.locator(".app-logo-home")).toBeVisible();
  await expect(left.locator(".board-mode-switch")).toBeVisible();
  await expect(left.locator(".board-filter-btn")).toBeVisible();

  await expect(right.locator(".header-btn-group .board-archive-btn")).toBeVisible();
  await expect(right.locator(".header-btn-group .board-color-btn")).toBeVisible();
  await expect(right.locator(".header-btn-group .btn-header-labels")).toBeVisible();
  await expect(right.locator(".board-archive-btn")).toHaveText("");
  await expect(right.locator(".btn-header-labels")).toHaveText("");
  await expect(right.locator(".btn-header-shortcuts")).toBeVisible();
  await expect(right.locator(".btn-header-settings")).toBeVisible();

  const [leftBox, titleBox, rightBox, backBox, archiveBox, colorBox, labelsBox, modeBox, filterBox, helpBox, settingsBox] =
    await Promise.all([
      left.boundingBox(),
      title.boundingBox(),
      right.boundingBox(),
      left.locator(".app-logo-home").boundingBox(),
      right.locator(".board-archive-btn").boundingBox(),
      right.locator(".board-color-btn").boundingBox(),
      right.locator(".btn-header-labels").boundingBox(),
      left.locator(".board-mode-switch").boundingBox(),
      left.locator(".board-filter-btn").boundingBox(),
      right.locator(".btn-header-shortcuts").boundingBox(),
      right.locator(".btn-header-settings").boundingBox(),
    ]);
  const titleCenter = titleBox!.x + titleBox!.width / 2;
  const gapCenter = (leftBox!.x + leftBox!.width + rightBox!.x) / 2;
  expect(Math.abs(titleCenter - gapCenter)).toBeLessThan(2);
  expect(archiveBox!.x).toBeLessThan(colorBox!.x);
  expect(colorBox!.x).toBeLessThan(labelsBox!.x);
  const backCenterY = backBox!.y + backBox!.height / 2;
  for (const box of [backBox, modeBox, filterBox, archiveBox, colorBox, labelsBox, helpBox, settingsBox]) {
    expect(box!.height).toBe(backBox!.height);
    expect(box!.height).toBe(30);
    expect(Math.abs(box!.y + box!.height / 2 - backCenterY)).toBeLessThan(1);
  }

  // Color picker opens inside the header and closes on outside header click.
  await right.locator(".board-color-btn").click();
  await expect(page.locator(".board-color-dropdown")).toBeVisible();
  await page.locator(".app-header").click({ position: { x: titleBox!.x - 20, y: 20 } });
  await expect(page.locator(".board-color-dropdown")).toHaveCount(0);
});

test("active and primary colors derive from board color with safe contrast", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Pale Accent" } })).json();
  await request.put(`/api/boards/${board.id}`, { data: { color: "#fef08a" } });
  await page.goto(`/board/${board.id}`);
  await page.locator(".add-trigger").first().click();

  const relLum = (rgb: string) => {
    const m = rgb.match(/\d+(\.\d+)?/g)!.map(Number);
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]);
  };

  // Pale yellow board color is clamped dark enough for white text on .btn-primary.
  const lightBtnBg = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(relLum(lightBtnBg)).toBeLessThan(0.22);

  // Dark mode brightens --color-accent for outlines/text on dark surfaces while keeping .btn-primary dark.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  const darkBtnBg = await page.locator(".btn-primary").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(relLum(darkBtnBg)).toBeLessThan(0.22);
  await page.locator(".board-filter-btn").click();
  await page.locator(".filter-due-chip").first().click();
  const chipColor = await page.locator(".filter-due-chip--active").evaluate((el) => getComputedStyle(el).color);
  expect(relLum(chipColor)).toBeGreaterThan(0.25);
});

test("board network error shows server-unreachable state with retry, not board-not-found", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Network Retry Board" } })
  ).json();

  let fail = true;
  await page.route(`**/api/boards/${board.id}`, (route) =>
    fail ? route.abort("failed") : route.continue()
  );

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".board-error h2")).toHaveText("Cannot reach the server");
  await expect(page.locator(".board-error")).not.toContainText("Board not found");
  await expect(page.locator(".loading")).toHaveCount(0);

  fail = false;
  await page.locator(".board-error-retry").click();
  await expect(page.locator(".app-logo--board")).toHaveText("Network Retry Board");
  await expect(page.locator(".board-error")).toHaveCount(0);
});

test("home page network error shows server-unreachable state with retry, not empty state", async ({
  page,
  request,
}) => {
  await request.post("/api/boards", { data: { title: "Home Network Board" } });

  let fail = true;
  await page.route("**/api/boards*", (route) =>
    fail ? route.abort("failed") : route.continue()
  );

  await page.goto("/");
  await expect(page.locator(".home-error h2")).toHaveText("Cannot reach the server");
  await expect(page.locator(".empty-state")).toHaveCount(0);

  fail = false;
  await page.locator(".home-error .board-error-retry").click();
  await expect(page.locator(".board-card", { hasText: "Home Network Board" })).toBeVisible();
  await expect(page.locator(".home-error")).toHaveCount(0);
});

test("loaded board survives network drop, preserves add-card draft and dirty modal edits on failed save", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Offline Resilient Board" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Existing card" } });

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".card", { hasText: "Existing card" })).toBeVisible();

  let failApi = true;
  await page.route("**/api/**", (route) =>
    failApi ? route.abort("failed") : route.continue()
  );

  // Failed card creation keeps the board mounted, shows NetworkBanner, and keeps the typed draft.
  await page.locator(".list .add-trigger").first().click();
  await page.locator(".list .add-form input").first().fill("Offline card");
  await page.locator(".list .add-form input").first().press("Enter");

  await expect(page.locator(".network-banner")).toContainText("Cannot reach the server");
  await expect(page.locator(".board-error")).toHaveCount(0);
  await expect(page.locator(".list .add-form input").first()).toHaveValue("Offline card");

  // Dismiss AddForm, open card modal, and try saving while offline.
  await page.locator(".list .add-form input").first().press("Escape");
  await page.locator(".card", { hasText: "Existing card" }).click();
  await page.locator(".modal-title-input").fill("Edited offline");
  await page.locator(".modal-save-btn").click();

  await expect(page.locator(".modal-overlay")).toHaveCount(1);
  await expect(page.locator(".detail-error-banner")).toContainText("Could not save card");
  await expect(page.locator(".modal-title-input")).toHaveValue("Edited offline");
  await expect(page.locator(".modal-header-icon .dirty-dot")).toBeVisible();

  // Connectivity returns: saving succeeds, modal closes, and NetworkBanner clears.
  failApi = false;
  await page.locator(".modal-save-btn").click();

  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.locator(".network-banner")).toHaveCount(0);
  await expect(page.locator(".card", { hasText: "Edited offline" })).toBeVisible();
});
