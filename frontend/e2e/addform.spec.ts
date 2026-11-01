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

async function seedLists(request: import("@playwright/test").APIRequestContext, title: string) {
  const board = await (await request.post("/api/boards", { data: { title } })).json();
  for (const t of ["One", "Two"]) {
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: t } });
  }
  return board;
}

test("pressing n re-focuses an add-card form that lost focus", async ({ page, request }) => {
  const board = await seedLists(request, "AddForm Refocus");
  await page.goto(`/board/${board.id}`);
  await expect(page.getByText("Two")).toBeVisible();

  await page.keyboard.press("n");
  const input = page.locator(".list .add-form input");
  await expect(input).toBeFocused();
  await input.fill("Draft");

  // Click on empty board area: focus leaves the input, the form stays open.
  await page.locator(".board-page").click({ position: { x: 5, y: 400 } });
  await expect(input).not.toBeFocused();
  await expect(input).toBeVisible();

  await page.keyboard.press("n");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Draft");
  await expect(page.locator(".add-form")).toHaveCount(1);
});

test("opening an add-card form in another list closes the first", async ({ page, request }) => {
  const board = await seedLists(request, "AddForm Exclusive");
  await page.goto(`/board/${board.id}`);
  await expect(page.getByText("Two")).toBeVisible();

  const lists = page.locator(".list");
  await lists.nth(0).locator(".add-trigger").click();
  await lists.nth(0).locator(".add-form input").fill("Keep me");
  await expect(lists.nth(0).locator(".add-form")).toBeVisible();

  await lists.nth(1).locator(".add-trigger").click();
  await expect(lists.nth(1).locator(".add-form input")).toBeFocused();
  await expect(lists.nth(0).locator(".add-form")).toHaveCount(0);
  await expect(page.locator(".add-form")).toHaveCount(1);

  // The closed form keeps its draft, like Escape does.
  await lists.nth(0).locator(".add-trigger").click();
  await expect(lists.nth(0).locator(".add-form input")).toHaveValue("Keep me");
  await expect(lists.nth(1).locator(".add-form")).toHaveCount(0);
});
