import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function seedCard(request: APIRequestContext, boardTitle: string, cardTitle: string) {
  const board = await (await request.post("/api/boards", { data: { title: boardTitle } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: cardTitle } })
  ).json();
  return { board, card };
}

test("exporting a clean card downloads its PDF with the shortcut", async ({ page, request }) => {
  const { board } = await seedCard(request, "PDF Board", "Export me");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Export me" }).click();

  const download = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+p");
  const file = await download;

  expect(file.suggestedFilename()).toBe("Export me.pdf");
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.locator(".export-pdf-overlay")).toHaveCount(0);
});

test("exporting a dirty card asks first: save & export", async ({ page, request }) => {
  const { board, card } = await seedCard(request, "PDF Dirty Board", "Before");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Before" }).click();
  await page.locator(".modal-title-input").fill("After");

  await page.locator(".modal-export-btn").click();
  await expect(page.locator(".export-pdf-overlay")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save & export" }).click();
  expect((await download).suggestedFilename()).toBe("After.pdf");

  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  const saved = await (await request.get(`/api/boards/${board.id}`)).json();
  expect(JSON.stringify(saved)).toContain("After");
  expect(card.id).toBeTruthy();
});

test("exporting a dirty card: export saved version keeps the edit unsaved", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "PDF Saved Board", "Stored title");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Stored title" }).click();
  await page.locator(".modal-title-input").fill("Edited only locally");

  await page.keyboard.press("ControlOrMeta+p");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export saved version" }).click();
  expect((await download).suggestedFilename()).toBe("Stored title.pdf");

  await expect(page.locator(".export-pdf-overlay")).toHaveCount(0);
  await expect(page.locator(".modal-title-input")).toHaveValue("Edited only locally");
  await expect(page.locator(".unsaved-indicator")).toBeVisible();
});

test("export dialog: Escape cancels without downloading", async ({ page, request }) => {
  const { board } = await seedCard(request, "PDF Cancel Board", "Keep");
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Keep" }).click();
  await page.locator(".modal-title-input").fill("Keep 2");

  await page.keyboard.press("ControlOrMeta+p");
  await expect(page.locator(".export-pdf-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".export-pdf-overlay")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toBeVisible();
});
