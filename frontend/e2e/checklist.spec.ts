import { test, expect, type APIRequestContext } from "@playwright/test";

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

test("add checklist items, toggle one, card badge shows done/total", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Checklist Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).click();

  const addInput = page.locator(".checklist-add-input");
  await addInput.fill("Step one");
  await addInput.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await addInput.fill("Step two");
  await addInput.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(2);

  // Items keep insertion order.
  await expect(page.locator(".checklist-item").nth(0)).toContainText("Step one");
  await expect(page.locator(".checklist-item").nth(1)).toContainText("Step two");

  await page.locator(".checklist-item", { hasText: "Step one" }).locator(".checklist-checkbox").check();
  await expect(page.locator(".checklist-progress")).toHaveText("1/2");

  // Close modal — checklist saves immediately, badge on card shows count.
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect(page.locator(".checklist-badge")).toHaveText("1/2");

  // Persists across reload.
  await page.reload();
  await expect(page.locator(".checklist-badge")).toHaveText("1/2");
});

test("check all and uncheck all", async ({ page, request }) => {
  const { board, card } = await seedCard(request, "CheckAll Board");
  for (const text of ["a", "b", "c"]) {
    await request.post(`/api/cards/${card.id}/checklist`, { data: { text } });
  }

  await page.goto(`/board/${board.id}`);
  await expect(page.locator(".checklist-badge")).toHaveText("0/3");
  await page.locator(".card", { hasText: "Task card" }).click();
  await expect(page.locator(".checklist-progress")).toHaveText("0/3");

  await page.locator(".checklist-toggle-all", { hasText: "Check all" }).click();
  await expect(page.locator(".checklist-progress")).toHaveText("3/3");
  for (const cb of await page.locator(".checklist-checkbox").all()) {
    await expect(cb).toBeChecked();
  }

  await page.keyboard.press("Escape");
  const badge = page.locator(".checklist-badge");
  await expect(badge).toHaveText("3/3");
  await expect(badge).toHaveClass(/checklist-badge--complete/);

  await page.locator(".card", { hasText: "Task card" }).click();
  await page.locator(".checklist-toggle-all", { hasText: "Uncheck all" }).click();
  await expect(page.locator(".checklist-progress")).toHaveText("0/3");
});

test("keyboard-only: add, toggle, navigate, delete checklist items", async ({
  page,
  request,
}) => {
  const { board } = await seedCard(request, "Keyboard Board");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Task card" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".modal-title-input")).toBeFocused();

  // Leave the title input, then `c` focuses the checklist add input.
  await page.keyboard.press("Tab");
  await page.keyboard.press("c");
  await expect(page.locator(".checklist-add-input")).toBeFocused();

  await page.keyboard.type("kb one");
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await page.keyboard.type("kb two");
  await page.keyboard.press("Enter");
  await expect(page.locator(".checklist-item")).toHaveCount(2);

  // Shift+Tab from the add input lands on the last item; Space toggles it.
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".checklist-item", { hasText: "kb two" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".checklist-progress")).toHaveText("1/2");

  // ArrowUp to the first item, toggle it too.
  await expect(page.locator(".checklist-item", { hasText: "kb two" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".checklist-item", { hasText: "kb one" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".checklist-progress")).toHaveText("2/2");
  await expect(page.locator(".checklist-item", { hasText: "kb one" })).toBeFocused();

  // Delete the focused item; focus moves to the remaining neighbor.
  await page.keyboard.press("Delete");
  await expect(page.locator(".checklist-item")).toHaveCount(1);
  await expect(page.locator(".checklist-item", { hasText: "kb two" })).toBeFocused();
  await expect(page.locator(".checklist-progress")).toHaveText("1/1");

  // Close and verify the badge shows the complete state.
  await page.keyboard.press("Escape");
  const badge = page.locator(".checklist-badge");
  await expect(badge).toHaveText("1/1");
  await expect(badge).toHaveClass(/checklist-badge--complete/);
});
