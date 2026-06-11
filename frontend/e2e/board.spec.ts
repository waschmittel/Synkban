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
