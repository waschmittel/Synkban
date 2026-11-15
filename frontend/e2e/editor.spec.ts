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
    "Add link…", "Remove link", "Inline code", "Insert image…",
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

  // Saved description holds the reference, not a URL.
  await page.locator(".modal-footer .btn-primary").click();
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  await page.locator(".attachment-delete").click();
  await page.locator(".unsaved-dialog .btn-primary").click(); // it is shown in the description
  await expect(page.locator(".attachment-item")).toHaveCount(0);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(0);
});

// ── image picker, copy across cards, references stay valid (ADR-0020) ────

test("the toolbar's image button picks an existing attachment or uploads a new one", async ({ page, request }) => {
  await openEditor(page, request, "Editor Image Picker");
  await pastePng(page, ".modal-title-input"); // attached only
  await expect(page.locator(".attachment-item")).toHaveCount(1);

  const picker = page.locator(".image-menu");
  await page.locator(".image-menu-trigger").click();
  await expect(picker.locator(".table-menu-item")).toHaveText([/pasted-\d+-1\.png/, /Upload image…/]);
  // Toggle: the same button closes it again.
  await page.locator(".image-menu-trigger").click();
  await expect(picker).toHaveCount(0);

  // Arrow keys + Enter.
  await page.locator(".image-menu-trigger").click();
  await expect(picker.locator(".table-menu-item--hi")).toHaveText(/pasted/); // first is highlighted
  await page.keyboard.press("ArrowDown");
  await expect(picker.locator(".table-menu-item--hi")).toHaveText(/Upload/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  // Upload goes through the file chooser, attaches and references.
  await page.locator(".image-menu-trigger").click();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("u");
  await (await chooser).setFiles({ name: "up.png", mimeType: "image/png", buffer: PNG });
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
  await expect(hi).toHaveText(/^Insert image…/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // wraps to the last item
  await expect(hi).toHaveText(/^Insert table/);
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
  await page.keyboard.press("Enter");
  await expect(editor(page).locator("table")).toHaveCount(1);
});

test("attachments show whether the description uses them; deleting asks first", async ({ page, request }) => {
  await openEditor(page, request, "Editor Ref Badge");
  await pastePng(page, ".modal-title-input");
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(page.locator(".attachment-ref")).toHaveCount(0);

  await page.locator(".attachment-insert").click();
  await expect(page.locator(".attachment-ref")).toHaveText(/in description/);

  // Cancel keeps both.
  await page.locator(".attachment-delete").click();
  await expect(page.locator(".unsaved-dialog")).toContainText("removes it from the description");
  await page.keyboard.press("Escape");
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  await expect(editor(page).locator("img.editor-image")).toHaveCount(1);

  // Removing the picture from the text clears the badge; deleting then needs no question.
  await editor(page).locator("img.editor-image").click(); // opens the preview…
  await page.keyboard.press("Escape"); // …leaving the image selected
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
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+c");
  await page.locator(".modal-footer .btn-cancel").click();
  const discard = page.locator(".unsaved-dialog .btn", { hasText: /Discard/ });
  if (await discard.isVisible()) await discard.click();

  await page.locator(".card", { hasText: "Target" }).click();
  await expect(page.locator(".attachment-item")).toHaveCount(0);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".attachment-item")).toHaveCount(1);
  const img = editor(page).locator("img.editor-image");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(".attachment-ref")).toHaveCount(1);
});
