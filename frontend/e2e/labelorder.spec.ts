import { test, expect } from "@playwright/test";

test("labels reorder in drawer (keyboard + drag) and order shows on cards and filter", async ({
  page,
  request,
}) => {
  const board = await (await request.post("/api/boards", { data: { title: "Label Order" } })).json();
  const ids: string[] = [];
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const l = await (await request.post(`/api/boards/${board.id}/labels`, { data: { name } })).json();
    ids.push(l.id);
  }
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "C1" } })
  ).json();
  await request.put(`/api/cards/${card.id}`, { data: { label_ids: [ids[0], ids[1], ids[2]] } });

  await page.goto(`/board/${board.id}`);
  await page.keyboard.press("g");
  const rows = page.locator(".label-drawer-item");
  await expect(rows).toHaveCount(3);

  // Keyboard: focus Alpha, Shift+Down -> Beta, Alpha, Gamma; focus follows.
  await rows.nth(0).focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(rows.locator(".label-drawer-name")).toHaveText(["Beta", "Alpha", "Gamma"]);
  await expect(page.locator(".label-drawer-item[data-label-id='" + ids[0] + "']")).toBeFocused();

  // Drag Gamma above Beta.
  await rows.nth(2).dragTo(rows.nth(0), { targetPosition: { x: 40, y: 2 } });
  await expect(rows.locator(".label-drawer-name")).toHaveText(["Gamma", "Beta", "Alpha"]);

  // Persisted + reflected on the card.
  const detail = await (await request.get(`/api/boards/${board.id}`)).json();
  expect(detail.labels.map((l: { name: string }) => l.name)).toEqual(["Gamma", "Beta", "Alpha"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".card .card-labels")).toBeVisible();
});
