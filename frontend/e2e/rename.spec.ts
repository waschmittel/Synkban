import { test, expect } from "@playwright/test";

test("board can be renamed via header title click", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Rename Me" } })
  ).json();

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".app-logo--board")).toHaveText("Rename Me");

  await page.locator(".app-logo--board").click();
  const input = page.locator(".header-rename-input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();

  await input.fill("Renamed Board");
  await page.keyboard.press("Enter");

  await expect(page.locator(".app-logo--board")).toHaveText("Renamed Board");

  // Persisted?
  const fresh = await (await request.get(`/api/boards/${board.id}`)).json();
  expect(fresh.title).toBe("Renamed Board");
});

test("board rename works in electron mode (drag-region header)", async ({ page, request }) => {
  const board = await (
    await request.post("/api/boards", { data: { title: "Electron Rename" } })
  ).json();

  await page.goto(`/board/${board.id}`);
  // Simulate Electron bootstrap class
  await page.evaluate(() => document.documentElement.classList.add("electron"));

  // The header is the window drag region in Electron. The title must opt out,
  // otherwise clicks start a window drag and never reach the element.
  const appRegion = await page
    .locator(".app-logo--board")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("app-region"));
  expect(appRegion).toBe("no-drag");

  await page.locator(".app-logo--board").click();
  await expect(page.locator(".header-rename-input")).toBeVisible();
});
