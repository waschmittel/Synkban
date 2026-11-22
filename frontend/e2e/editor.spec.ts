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
  await settle(page);
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
    "Plain text", "Code block", "Lua block", "Heading 1", "Heading 2", "Heading 3",
  ]);
  await menu.locator("button", { hasText: "Heading 2" }).click();
  await expect(typeDropdown(page)).toHaveText("Heading 2");
  await expect(editor(page).locator("h2")).toHaveCount(1);

  // The current style is marked; every choice stays listed.
  if (!(await menu.isVisible())) await typeDropdown(page).click();
  await expect(menu.locator("button", { hasText: "Heading 2" })).toHaveClass(/ProseMirror-menu-active/);
  await expect(menu.locator("button")).toHaveCount(6);
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
    "Add link…", "Remove link", "Inline code", "Highlight", "Highlight color…", "Insert image…", "Insert footnote",
    "Plain text", "Code block", "Lua block", "Heading 1", "Heading 2", "Heading 3",
    "Insert table (3×3)", "Insert matrix (3×3)", "Insert alert…",
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

// ── image attachments in the description (ADR-0020) ──────────────────────

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/// Pastes a PNG (no text) into `selector`, like a screenshot from the clipboard.
async function pastePng(page: Page, selector: string) {
  await page.evaluate(
    async ([sel, b64]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
      document.querySelector(sel)!.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    [selector, PNG.toString("base64")],
  );
}

test("pasting an image in the editor attaches it and references it at the caret", async ({ page, request }) => {
  await openEditor(page, request, "Editor Paste Image");
  await page.keyboard.type("before after");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await pastePng(page, ".editor-wrapper .ProseMirror");

  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(page.locator(".attachment-filename")).toHaveText(/^pasted-\d+-1\.png$/);
  const img = editor(page).locator("img.editor-image");
  await expect(img).toHaveCount(1);
  await expect(editor(page).locator("p")).toHaveText("before after"); // image has no text
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  // Placed mid-text, at the caret.
  expect(await editor(page).locator("p").evaluate((p) => [...p.childNodes].map((n) => n.nodeName))).toEqual([
    "#text", "IMG", "#text",
  ]);
  await expect(page.locator(".unsaved-indicator")).toBeVisible();
});

test("a pasted image outside the editor is only attached", async ({ page, request }) => {
  await openEditor(page, request, "Modal Paste Image");
  await pastePng(page, ".modal-title-input");
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(0);
});

test("attached images can be inserted, previewed and vanish from the text when deleted", async ({ page, request }) => {
  await openEditor(page, request, "Editor Image Lifecycle");
  await pastePng(page, ".modal-title-input");
  await expect(page.locator(".attachment-item")).toHaveCount(1);

  await page.locator(".attachment-insert").click();
  const img = editor(page).locator("img.editor-image");
  await expect(img).toHaveCount(1);

  await img.click();
  await expect(page.locator(".image-preview-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".image-preview-overlay")).toHaveCount(0);

  // Saved description holds the reference, not a URL.
  await page.locator(".modal-save-btn").click();
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  await page.locator(".attachment-delete").click();
  await page.locator(".unsaved-dialog .btn-primary").click(); // it is shown in the description
  await expect(page.locator(".attachment-item")).toHaveCount(0);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(0);
});

// ── image picker, copy across cards, references stay valid (ADR-0020) ────

test("the toolbar's insert menu image item picks an existing attachment or uploads a new one", async ({ page, request }) => {
  await openEditor(page, request, "Editor Image Picker");
  await pastePng(page, ".modal-title-input"); // attached only
  await expect(page.locator(".attachment-item")).toHaveCount(1);

  const openImageFromInsert = async () => {
    await page.locator(".ProseMirror-menu-dropdown.insert-dropdown").click();
    await page.locator(".image-menu-trigger").click();
  };

  const picker = page.locator(".image-menu");
  await openImageFromInsert();
  await expect(picker.locator(".table-menu-item")).toHaveText([/pasted-\d+-1\.png/, /Upload image…/]);
  // Escape closes the image picker.
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // Arrow keys + Enter.
  await openImageFromInsert();
  await expect(picker.locator(".table-menu-item--hi")).toHaveText(/pasted/); // first is highlighted
  await page.keyboard.press("ArrowDown");
  await expect(picker.locator(".table-menu-item--hi")).toHaveText(/Upload/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  // Upload goes through the file chooser, attaches and references.
  await openImageFromInsert();
  await expect(picker).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("u");
  const fc = await chooser;
  expect(await fc.element().evaluate((el) => el.isConnected)).toBe(true);
  await fc.setFiles({ name: "up.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator(".attachment-item")).toHaveCount(2);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(2);
  await expect(page.locator(".attachment-ref")).toHaveCount(2);
});

test("the Accel+K menu is arrow-navigable and offers images", async ({ page, request }) => {
  await openEditor(page, request, "Editor Menu Arrows");
  await pastePng(page, ".modal-title-input");
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await editor(page).click();

  await page.keyboard.press("ControlOrMeta+k");
  const hi = page.locator(".table-menu-item--hi");
  await expect(hi).toHaveCount(0);
  await page.keyboard.press("ArrowDown"); // first enabled item (links are greyed out)
  await expect(hi).toHaveText(/^Inline code/);
  await page.keyboard.press("ArrowDown");
  await expect(hi).toHaveText(/^Highlight/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // wraps to the last item
  await expect(hi).toHaveText(/^Insert alert…/);
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(hi).toHaveText(/^Inline code/);

  // M opens the image picker; the editor menu is gone.
  await page.keyboard.press("m");
  await expect(page.locator(".image-menu")).toBeVisible();
  await expect(page.locator(".table-menu:not(.image-menu)")).toHaveCount(0);
  await page.keyboard.press("1");
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  // Enter on a highlighted item runs it.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("table")).toHaveCount(1);
});

test("attachments show whether the description uses them; deleting asks first", async ({ page, request }) => {
  await openEditor(page, request, "Editor Ref Badge");
  await pastePng(page, ".modal-title-input");
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(page.locator(".attachment-ref")).toHaveCount(0);

  await page.locator(".attachment-insert").click();
  await expect(page.locator(".attachment-ref")).toHaveText("in text");

  // Cancel keeps both.
  await page.locator(".attachment-delete").click();
  await expect(page.locator(".unsaved-dialog")).toContainText("removes it from the description");
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  // Removing the picture from the text clears the badge; deleting then needs no question.
  await editor(page).locator("img.editor-image").click(); // opens the preview…
  await expect(page.locator(".image-preview-overlay")).toBeVisible();
  await page.keyboard.press("Escape"); // …leaving the image selected
  await expect(page.locator(".image-preview-overlay")).toHaveCount(0);
  await settle(page);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".attachment-ref")).toHaveCount(0);
  await page.locator(".attachment-delete").click();
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".attachment-item")).toHaveCount(0);
});

test("confirmed delete removes the reference, also from the saved description", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Ref Delete" } })).json();
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })).json();
  const card = await (await request.post(`/api/lists/${list.id}/cards`, { data: { title: "C" } })).json();
  const att = await (
    await request.post(`/api/cards/${card.id}/attachments?filename=a.png`, {
      headers: { "Content-Type": "image/png" },
      data: PNG,
    })
  ).json();
  const doc = (ids: string[]) =>
    JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [
        { type: "text", text: "x" },
        ...ids.map((a) => ({ type: "image", attrs: { att: a, alt: "a.png" } })),
      ] }],
    });
  // A dangling reference (manual edit) is dropped on save; the valid one stays.
  const saved = await (
    await request.put(`/api/cards/${card.id}`, { data: { description: doc([att.id, "dangling"]) } })
  ).json();
  expect(saved.description).toContain(att.id);
  expect(saved.description).not.toContain("dangling");

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "C" }).first().click();
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);
  await page.locator(".attachment-delete").click();
  await page.locator(".unsaved-dialog .btn-primary").click();
  await expect(editor(page).locator("img.editor-image")).toHaveCount(0);
  // Server side: the reference is gone and nothing is left to save.
  const after = await (await request.get(`/api/boards/${board.id}`)).json();
  expect(JSON.stringify(after)).not.toContain(att.id);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);
});

test("a reference to a missing attachment (manual edit) shows a placeholder, not a broken image", async ({ page, request }) => {
  const board = await (await request.post("/api/boards", { data: { title: "Ref Missing" } })).json();
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })).json();
  const card = await (await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Broken" } })).json();
  // Written behind the API's back: straight into the card file is not possible
  // here, so inject the doc as the editor would load it.
  await page.route(`**/api/boards/${board.id}`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const l of body.lists) for (const c of l.cards) {
      c.description = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "see " }, { type: "image", attrs: { att: "nope", alt: "gone.png" } },
      ] }] });
    }
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Broken" }).click();
  const img = editor(page).locator("img.editor-image");
  await expect(img).toHaveClass(/editor-image--missing/);
  await expect(img).toHaveAttribute("title", /missing/);
  // Clicking it does not open a preview.
  await img.click();
  await expect(page.locator(".image-preview-overlay")).toHaveCount(0);
  void card;
});

test("copying an inline image to another card copies the attachment", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const board = await (await request.post("/api/boards", { data: { title: "Ref Copy" } })).json();
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: "L" } })).json();
  for (const t of ["Source", "Target"]) await request.post(`/api/lists/${list.id}/cards`, { data: { title: t } });

  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Source" }).click();
  await pastePng(page, ".modal-title-input");
  await page.locator(".attachment-insert").click();
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);
  await editor(page).locator("img.editor-image").click(); // selects it, opens the preview
  await expect(page.locator(".image-preview-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".image-preview-overlay")).toHaveCount(0);
  await settle(page);
  await page.keyboard.press("ControlOrMeta+c");
  await page.locator(".modal-close").click();
  const discard = page.locator(".unsaved-dialog .btn", { hasText: /Discard/ });
  if (await discard.isVisible()) await discard.click();

  await page.locator(".card", { hasText: "Target" }).click();
  await expect(page.locator(".attachment-item")).toHaveCount(0);
  await editor(page).click();
  await settle(page);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  const img = editor(page).locator("img.editor-image");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".attachment-ref")).toHaveCount(1);
});

test("Tab nests list items and Shift+Tab lifts them; in a list Tab never leaves the editor", async ({ page, request }) => {
  await openEditor(page, request, "Editor Lists");
  await page.keyboard.type("- one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator("ul > li > ul > li")).toHaveText("two");
  // Typing goes on in the nested item.
  await page.keyboard.type("!");
  await expect(editor(page).locator("ul ul li")).toHaveText("two!");

  await page.keyboard.press("Shift+Tab");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator("ul ul")).toHaveCount(0);
  await expect(editor(page).locator("ul > li")).toHaveCount(2);

  // First item: nothing to nest under. Tab is a no-op, not a focus jump.
  await editor(page).getByText("one", { exact: true }).click();
  await settle(page); // ProseMirror picks up the click's selection asynchronously
  await page.keyboard.press("Tab");
  await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator("ul ul")).toHaveCount(0);
  await page.keyboard.type("?");
  await expect(editor(page).locator("ul > li").first()).toContainText("?");

  // Ordered lists too.
  await editor(page).locator("ul > li").last().click();
  await settle(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // leave the bullet list
  await page.keyboard.type("1. first");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second");
  await page.keyboard.press("Tab");
  await expect(editor(page).locator("ol > li > ol > li")).toHaveText("second");

  // Outside lists and tables Tab still moves on, so the keyboard can leave.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("plain");
  await expect(editor(page).locator(":scope > p").last()).toHaveText("plain");
  await page.keyboard.press("Tab");
  await expect(editor(page)).not.toBeFocused();
});

async function expectGapCursor(page: Page) {
  const gap = editor(page).locator(".ProseMirror-gapcursor");
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

test("code block: gap cursor navigation, padding clicks, menu escape, triple-Enter and Backspace", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Editor Code Escape");
  const pm = editor(page);

  // Plain paragraph omits the block-escape menu items.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Insert paragraph above" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Typing ``` converts to a code block; immediate Backspace undoes the input rule back to ```.
  await page.keyboard.type("```");
  await expect(pm.locator("pre")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(pm.locator("pre")).toHaveCount(0);
  await expect(pm.locator("p")).toHaveText("```");

  // An empty code block created via the menu turns back into a paragraph on Backspace.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("b");
  await expect(pm.locator("pre")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  await expect(pm.locator("pre")).toHaveCount(0);
  await expect(pm.locator("p")).toHaveCount(1);

  // Two Enters allow a blank line inside the code block; a third exits into a paragraph below.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("b");
  await page.keyboard.type("line1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("line2");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(pm.locator(":scope > p")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");
  await expect(pm.locator(":scope > pre")).toHaveText("line1\nline2");
  await expect(pm.locator(":scope > p")).toHaveText("after");

  // Remove the trailing paragraph so the code block stands alone, then save & reopen clean.
  await pm.locator(":scope > p").click();
  await settle(page);
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
  await expect(pm.locator(":scope > p")).toHaveCount(0);
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(pm.locator("pre")).toHaveCount(1);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Clicking the padding above and below places a gap cursor without dirtying the card.
  const pmBox = (await pm.boundingBox())!;
  const preBox = (await pm.locator("pre").boundingBox())!;
  await pm.click({ position: { x: pmBox.width / 2, y: Math.max(2, (preBox.y - pmBox.y) / 2) } });
  await expectGapCursor(page);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  await pm.click({
    position: {
      x: pmBox.width / 2,
      y: Math.min(pmBox.height - 2, (preBox.y + preBox.height - pmBox.y + pmBox.height) / 2),
    },
  });
  await expectGapCursor(page);
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // ArrowUp from the top line and ArrowDown from the bottom line place gap cursors;
  // repeating the arrow at the document edge keeps the gap cursor rather than falling back inside.
  await pm.locator("pre").click({ position: { x: 16, y: 18 } });
  await settle(page);
  await page.keyboard.press("ArrowUp");
  await expectGapCursor(page);
  await page.keyboard.press("ArrowUp");
  await expectGapCursor(page);
  await page.keyboard.type("before code");
  await expect(pm.locator(":scope > :first-child")).toHaveText("before code");

  const preBox2 = (await pm.locator("pre").boundingBox())!;
  await pm.locator("pre").click({ position: { x: 16, y: preBox2.height - 18 } });
  await settle(page);
  await page.keyboard.press("ArrowDown");
  await expectGapCursor(page);
  await page.keyboard.press("ArrowDown");
  await expectGapCursor(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("below code");
  await expect(pm.locator(":scope > :last-child")).toHaveText("below code");

  // Accel+K inside a code block offers Insert paragraph above (Shift+P) and below (P).
  await pm.locator(":scope > p").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("b");
  await page.keyboard.type("code only");

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Insert paragraph above" })).toBeVisible();
  await expect(page.locator(".table-menu-item", { hasText: "Insert paragraph below" })).toBeVisible();
  await page.keyboard.press("Shift+P");
  await page.keyboard.type("menu top");

  await pm.locator("pre").click();
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("p");
  await page.keyboard.type("menu bottom");

  await expect(pm.locator(":scope > :first-child")).toHaveText("menu top");
  await expect(pm.locator(":scope > :last-child")).toHaveText("menu bottom");
});

test("code block: Tab indents and Shift+Tab unindents current or highlighted lines", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Editor Code Indent");
  const pm = editor(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("b");
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");

  // Tab mid-line indents the current line without moving focus out of the editor.
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  await page.keyboard.press("Tab");
  await expect(pm).toBeFocused();
  await expect(pm.locator("pre")).toHaveText("one\n  two");

  // Typing continues at the same relative character position after the indent.
  await page.keyboard.type("X");
  await expect(pm.locator("pre")).toHaveText("one\n  twXo");
  await page.keyboard.press("Backspace");

  // Shift+Tab unindents and keeps focus inside the code block.
  await page.keyboard.press("Shift+Tab");
  await expect(pm).toBeFocused();
  await expect(pm.locator("pre")).toHaveText("one\ntwo");

  // Save clean, reopen, and verify Shift+Tab on an unindented line stays focused without dirtying.
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Editor card" }).click();
  await pm.locator("pre").click();
  await settle(page);
  await page.keyboard.press("Shift+Tab");
  await expect(pm).toBeFocused();
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Highlight multiple lines and indent / unindent them together, with single-step undo.
  const preBox = (await pm.locator("pre").boundingBox())!;
  await pm.locator("pre").click({ position: { x: preBox.width - 4, y: preBox.height - 16 } });
  await settle(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("three");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+ArrowUp");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowLeft");
  await settle(page);
  await page.keyboard.press("Tab");
  await expect(pm.locator("pre")).toHaveText("  one\n  two\n  three");

  await page.keyboard.press("Shift+Tab");
  await expect(pm.locator("pre")).toHaveText("one\ntwo\nthree");

  // Undo restores the multi-line indent in one step, and once more back to original.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(pm.locator("pre")).toHaveText("  one\n  two\n  three");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(pm.locator("pre")).toHaveText("one\ntwo\nthree");
});

test("code blocks and inline code have legible colors without pre/code conflict in light and dark mode", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openEditor(page, request, "Editor Code Theme");
  const pm = editor(page);

  await page.keyboard.type("inline");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("i");
  await expect(pm.locator("p code")).toHaveText("inline");

  await page.keyboard.press("ArrowRight");
  await settle(page);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("b");
  await page.keyboard.type("block");
  await expect(pm.locator("pre code")).toHaveText("block");

  const stylesOf = (sel: string) =>
    pm.locator(sel).evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });

  await expect(page.locator("html")).not.toHaveClass(/theme-dark/);
  expect(await stylesOf("pre")).toEqual({ bg: "rgb(226, 228, 232)", color: "rgb(0, 0, 0)" });
  expect((await stylesOf("pre > code")).bg).toBe("rgba(0, 0, 0, 0)");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  expect(await stylesOf("pre")).toEqual({ bg: "rgb(30, 30, 46)", color: "rgb(205, 214, 244)" });
  expect((await stylesOf("pre > code")).bg).toBe("rgba(0, 0, 0, 0)");
  expect((await stylesOf("p code")).bg).toBe("rgba(255, 255, 255, 0.08)");
});

test("lua block: fence & menu creation, syntax highlight, autocomplete, worker run, persistence, stale & timeout", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Editor Lua");
  const pm = editor(page);

  // ```lua converts immediately without waiting for Space, and consumes an optional trailing Space.
  await page.keyboard.type("```lua");
  await expect(pm.locator(".lua-block")).toHaveCount(1);
  await expect(typeDropdown(page)).toHaveText("Lua block");
  await page.keyboard.type(" ");
  await expect(pm.locator(".lua-block-code")).toHaveText("");
  await page.keyboard.press("Backspace");
  await expect(pm.locator(".lua-block")).toHaveCount(0);
  await expect(pm.locator("p")).toHaveCount(1);

  // Accel+K -> E creates a Lua block and TypeDropdown shows "Lua block".
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("e");
  const block = pm.locator(".lua-block");
  await expect(block).toHaveCount(1);
  await expect(typeDropdown(page)).toHaveText("Lua block");

  // Type code with syntax highlighting and trigger stdlib autocomplete (`math.fl` -> Tab).
  await page.keyboard.type("local qty = 3\nreturn math.fl");
  const ac = page.locator(".lua-autocomplete");
  await expect(ac).toBeVisible();
  await expect(ac.locator(".lua-autocomplete-item")).toHaveText(/floor/);
  await page.keyboard.press("Tab");
  await expect(ac).toHaveCount(0);
  await expect(pm).toBeFocused();
  await page.keyboard.type("(qty * 2.9)");

  // Trigger local-variable autocomplete and dismiss it with Escape without closing the modal.
  await page.keyboard.type("\n-- qt");
  await expect(ac).toHaveCount(0); // suppressed inside comments
  for (let i = 0; i < 5; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("local x = qt");
  await expect(ac).toBeVisible();
  await expect(ac.locator(".lua-autocomplete-item").first()).toContainText("qty");
  await page.keyboard.press("Escape");
  await expect(ac).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toBeVisible();
  // Remove the extra line so code stays `local qty = 3\nreturn math.floor(qty * 2.9)`.
  for (let i = 0; i < 13; i++) await page.keyboard.press("Backspace");

  // Syntax highlight tokens exist inside the code view.
  await expect(block.locator(".lua-tok-keyword").first()).toHaveText("local");
  await expect(block.locator(".lua-tok-number").first()).toHaveText("3");
  await expect(block.locator(".lua-tok-builtin").first()).toHaveText("math");

  // Mod-Enter evaluates in the wasmoon Web Worker and persists result in the doc.
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(block.locator(".lua-block-status")).toHaveText("Ran");
  await expect(block.locator(".lua-block-output")).toHaveText("=> 8");

  // Save and reopen: output appears immediately without re-running.
  await page.locator(".modal-save-btn").click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(block.locator(".lua-block-status")).toHaveText("Ran");
  await expect(block.locator(".lua-block-output")).toHaveText("=> 8");
  await expect(page.locator(".unsaved-indicator")).toHaveCount(0);

  // Editing code marks the persisted output Outdated until re-run via Run button.
  await block.locator(".lua-block-code").click({ position: { x: 10, y: 6 } });
  await settle(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type(" + 1");
  await expect(block.locator(".lua-block-status")).toHaveText("Outdated");
  await expect(page.locator(".unsaved-indicator")).toBeVisible();
  await block.locator(".lua-block-run").click();
  await expect(block.locator(".lua-block-status")).toHaveText("Ran");
  await expect(block.locator(".lua-block-output")).toHaveText("=> 9");

  // Clear removes persisted output.
  await block.locator(".lua-block-clear").click();
  await expect(block.locator(".lua-block-result")).toBeHidden();
  await expect(block.locator(".lua-block-status")).toHaveText("");

  // Infinite loops time out, then subsequent blocks still recover cleanly.
  await block.locator(".lua-block-code").click();
  await settle(page);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("e");
  const loopBlock = pm.locator(".lua-block").nth(1);
  await page.keyboard.type("while true do end");
  await loopBlock.locator(".lua-block-run").click();
  await expect(loopBlock.locator(".lua-block-status")).toHaveText("Error", { timeout: 5000 });
  await expect(loopBlock.locator(".lua-block-error")).toContainText("timed out");
  const firstBlock = block.first();
  await firstBlock.locator(".lua-block-run").click();
  await expect(firstBlock.locator(".lua-block-status")).toHaveText("Ran");
  await expect(firstBlock.locator(".lua-block-output")).toHaveText("=> 9");
});

test("lua block: padding clicks, outside blur/refocus, gap cursors, text style sync & Enter ergonomics", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Editor Lua Corners");
  const pm = editor(page);

  await page.keyboard.type("```lua");
  await expect(typeDropdown(page)).toHaveText("Lua block");
  // Enter after ```lua starts on line 1 (no extra leading blank line).
  await page.keyboard.press("Enter");
  await page.keyboard.type("local tab = 1");
  await page.keyboard.press("Enter");
  // Keyword `else` and passive autocomplete on `ta` do not swallow Enter.
  await page.keyboard.type("if tab then");
  await page.keyboard.press("Enter");
  await page.keyboard.type("else");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lua-autocomplete")).toHaveCount(0);
  await page.keyboard.type("end");
  await page.keyboard.press("Enter");
  await page.keyboard.type("return ta");
  const ac = page.locator(".lua-autocomplete");
  await expect(ac).toBeVisible();
  await page.keyboard.press("Enter"); // passive popup lets Enter insert a newline
  await expect(ac).toHaveCount(0);
  await page.keyboard.type("b");

  // Click outside into the card title (blurs ProseMirror), then click the right-side padding
  // inside `.lua-block-pre` to refocus: text style must say "Lua block" and multi-line Enter works.
  await page.locator(".modal-title-input").click();
  await settle(page);
  const preBox = (await pm.locator(".lua-block-code").boundingBox())!;
  await page.mouse.click(preBox.x + preBox.width - 12, preBox.y + preBox.height - 8);
  await settle(page);
  await expect(pm).toBeFocused();
  await expect(typeDropdown(page)).toHaveText("Lua block");
  await page.keyboard.press("Enter");
  await page.keyboard.type("-- extra line");
  await expect(pm.locator(".lua-block-code")).toContainText("-- extra line");

  // Clicking editor padding below a standalone lua_block places a gap cursor and leaves the Lua block.
  const pmBox = (await pm.boundingBox())!;
  const blockBox = (await pm.locator(".lua-block").boundingBox())!;
  await pm.click({
    position: {
      x: pmBox.width / 2,
      y: Math.min(pmBox.height - 2, (blockBox.y + blockBox.height - pmBox.y + pmBox.height) / 2),
    },
  });
  await expectGapCursor(page);
  await expect(typeDropdown(page)).toHaveText("Text style");
  await expect(typeDropdown(page)).toBeEnabled();
  await page.keyboard.press("Enter");
  await page.keyboard.type("outside paragraph");
  await expect(pm.locator(":scope > p").last()).toHaveText("outside paragraph");
  await expect(typeDropdown(page)).toHaveText("Plain text");
});

test("find in description: typing multi-char queries, mid-string edit, case sensitivity, regex, navigation and Escape", async ({ page, request }) => {
  await openEditor(page, request, "Editor Search");
  const pm = editor(page);
  await page.keyboard.type("API sync and api SYNC");
  await page.keyboard.press("Enter");
  await page.keyboard.type("TODO(alpha) and TODO(beta)");

  // Accel+F opens Find and focuses the input.
  await page.keyboard.press("ControlOrMeta+f");
  const findInput = page.locator(".editor-search-find-input");
  await expect(findInput).toBeVisible();
  await expect(findInput).toBeFocused();

  // Type character-by-character with frame gaps (delay > 16ms) — catches focus/select
  // regressions that `.fill()` would hide.
  await page.keyboard.type("sync", { delay: 30 });
  await expect(findInput).toHaveValue("sync");
  await expect(findInput).toBeFocused();
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2");

  // Mid-string editing keeps caret position (doesn't jump to end or select all).
  await findInput.fill("ai");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("p", { delay: 30 });
  await expect(findInput).toHaveValue("api");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2");
  await expect(pm.locator(".pm-search-match")).toHaveCount(2);
  await expect(pm.locator(".pm-search-match--active")).toHaveCount(1);

  // Enter / Shift+Enter step through matches with wrap-around.
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-search-status")).toHaveText("2 of 2");
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2");
  await page.keyboard.press("Shift+Enter");
  await expect(page.locator(".editor-search-status")).toHaveText("2 of 2");

  // Case sensitivity toggle narrows "api" to the lowercase match only.
  await page.locator(".editor-search-case").click();
  await expect(page.locator(".editor-search-case")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 1");
  await page.locator(".editor-search-case").click();

  // Regex toggle + invalid regex feedback.
  await page.locator(".editor-search-regex").click();
  await findInput.fill("[unclosed");
  await expect(page.locator(".editor-search-status")).toHaveText("Invalid");
  await expect(page.locator(".editor-search-error")).toBeVisible();

  await findInput.fill("TODO\\(\\w+\\)");
  await expect(page.locator(".editor-search-error")).toHaveCount(0);
  await expect(page.locator(".editor-search-status")).toHaveText("1 of 2");

  // Escape closes the search bar (not the card modal) and returns focus to the editor.
  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-search-bar")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toBeVisible();
  await expect(pm).toBeFocused();
  await expect(pm.locator(".pm-search-match")).toHaveCount(0);
});

test("find and replace: typed query/replacement, single replace, regex capture replace-all and single undo", async ({ page, request }) => {
  await openEditor(page, request, "Editor Replace");
  const pm = editor(page);
  await page.keyboard.type("TODO(api) and TODO(ui) and TODO(db)");

  // Accel+Shift+H opens Find & Replace directly.
  await page.keyboard.press("ControlOrMeta+Shift+h");
  const findInput = page.locator(".editor-search-find-input");
  const replaceInput = page.locator(".editor-search-replace-input");
  await expect(findInput).toBeFocused();
  await expect(replaceInput).toBeVisible();

  // Single literal replace using real character-by-character typing.
  await page.keyboard.type("TODO(api)", { delay: 25 });
  await expect(findInput).toHaveValue("TODO(api)");
  await replaceInput.click();
  await page.keyboard.type("DONE(api)", { delay: 25 });
  await expect(replaceInput).toHaveValue("DONE(api)");
  await page.keyboard.press("Enter");
  await expect(pm).toContainText("DONE(api) and TODO(ui) and TODO(db)");

  // Regex replace-all with capture group, then single Undo reverts both.
  await page.locator(".editor-search-regex").click();
  await findInput.fill("TODO\\(([^)]+)\\)");
  await replaceInput.fill("DONE($1)");
  await replaceInput.focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(pm).toContainText("DONE(api) and DONE(ui) and DONE(db)");

  await page.keyboard.press("Escape");
  await expect(pm).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(pm).toContainText("DONE(api) and TODO(ui) and TODO(db)");
});
