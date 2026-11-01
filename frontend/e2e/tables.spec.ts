import { test, expect, type Page } from "@playwright/test";

// Table editing in the card description: the Accel+K menu, Tab/Enter
// navigation, row/column operations and the "first row is the header" rule.
// See src/tables.ts and src/tableMenu.ts.

async function openEditor(page: Page, request: import("@playwright/test").APIRequestContext, name: string) {
  const board = await (await request.post("/api/boards", { data: { title: name } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Table card" } });
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Table card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await page.locator(".editor-wrapper .ProseMirror").click();
  return board;
}

const rowsOf = (page: Page): Promise<string[][]> =>
  page
    .locator(".editor-wrapper .ProseMirror tr")
    .evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => (c.textContent ?? "").trim())));

/// Clicks a cell and lets ProseMirror pick the new selection up from the DOM
/// (it arrives with the async `selectionchange` event — a key pressed in the
/// same tick would still act on the old selection).
async function clickCell(page: Page, selector: string, nth: number) {
  await page.locator(selector).nth(nth).click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
}

/// Types `cells` left-to-right with Tab (starting in the first cell).
async function fill(page: Page, cells: string[]) {
  for (let i = 0; i < cells.length; i++) {
    await page.keyboard.type(cells[i]);
    if (i < cells.length - 1) await page.keyboard.press("Tab");
  }
}

async function insertTable(page: Page) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(1);
}

test("insert a table, navigate with Tab, add a row on the last cell", async ({ page, request }) => {
  await openEditor(page, request, "Tables Tab");
  await insertTable(page);

  // 3×3, first row is the header.
  await expect(page.locator(".editor-wrapper .ProseMirror th")).toHaveCount(3);
  await expect(page.locator(".editor-wrapper .ProseMirror td")).toHaveCount(6);

  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);
  // Tab on the last cell appends a row and moves into it.
  await page.keyboard.press("Tab");
  await page.keyboard.type("7");
  expect(await rowsOf(page)).toEqual([
    ["A", "B", "C"],
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "", ""],
  ]);
  await expect(page.locator(".editor-wrapper .ProseMirror th")).toHaveCount(3);

  // Shift+Tab goes back a cell and selects its content (spreadsheet-style), so
  // typing replaces it.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("x");
  expect((await rowsOf(page))[2][2]).toBe("x");
});

test("Enter goes down a row, leaves the table on the last row; Shift+Enter is a line break", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Enter");
  await insertTable(page);
  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);

  // Same column, next row — the cell's content is selected, so typing replaces.
  await clickCell(page, ".editor-wrapper .ProseMirror td", 1); // row 1, col 1 ("2")
  await page.keyboard.press("Enter");
  await page.keyboard.type("X");
  expect((await rowsOf(page))[2][1]).toBe("X");

  // Shift+Enter: a line break inside the same cell.
  await page.keyboard.press("End");
  await page.keyboard.type("a");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("b");
  await expect(page.locator(".editor-wrapper .ProseMirror td br")).toHaveCount(1);
  expect(await rowsOf(page)).toHaveLength(3);

  // Enter on the last row leaves the table; typing lands in a paragraph after it.
  await page.keyboard.press("Enter");
  await page.keyboard.type("after the table");
  const after = page.locator(".editor-wrapper .ProseMirror > p", { hasText: "after the table" });
  await expect(after).toHaveCount(1);
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(1);
});

/// Opens the table menu and presses one of its keys (every action closes it).
async function menuKey(page: Page, key: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.keyboard.press(key);
}

test("table menu: groups, icons, and every action closes the menu", async ({ page, request }) => {
  await openEditor(page, request, "Tables Menu Look");

  // Outside a table: a single insert action with an icon.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item")).toHaveCount(1);
  await expect(page.locator(".table-menu-item svg")).toHaveCount(1);
  await expect(page.locator(".table-menu-sep")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await insertTable(page);
  await page.keyboard.press("ControlOrMeta+k");

  // Move / insert / align / delete: four groups, three dividers, an icon each,
  // no group headings.
  const items = page.locator(".table-menu-item");
  await expect(items).toHaveCount(14);
  await expect(page.locator(".table-menu-sep")).toHaveCount(3);
  await expect(page.locator(".table-menu-item .table-menu-icon svg")).toHaveCount(14);
  await expect(page.locator(".table-menu-title")).toHaveCount(0);
  await expect(items.locator(".table-menu-label")).toHaveText([
    "Move row up", "Move row down", "Move column left", "Move column right",
    "Insert row above", "Insert row below", "Insert column left", "Insert column right",
    "Align column left", "Align column center", "Align column right",
    "Delete row", "Delete column", "Delete table",
  ]);

  // Clicking an action runs it and closes the menu.
  await page.locator(".table-menu-item", { hasText: "Insert row below" }).click();
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(page.locator(".editor-wrapper .ProseMirror tr")).toHaveCount(4);

  // The toolbar button is an icon, not text.
  const trigger = page.locator(".table-menu-trigger");
  await expect(trigger.locator("svg")).toHaveCount(1);
  expect(((await trigger.textContent()) ?? "").trim()).toBe("");
});

test("table menu: move, insert, delete with keys; each action closes the menu", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Menu");
  await insertTable(page);
  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);

  // Cursor is in row 2, column 2 ("6"). ↑ swaps the row with row 1 and the caret follows.
  await menuKey(page, "ArrowUp");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  expect(await rowsOf(page)).toEqual([
    ["A", "B", "C"],
    ["4", "5", "6"],
    ["1", "2", "3"],
  ]);

  // Row 1 can't move further up (row 0 is the header): refused, menu stays open.
  await menuKey(page, "ArrowUp");
  await expect(page.locator(".table-menu")).toBeVisible();
  expect((await rowsOf(page))[1]).toEqual(["4", "5", "6"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-wrapper .ProseMirror th")).toHaveCount(3);

  // Column: ← moves the caret's column (the last one, "6") to the left.
  await menuKey(page, "ArrowLeft");
  expect(await rowsOf(page)).toEqual([
    ["A", "C", "B"],
    ["4", "6", "5"],
    ["1", "3", "2"],
  ]);

  // Shift+→ inserts a column to the right; Shift+↓ inserts a row below.
  await menuKey(page, "Shift+ArrowRight");
  await menuKey(page, "Shift+ArrowDown");
  await expect(page.locator(".editor-wrapper .ProseMirror th")).toHaveCount(4);
  expect(await rowsOf(page)).toHaveLength(4);

  // Typing while the menu is open must not reach the document.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("q");
  await expect(page.locator(".editor-wrapper .ProseMirror")).not.toContainText("q");
  await page.keyboard.press("Escape");

  // r deletes the row.
  await menuKey(page, "r");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  expect(await rowsOf(page)).toHaveLength(3);
});

test("the first row stays the header", async ({ page, request }) => {
  await openEditor(page, request, "Tables Header");
  await insertTable(page);
  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);

  // Delete the header row: the next row is promoted.
  await clickCell(page, ".editor-wrapper .ProseMirror th", 0);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("r");
  expect((await rowsOf(page))[0]).toEqual(["1", "2", "3"]);
  await expect(page.locator(".editor-wrapper .ProseMirror tr").first().locator("th")).toHaveCount(3);
  await expect(page.locator(".editor-wrapper .ProseMirror tr").nth(1).locator("th")).toHaveCount(0);

  // The header row cannot be moved or have a row inserted above it.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Insert row above" })).toBeDisabled();
  await expect(page.locator(".table-menu-item", { hasText: "Move row down" })).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("toolbar button opens the same menu, Escape closes it, and tables persist", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Persist");

  const trigger = page.locator(".table-menu-trigger");
  await expect(trigger).toHaveAttribute("title", /^Table \((?:⌘|Ctrl\+)K\)$/);
  await trigger.click();
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.locator(".table-menu-item", { hasText: "Insert table" }).click();
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(1);

  await fill(page, ["Name", "Qty", "Note"]);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("Escape");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  // Escape closed only the menu, not the card modal.
  await expect(page.locator(".modal-overlay")).toBeVisible();

  await page.locator(".modal-footer .btn-primary").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Table card" }).click();
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(1);
  expect((await rowsOf(page))[0]).toEqual(["Name", "Qty", "Note"]);
  await expect(page.locator(".editor-wrapper .ProseMirror th")).toHaveCount(3);
});

test("column alignment: menu keys, header always centred, new rows inherit", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Align");
  await insertTable(page);
  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);

  const align = (sel: string, n: number) =>
    page.locator(sel).nth(n).evaluate((el) => getComputedStyle(el).textAlign);

  // Caret is in column 2 ("6"): 3 = right.
  await menuKey(page, "3");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  expect(await align(".editor-wrapper .ProseMirror td", 2)).toBe("right"); // row 1, col 2
  expect(await align(".editor-wrapper .ProseMirror td", 5)).toBe("right"); // row 2, col 2
  expect(await align(".editor-wrapper .ProseMirror td", 0)).toBe("start"); // other column untouched
  // The header cell of that column is still centred.
  expect(await align(".editor-wrapper .ProseMirror th", 2)).toBe("center");

  // Switching to centre and left works the same way.
  await menuKey(page, "2");
  expect(await align(".editor-wrapper .ProseMirror td", 2)).toBe("center");
  await menuKey(page, "1");
  expect(await align(".editor-wrapper .ProseMirror td", 2)).toBe("left");
  await menuKey(page, "3");

  // A row added afterwards inherits the column's alignment.
  await menuKey(page, "Shift+ArrowDown");
  await expect(page.locator(".editor-wrapper .ProseMirror tr")).toHaveCount(4);
  expect(await align(".editor-wrapper .ProseMirror td", 8)).toBe("right"); // row 3, col 2

  // Survives saving and reopening.
  await page.locator(".modal-footer .btn-primary").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Table card" }).click();
  expect(await align(".editor-wrapper .ProseMirror td", 8)).toBe("right");
});
