import { test, expect } from "@playwright/test";

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
