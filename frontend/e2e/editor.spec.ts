import { test, expect, type Page } from "@playwright/test";

// Description editor: text-style dropdown, link editing (toolbar, right-click,
// Accel+K menu). See src/schema.ts, src/links.ts and src/editorMenu.ts.

async function openEditor(page: Page, request: import("@playwright/test").APIRequestContext, name: string) {
  const board = await (await request.post("/api/boards", { data: { title: name } })).json();
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
  ).json();
  await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Editor card" } });
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await page.locator(".editor-wrapper .ProseMirror").click();
}

const editor = (page: Page) => page.locator(".editor-wrapper .ProseMirror");
const typeDropdown = (page: Page) => page.locator(".ProseMirror-menu-dropdown.type-dropdown");
const settle = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

/// Types "see docs here", links "docs" to example.com and leaves the cursor in it.
async function linkedDocs(page: Page) {
  await page.keyboard.type("see docs here");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft"); // before " here"
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.locator('[title="Add or edit link"]').click();
  await page.locator(".link-dialog-input").fill("https://example.com");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator('a[href="https://example.com"]')).toHaveText("docs");
}

test("text style dropdown shows the current style; unavailable choices are greyed", async ({ page, request }) => {
  await openEditor(page, request, "Editor Type");
  await expect(typeDropdown(page)).toHaveText("Plain text");

  await typeDropdown(page).click();
  const menu = page.locator(".ProseMirror-menu-dropdown-menu");
  await expect(menu.locator("button")).toHaveText([
    "Plain text", "Code block", "Heading 1", "Heading 2", "Heading 3",
  ]);
  await menu.locator("button", { hasText: "Heading 2" }).click();
  await expect(typeDropdown(page)).toHaveText("Heading 2");
  await expect(editor(page).locator("h2")).toHaveCount(1);

  // The current style is marked; every choice stays listed.
  if (!(await menu.isVisible())) await typeDropdown(page).click();
  await expect(menu.locator("button", { hasText: "Heading 2" })).toHaveClass(/ProseMirror-menu-active/);
  await expect(menu.locator("button")).toHaveCount(5);
  await page.keyboard.press("Escape");
});

test("text style dropdown is disabled inside a table cell", async ({ page, request }) => {
  await openEditor(page, request, "Editor Type Table");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("t");
  await settle(page);
  await expect(typeDropdown(page)).toBeDisabled();
  await expect(typeDropdown(page)).toHaveText("Plain text");

  // Back outside the table the dropdown works again.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await settle(page);
  await expect(typeDropdown(page)).toBeEnabled();
});

test("toolbar link button edits the whole link from the cursor or a partial selection", async ({ page, request }) => {
  await openEditor(page, request, "Editor Link Toolbar");
  await linkedDocs(page);

  // Cursor inside the link (select nothing): the dialog edits the whole link.
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  await page.locator('[title="Add or edit link"]').click();
  await expect(page.locator(".link-dialog-input")).toHaveValue("https://example.com");
  await expect(page.locator(".link-dialog-remove")).toBeVisible();
  await page.locator(".link-dialog-input").fill("https://example.org");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator('a[href="https://example.org"]')).toHaveText("docs");

  // A partial selection edits the whole link too; Remove unlinks all of it.
  await page.keyboard.press("Shift+ArrowLeft");
  await settle(page);
  await page.locator('[title="Add or edit link"]').click();
  await page.locator(".link-dialog-remove").click();
  await expect(editor(page).locator("a")).toHaveCount(0);
  await expect(editor(page)).toContainText("see docs here");
});

test("right-click opens the same menu as Accel+K at the pointer, and never opens a link", async ({ page, request }) => {
  await openEditor(page, request, "Editor Link Context");
  await linkedDocs(page);

  // Count window.open: a plain click opens the link, a right-click must not.
  await page.evaluate(() => {
    (window as any).__opened = 0;
    window.open = () => (((window as any).__opened += 1), null);
  });
  const opened = () => page.evaluate(() => (window as any).__opened as number);
  const labels = page.locator(".table-menu-item .table-menu-label");

  // The Accel+K menu, for comparison.
  await page.keyboard.press("ControlOrMeta+k");
  const expected = await labels.allTextContents();
  await page.keyboard.press("Escape");

  // On the link: same items, "Edit link…" enabled, anchored at the pointer.
  const link = editor(page).locator("a");
  await link.click({ button: "right" });
  expect(await opened()).toBe(0);
  const menu = page.locator(".table-menu");
  await expect(menu).toBeVisible();
  expect(await labels.allTextContents()).toEqual(expected);
  await expect(menu.locator(".table-menu-item", { hasText: "Edit link" })).toBeEnabled();
  const box = (await link.boundingBox())!;
  const m = (await menu.boundingBox())!;
  expect(Math.abs(m.x - (box.x + box.width / 2))).toBeLessThan(box.width);
  expect(m.y).toBeGreaterThan(box.y);

  // Edit link… opens the dialog prefilled.
  await menu.locator(".table-menu-item", { hasText: "Edit link" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".link-dialog-input")).toHaveValue("https://example.com");
  await page.locator(".link-dialog-input").fill("https://example.net");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator('a[href="https://example.net"]')).toHaveText("docs");

  // Remove link removes it right away; the text stays.
  await link.click({ button: "right" });
  expect(await opened()).toBe(0);
  await page.locator(".table-menu-item", { hasText: "Remove link" }).click();
  await expect(editor(page).locator("a")).toHaveCount(0);
  await expect(editor(page)).toContainText("see docs here");

  // Elsewhere in the text: the caret moves there; link actions are greyed.
  await editor(page).locator("p").click({ button: "right", position: { x: 4, y: 8 } });
  await expect(menu).toBeVisible();
  await expect(menu.locator(".table-menu-item", { hasText: "Remove link" })).toBeDisabled();
  await page.keyboard.press("2");
  await expect(editor(page).locator("h2")).toHaveText("see docs here");
});

test("right-click keeps an existing selection it lands in", async ({ page, request }) => {
  await openEditor(page, request, "Editor Context Selection");
  await page.keyboard.type("hello world");
  await page.keyboard.press("Shift+Home");
  await settle(page);
  await editor(page).locator("p").click({ button: "right", position: { x: 20, y: 8 } });
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.keyboard.press("i"); // inline code on the whole selection
  await expect(editor(page).locator("code")).toHaveText("hello world");
});

test("a plain click on a link opens it", async ({ page, request }) => {
  await openEditor(page, request, "Editor Link Open");
  await linkedDocs(page);
  await page.evaluate(() => {
    (window as any).__urls = [];
    window.open = (u) => (((window as any).__urls.push(String(u))), null);
  });
  await editor(page).locator("a").click();
  expect(await page.evaluate(() => (window as any).__urls)).toEqual(["https://example.com"]);
});

test("Accel+K menu is contextual: link, inline code, text style", async ({ page, request }) => {
  await openEditor(page, request, "Editor Menu");
  await page.keyboard.type("hello");
  await page.keyboard.press("ControlOrMeta+k");
  const labels = page.locator(".table-menu-item .table-menu-label");
  await expect(labels).toHaveText([
    "Add link…", "Remove link", "Inline code",
    "Plain text", "Code block", "Heading 1", "Heading 2", "Heading 3",
    "Insert table (3×3)",
  ]);
  // No link at the cursor and nothing selected: link actions are greyed out.
  await expect(page.locator(".table-menu-item", { hasText: "Add link" })).toBeDisabled();
  await expect(page.locator(".table-menu-item", { hasText: "Remove link" })).toBeDisabled();
  await expect(page.locator(".table-menu-item", { hasText: "Plain text" })).toHaveClass(/--active/);

  // Heading 2 via key 2.
  await page.keyboard.press("2");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(editor(page).locator("h2")).toHaveText("hello");
  await expect(typeDropdown(page)).toHaveText("Heading 2");

  // Inline code via key i on a selection.
  await page.keyboard.press("Shift+Home");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("i");
  await expect(editor(page).locator("h2 code")).toHaveText("hello");

  // Back to plain text with 0.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("0");
  await expect(editor(page).locator("h2")).toHaveCount(0);
});

test("Accel+K menu edits and removes the link under the cursor", async ({ page, request }) => {
  await openEditor(page, request, "Editor Menu Link");
  await linkedDocs(page);

  await page.keyboard.press("ArrowLeft");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Edit link" })).toBeEnabled();
  await page.keyboard.press("l");
  await expect(page.locator(".link-dialog-input")).toHaveValue("https://example.com");
  await expect(page.locator(".link-dialog-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".link-dialog-overlay")).toHaveCount(0);

  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("u");
  await expect(editor(page).locator("a")).toHaveCount(0);
});

test("table cells: the Accel+K menu offers link and code but no text styles", async ({ page, request }) => {
  await openEditor(page, request, "Editor Menu Table");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("t");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Heading 1" })).toHaveCount(0);
  await expect(page.locator(".table-menu-item", { hasText: "Inline code" })).toBeEnabled();
  await page.keyboard.press("Escape");
});
