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
