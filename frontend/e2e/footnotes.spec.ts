import { test, expect, type Page } from "@playwright/test";

async function openEditor(
  page: Page,
  request: import("@playwright/test").APIRequestContext,
  name: string,
) {
  const board = await (await request.post("/api/boards", { data: { title: name } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Footnote card" } })
  ).json();
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Footnote card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await page.locator(".editor-wrapper .ProseMirror").click();
  return { board, list, card };
}

const editor = (page: Page) => page.locator(".editor-wrapper .ProseMirror");
const insertDropdown = (page: Page) => page.locator(".ProseMirror-menu-dropdown.insert-dropdown");

test("top bar groups Footnote, Image, Table, Matrix, lists and Blockquote into an icon+text Insert menu", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Insert Menu Bar");

  // None of these are standalone buttons in the top bar before opening the Insert menu.
  await expect(page.locator(".ProseMirror-menubar .insert-footnote-btn")).toHaveCount(0);
  await expect(page.locator(".ProseMirror-menubar .image-menu-trigger")).toHaveCount(0);
  await expect(page.locator(".ProseMirror-menubar .insert-table-btn")).toHaveCount(0);
  await expect(page.locator(".ProseMirror-menubar .insert-matrix-btn")).toHaveCount(0);

  await insertDropdown(page).click();
  const menuItems = page.locator(".ProseMirror-menu-dropdown-menu .insert-menu-item");
  await expect(menuItems).toHaveCount(8);
  await expect(menuItems).toHaveText([
    "Footnote",
    "Image",
    "Table",
    "Matrix",
    "Bullet list",
    "Ordered list",
    "Blockquote",
    "Alert",
  ]);
  await expect(menuItems.locator("svg")).toHaveCount(8);

  // Blockquote works from the Insert menu.
  await menuItems.filter({ hasText: "Blockquote" }).click();
  await page.keyboard.type("quoted");
  await expect(editor(page).locator("blockquote p")).toHaveText("quoted");
});

test("footnotes stay at the bottom, reorder by first reference, and jump back and forth via keyboard", async ({
  page,
  request,
}) => {
  const { card } = await openEditor(page, request, "Footnotes Core");

  await page.keyboard.type("First sentence.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second sentence");

  // Insert footnote at end of second paragraph via Insert menu -> Footnote.
  await insertDropdown(page).click();
  await page.locator(".insert-footnote-btn").click();
  await expect(editor(page).locator("sup.footnote-ref")).toHaveText(["[1]"]);
  await expect(editor(page).locator("section.footnote-list .footnote-def")).toHaveCount(1);
  await page.keyboard.type("Note for second sentence");

  // Jump back to the reference via Accel+Enter.
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("!");
  await expect(editor(page).locator("> p").nth(1)).toHaveText("Second sentence[1]!");

  // Move caret into the first paragraph and insert an earlier footnote via Accel+K -> F.
  await page.keyboard.press("ArrowUp");
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Insert footnote" })).toBeVisible();
  await page.keyboard.press("f");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await page.keyboard.type("Note for first sentence");

  // Inline refs and bottom definitions are both ordered [1], [2] by first reference.
  await expect(editor(page).locator("sup.footnote-ref")).toHaveText(["[1]", "[2]"]);
  await expect(editor(page).locator(".footnote-def-marker")).toHaveText(["[1]", "[2]"]);
  await expect(editor(page).locator(".footnote-def-content")).toHaveText([
    "Note for first sentence",
    "Note for second sentence",
  ]);

  // Footnote section is structurally the last child of the document.
  const lastTag = await editor(page).evaluate((el) => el.lastElementChild?.tagName.toLowerCase());
  expect(lastTag).toBe("section");

  // Jump back via Accel+Enter -> lands right after [1], then Accel+Enter jumps down to [1] again.
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type(" (edited)");
  await expect(editor(page).locator(".footnote-def-content").first()).toHaveText(
    "Note for first sentence (edited)",
  );

  // Save, reopen, and verify persistence + PDF export.
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  await page.locator(".card", { hasText: "Footnote card" }).click();
  await expect(editor(page).locator("sup.footnote-ref")).toHaveText(["[1]", "[2]"]);
  await expect(editor(page).locator(".footnote-def-content")).toHaveText([
    "Note for first sentence (edited)",
    "Note for second sentence",
  ]);

  const pdfRes = await request.get(`/api/cards/${card.id}/pdf`);
  expect(pdfRes.status()).toBe(200);
  expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
  const bytes = await pdfRes.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
});

test("orphaned non-empty definitions stay dimmed as [—] and can be deleted cleanly", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Footnotes Orphan");

  await page.keyboard.type("Alpha");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("f");
  await page.keyboard.type("Keep me");

  // Jump back right after [1], then Backspace deletes the reference.
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.press("Backspace");

  // Definition remains dimmed as an orphan [—].
  await expect(editor(page).locator("sup.footnote-ref")).toHaveCount(0);
  const def = editor(page).locator(".footnote-def");
  await expect(def).toHaveCount(1);
  await expect(def).toHaveClass(/footnote-def--orphan/);
  await expect(def.locator(".footnote-def-marker")).toHaveText("[—]");
  await expect(def.locator(".footnote-def-content")).toHaveText("Keep me");

  // Delete button removes the orphan and the empty footnote section.
  await def.locator(".footnote-def-delete").click();
  await expect(editor(page).locator("section.footnote-list")).toHaveCount(0);
});

test("tabbed jump-back and delete buttons work via keyboard, and Accel+K -> D deletes the active footnote", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Footnotes Keyboard Buttons");

  await page.keyboard.type("Alpha");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("f");
  await page.keyboard.type("First note");

  // Tab to the jump-back button and activate it with Enter.
  const backBtn = editor(page).locator(".footnote-def-back");
  await page.keyboard.press("Tab");
  await expect(backBtn).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.type("!");
  await expect(editor(page).locator("> p")).toHaveText("Alpha[1]!");

  // Jump back into the footnote and delete it via Accel+K -> D.
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Delete footnote" })).toBeVisible();
  await page.keyboard.press("d");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(editor(page).locator("sup.footnote-ref")).toHaveCount(0);
  await expect(editor(page).locator("section.footnote-list")).toHaveCount(0);

  // Insert another footnote, Tab to the delete button, and activate it with Space.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("f");
  await page.keyboard.type("Temp note");
  const delBtn = editor(page).locator(".footnote-def-delete");
  await page.keyboard.press("Tab"); // jump-back
  await page.keyboard.press("Tab"); // delete
  await expect(delBtn).toBeFocused();
  await page.keyboard.press("Space");
  await expect(editor(page).locator("sup.footnote-ref")).toHaveCount(0);
  await expect(editor(page).locator("section.footnote-list")).toHaveCount(0);
});
