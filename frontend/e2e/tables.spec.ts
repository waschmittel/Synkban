import { test, expect, type Page } from "@playwright/test";

// Table editing in the card description: the Accel+K menu, Tab/Enter
// navigation, row/column operations and the "first row is the header" rule.
// See src/tables.ts and src/editorMenu.ts.

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

  // Outside a table: link, code, text-style groups, then the insert actions.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item").last()).toHaveText(/Insert matrix/);
  await expect(page.locator(".table-menu-sep")).toHaveCount(3);
  await page.keyboard.press("Escape");

  await insertTable(page);
  await page.keyboard.press("ControlOrMeta+k");

  // Link / code / move / insert / align / paragraph / delete: seven groups,
  // six dividers, an icon each, no group headings. No text styles: cell blocks are fixed.
  const items = page.locator(".table-menu-item");
  await expect(items).toHaveCount(20);
  await expect(page.locator(".table-menu-sep")).toHaveCount(6);
  await expect(page.locator(".table-menu-item .table-menu-icon svg")).toHaveCount(20);
  await expect(page.locator(".table-menu-title")).toHaveCount(0);
  await expect(items.locator(".table-menu-label")).toHaveText([
    "Add link…", "Remove link", "Inline code", "Insert image…",
    "Move row up", "Move row down", "Move column left", "Move column right",
    "Insert row above", "Insert row below", "Insert column left", "Insert column right",
    "Align column left", "Align column center", "Align column right",
    "Insert paragraph above", "Insert paragraph below",
    "Delete row", "Delete column", "Delete table",
  ]);
  await expect(page.locator(".table-menu-item", { hasText: "Insert paragraph above" })).toHaveAttribute(
    "title",
    /\((?:⇧|Shift\+)P\)$/,
  );
  await expect(page.locator(".table-menu-item", { hasText: "Insert paragraph below" })).toHaveAttribute(
    "title",
    /\(P\)$/,
  );

  // Clicking an action runs it and closes the menu.
  await page.locator(".table-menu-item", { hasText: "Insert row below" }).click();
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(page.locator(".editor-wrapper .ProseMirror tr")).toHaveCount(4);

  // Both insert toolbar buttons are icons, not text.
  for (const sel of [".insert-table-btn", ".insert-matrix-btn"]) {
    const btn = page.locator(sel);
    await expect(btn.locator("svg")).toHaveCount(1);
    expect(((await btn.textContent()) ?? "").trim()).toBe("");
  }
});

test("table menu: move, insert, delete with keys; each action closes the menu", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Menu");
  await insertTable(page);
  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);

  // Cursor is in row 2, column 2 ("6"). W swaps the row with row 1 and the caret follows.
  await menuKey(page, "w");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  expect(await rowsOf(page)).toEqual([
    ["A", "B", "C"],
    ["4", "5", "6"],
    ["1", "2", "3"],
  ]);

  // Row 1 can't move further up (row 0 is the header): refused, menu stays open.
  await menuKey(page, "w");
  await expect(page.locator(".table-menu")).toBeVisible();
  expect((await rowsOf(page))[1]).toEqual(["4", "5", "6"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-wrapper .ProseMirror th")).toHaveCount(3);

  // Column: A moves the caret's column (the last one, "6") to the left.
  await menuKey(page, "a");
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

test("toolbar buttons insert table/matrix directly, disable when invalid, Escape closes menu, and tables persist", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Persist");

  const tableBtn = page.locator(".insert-table-btn");
  const matrixBtn = page.locator(".insert-matrix-btn");
  await expect(tableBtn).toHaveAttribute("title", "Insert table");
  await expect(matrixBtn).toHaveAttribute("title", "Insert matrix");
  await expect(tableBtn).toHaveAttribute("aria-disabled", "false");
  await expect(matrixBtn).toHaveAttribute("aria-disabled", "false");

  await tableBtn.click();
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(1);

  // Inside a table, neither a table nor a matrix can be inserted.
  await expect(tableBtn).toHaveClass(/ProseMirror-menu-disabled/);
  await expect(tableBtn).toHaveAttribute("aria-disabled", "true");
  await expect(tableBtn).toBeDisabled();
  await expect(matrixBtn).toHaveClass(/ProseMirror-menu-disabled/);
  await expect(matrixBtn).toHaveAttribute("aria-disabled", "true");
  await expect(matrixBtn).toBeDisabled();
  await matrixBtn.click({ force: true });
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(1);

  await fill(page, ["Name", "Qty", "Note"]);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("Escape");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  // Escape closed only the menu, not the card modal.
  await expect(page.locator(".modal-overlay")).toBeVisible();

  // Moving outside the table re-enables both buttons; clicking Insert matrix inserts a matrix.
  await page.locator(".editor-wrapper .ProseMirror > p").last().click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await expect(tableBtn).toHaveAttribute("aria-disabled", "false");
  await expect(matrixBtn).toHaveAttribute("aria-disabled", "false");
  await matrixBtn.click();
  await expect(page.locator(".editor-wrapper .ProseMirror table[data-matrix]")).toHaveCount(1);
  await expect(tableBtn).toHaveAttribute("aria-disabled", "true");
  await expect(matrixBtn).toHaveAttribute("aria-disabled", "true");

  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Table card" }).click();
  await expect(page.locator(".editor-wrapper .ProseMirror table")).toHaveCount(2);
  await expect(page.locator(".editor-wrapper .ProseMirror table[data-matrix]")).toHaveCount(1);
  expect((await rowsOf(page)).slice(0, 1)).toEqual([["Name", "Qty", "Note"]]);
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
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Table card" }).click();
  expect(await align(".editor-wrapper .ProseMirror td", 8)).toBe("right");
});

test("multi-cell selection: align column right applies to all selected columns", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Multi Align");
  await insertTable(page);
  await fill(page, ["A", "B", "C", "1", "2", "3", "4", "5", "6"]);

  // Drag across cells in row 1 from column 1 ("2") to column 2 ("3").
  const c1 = page.locator(".editor-wrapper .ProseMirror td").nth(1);
  const c2 = page.locator(".editor-wrapper .ProseMirror td").nth(2);
  const b1 = (await c1.boundingBox())!;
  const b2 = (await c2.boundingBox())!;
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.up();
  await expect(page.locator(".editor-wrapper .ProseMirror .selectedCell")).toHaveCount(2);

  await menuKey(page, "3");
  const align = (n: number) =>
    page.locator(".editor-wrapper .ProseMirror td").nth(n).evaluate((el) => getComputedStyle(el).textAlign);
  expect(await align(0)).toBe("start");
  expect(await align(1)).toBe("right");
  expect(await align(2)).toBe("right");
  expect(await align(4)).toBe("right");
  expect(await align(5)).toBe("right");
});

test("matrices: open corner, centered row/col headers, per-cell alignment, transpose and persistence", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Matrices");
  await menuKey(page, "x");
  const matrix = page.locator(".editor-wrapper .ProseMirror table[data-matrix]");
  await expect(matrix).toHaveCount(1);
  await expect(matrix.locator("th")).toHaveCount(4);
  await expect(matrix.locator("td")).toHaveCount(5);

  const corner = matrix.locator("tr").first().locator("> :first-child");
  const cornerStyle = await corner.evaluate((el) => {
    const s = getComputedStyle(el);
    return { top: s.borderTopStyle, left: s.borderLeftStyle, pointer: s.pointerEvents };
  });
  expect(cornerStyle).toEqual({ top: "hidden", left: "hidden", pointer: "none" });

  // Caret starts in (0, 1); Tab skips the corner and walks all editable cells.
  await fill(page, ["Col1", "Col2", "Row1", "a", "b", "Row2", "c", "d"]);
  expect(await rowsOf(page)).toEqual([
    ["", "Col1", "Col2"],
    ["Row1", "a", "b"],
    ["Row2", "c", "d"],
  ]);

  // All headers (top row and left column) are centred.
  for (let i = 0; i < 4; i++) {
    expect(await matrix.locator("th").nth(i).evaluate((el) => getComputedStyle(el).textAlign)).toBe(
      "center",
    );
  }

  // Shift+Tab from (1, 0) goes back to (0, 2) without ever touching (0, 0).
  await clickCell(page, ".editor-wrapper .ProseMirror table[data-matrix] tr:nth-child(2) th", 0);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("Col2b");
  expect((await rowsOf(page))[0]).toEqual(["", "Col1", "Col2b"]);

  // Menu items adapt to matrices; header cells cannot be aligned.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Transpose" })).toBeVisible();
  await expect(page.locator(".table-menu-item", { hasText: "Align cell left" })).toBeDisabled();
  await expect(page.locator(".table-menu-item", { hasText: "Delete matrix" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Align body cell (1, 1) ("a") right without affecting (2, 1) ("c") or (1, 2) ("b").
  const bodyCell = (r: number, c: number) =>
    matrix.locator("tr").nth(r).locator("td").nth(c - 1);
  const cellAlign = (r: number, c: number) =>
    bodyCell(r, c).evaluate((el) => getComputedStyle(el).textAlign);

  await bodyCell(1, 1).click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await menuKey(page, "3");
  expect(await cellAlign(1, 1)).toBe("right");
  expect(await cellAlign(2, 1)).toBe("start");
  expect(await cellAlign(1, 2)).toBe("start");

  // Align (1, 2) ("b") center, add a row below (2, 2), and fill it to make a 4×3 matrix.
  await bodyCell(1, 2).click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await menuKey(page, "2");
  expect(await cellAlign(1, 2)).toBe("center");

  await bodyCell(2, 2).click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await page.keyboard.press("Tab");
  await fill(page, ["Row3", "e", "f"]);
  expect(await rowsOf(page)).toEqual([
    ["", "Col1", "Col2b"],
    ["Row1", "a", "b"],
    ["Row2", "c", "d"],
    ["Row3", "e", "f"],
  ]);

  // Transpose from (1, 2) ("b"): 4×3 becomes 3×4, alignments follow cells, caret stays in "b".
  await bodyCell(1, 2).click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await menuKey(page, "x");
  expect(await rowsOf(page)).toEqual([
    ["", "Row1", "Row2", "Row3"],
    ["Col1", "a", "c", "e"],
    ["Col2b", "b", "d", "f"],
  ]);
  expect(await cellAlign(1, 1)).toBe("right");
  expect(await cellAlign(2, 1)).toBe("center");
  expect(await cellAlign(1, 2)).toBe("start");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  expect((await rowsOf(page))[2][1]).toBe("b!");

  // Save and reopen: matrix, headers and per-cell alignments persist.
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Table card" }).click();
  await expect(matrix).toHaveCount(1);
  expect(await rowsOf(page)).toEqual([
    ["", "Row1", "Row2", "Row3"],
    ["Col1", "a", "c", "e"],
    ["Col2b", "b!", "d", "f"],
  ]);
  expect(await cellAlign(1, 1)).toBe("right");
  expect(await cellAlign(2, 1)).toBe("center");
});

async function expectVisibleGapCursor(page: Page) {
  const gap = page.locator(".editor-wrapper .ProseMirror .ProseMirror-gapcursor");
  await expect(gap).toHaveCount(1);
  await expect
    .poll(() =>
      gap.evaluate((el) => ({
        display: getComputedStyle(el).display,
        border: parseFloat(getComputedStyle(el, "::after").borderTopWidth),
      })),
    )
    .toMatchObject({ display: "block" });
  expect(
    await gap.evaluate((el) => parseFloat(getComputedStyle(el, "::after").borderTopWidth)),
  ).toBeGreaterThan(0);
}

test("escape a leading/trailing table or matrix via arrows, padding clicks, and the menu", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Tables Escape");
  const pm = page.locator(".editor-wrapper .ProseMirror");

  // Leading table: ArrowUp from row 0 places a visible gap cursor before it.
  await insertTable(page);
  await page.keyboard.press("ArrowUp");
  await expectVisibleGapCursor(page);
  await page.keyboard.type("before table");
  await expect(pm.locator(":scope > :first-child")).toHaveText("before table");

  // Delete leading paragraph + trailing paragraph so the table stands alone.
  await pm.locator(":scope > p").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await insertTable(page);
  await pm.locator(":scope > p").last().click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await page.keyboard.press("Backspace");
  await expect(pm.locator(":scope > p")).toHaveCount(0);

  // Save and reopen so the card starts clean before testing padding clicks.
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Table card" }).click();
  await expect(pm.locator("table")).toHaveCount(1);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Clicking padding above a leading table places a gap cursor without marking dirty.
  const pmBox = (await pm.boundingBox())!;
  const tblBox = (await pm.locator("table").boundingBox())!;
  await pm.click({ position: { x: pmBox.width / 2, y: Math.max(2, (tblBox.y - pmBox.y) / 2) } });
  await expectVisibleGapCursor(page);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Clicking padding below a trailing table places a gap cursor without marking dirty.
  await pm.click({
    position: {
      x: pmBox.width / 2,
      y: Math.min(pmBox.height - 2, (tblBox.y + tblBox.height - pmBox.y + pmBox.height) / 2),
    },
  });
  await expectVisibleGapCursor(page);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // ArrowDown from the last row places a gap cursor; Enter + typing inserts a paragraph below.
  await clickCell(page, ".editor-wrapper .ProseMirror td", 5);
  await page.keyboard.press("ArrowDown");
  await expectVisibleGapCursor(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("below via arrow");
  await expect(pm.locator(":scope > p").last()).toHaveText("below via arrow");

  // Leading matrix: ArrowLeft from (0, 1) and ArrowUp both escape to a gap cursor.
  await pm.locator(":scope > p").last().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await menuKey(page, "x");
  await pm.locator(":scope > p").last().click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await page.keyboard.press("Backspace");
  await expect(pm.locator(":scope > p")).toHaveCount(0);

  await clickCell(page, ".editor-wrapper .ProseMirror table[data-matrix] tr:first-child th", 0);
  await page.keyboard.press("ArrowLeft");
  await expectVisibleGapCursor(page);
  await page.keyboard.press("ArrowRight"); // back into (0, 1)
  await page.keyboard.press("ArrowUp");
  await expectVisibleGapCursor(page);
  await page.keyboard.type("above matrix");
  await expect(pm.locator(":scope > :first-child")).toHaveText("above matrix");

  // Accel+K -> Shift+P and P inside the matrix insert paragraphs above and below it.
  await pm.locator(":scope > :first-child").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await menuKey(page, "x");
  await pm.locator(":scope > p").last().click();
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await page.keyboard.press("Backspace");
  await clickCell(page, ".editor-wrapper .ProseMirror table[data-matrix] td", 1);
  await menuKey(page, "Shift+P");
  await page.keyboard.type("menu above");
  await clickCell(page, ".editor-wrapper .ProseMirror table[data-matrix] td", 1);
  await menuKey(page, "p");
  await page.keyboard.type("menu below");
  await expect(pm.locator(":scope > :first-child")).toHaveText("menu above");
  await expect(pm.locator(":scope > :last-child")).toHaveText("menu below");
});
