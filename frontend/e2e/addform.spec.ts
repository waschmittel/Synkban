import { test, expect } from "@playwright/test";

// Every board refetch recreates the <For> rows (a fresh JSON payload means new
// item references), which unmounts and remounts each list's AddForm. These
// specs pin the two ways that used to eat a half-typed card title.

test("add-card form survives a background poll refetch", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "AddForm Poll" } })
  ).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();

  await page.clock.install();
  await page.goto(`/board/${board.id}`);
  await expect(page.getByText("Todo")).toBeVisible();

  await page.locator(".list .add-trigger").click();
  const input = page.locator(".list .add-form input");
  await input.fill("Half typed title");

  // Someone else touches the board (rsync, another window) so the next poll
  // tick sees a changed mtime and refetches.
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "External" } });
  await page.clock.fastForward("00:20");
  await expect(page.locator(".card", { hasText: "External" })).toBeVisible();

  await expect(input).toBeVisible();
  await expect(input).toHaveValue("Half typed title");
  await expect(input).toBeFocused();
});

test("a slow card create does not steal focus from the next add form", async ({
  page,
  request,
}) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "AddForm Race" } })
  ).json();
  await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } });

  // Hold the create response so the follow-up refetch reliably lands *after*
  // the user has reopened the form and started typing the next title.
  await page.route("**/api/lists/*/cards", async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });

  await page.goto(`/board/${board.id}`);
  await expect(page.getByText("Todo")).toBeVisible();

  await page.locator(".list .add-trigger").click();
  const input = page.locator(".list .add-form input");
  await input.fill("Card A");
  await input.press("Enter");

  await page.locator(".list .add-trigger").click();
  await input.fill("Card B");

  await expect(page.locator(".card", { hasText: "Card A" })).toBeVisible();

  await expect(input).toBeVisible();
  await expect(input).toHaveValue("Card B");
  await expect(input).toBeFocused();
});
