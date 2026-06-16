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

  // Creating the card from list A clears its draft.
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

  // Open the label picker and create a brand-new label inline.
  await page.locator(".label-add-btn").click();
  await page.locator(".label-create-input").fill("Urgent");
  await page.locator(".label-create-btn").click();

  // New label is auto-assigned (shows as a chip), the inline create form is
  // gone, and focus returns to the "Add label" button.
  await expect(page.locator(".label-assigned-chip", { hasText: "Urgent" })).toBeVisible();
  await expect(page.locator(".label-create")).toHaveCount(0);
  await expect(page.locator(".label-add-btn")).toBeFocused();

  // Save and confirm the label persists on the card in the list view.
  await page.locator(".modal-footer .btn-primary", { hasText: "Save" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.locator(".card-label-chip", { hasText: "Urgent" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".card-label-chip", { hasText: "Urgent" })).toBeVisible();
});

test("inline label create form closes when focus leaves the label area", async ({
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

  await page.locator(".label-add-btn").click();
  await expect(page.locator(".label-create")).toBeVisible();

  // Moving focus out of the label area (to the title input) closes the picker.
  await page.locator(".modal-title-input").focus();
  await expect(page.locator(".label-create")).toHaveCount(0);
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
  await expect(dotA).toHaveAttribute("title", titleA);

  // Clicking another board's dot navigates there and moves the highlight.
  const dotB = page.locator(`.board-dock-dot[data-board-id="${b.id}"]`);
  await expect(dotB).toHaveAttribute("title", titleB);
  await dotB.click();
  await expect(page).toHaveURL(new RegExp(`/board/${b.id}$`));
  await expect(dotB).toHaveClass(/board-dock-dot--active/);
});
