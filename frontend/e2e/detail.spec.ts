import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Card detail in both views: collapsed empty sections, attachment tiles,
// unsaved-edit markers, the contextual shortcut help.

async function seed(request: APIRequestContext, mode: "kanban" | "notes", cards = ["Task card"]) {
  const board = await (await request.post("/api/boards", { data: { title: `Detail ${mode}` } })).json();
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })).json();
  await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Later" } });
  const ids: string[] = [];
  for (const title of cards)
    ids.push((await (await request.post(`/api/lists/${list.id}/cards`, { data: { title } })).json()).id);
  await request.put(`/api/boards/${board.id}`, { data: { mode } });
  return { boardId: board.id, listId: list.id, cardIds: ids };
}

/// Opens the first card: the dialog (kanban) or the pane (notes). Returns its root.
async function open(page: Page, mode: "kanban" | "notes", boardId: string) {
  await page.goto(`/board/${boardId}`);
  if (mode === "kanban") {
    await page.locator(".card").first().click();
    await expect(page.locator(".modal-title-input")).toBeFocused();
    return page.locator(".modal-overlay");
  }
  await expect(page.locator(".notes-detail")).toBeVisible();
  return page.locator(".notes-detail");
}

for (const mode of ["kanban", "notes"] as const) {
  test(`${mode}: empty checklist and attachments collapse into + buttons`, async ({ page, request }) => {
    const s = await seed(request, mode);
    const root = await open(page, mode, s.boardId);
    await expect(root.locator(".checklist-area, .attachments-area")).toHaveCount(0);
    const addChecklist = root.locator(".detail-add-checklist");
    await expect(addChecklist).toHaveText("Checklist");
    await expect(root.locator(".detail-add-attachment")).toHaveText("Attachment");

    // Opened, then left empty: collapses again.
    await addChecklist.click();
    await expect(root.locator(".checklist-add-input")).toBeFocused();
    await expect(addChecklist).toHaveCount(0);
    await root.locator(".modal-title-input").click();
    await expect(root.locator(".checklist-area")).toHaveCount(0);
    await expect(addChecklist).toBeVisible();

    // With an item it stays.
    await addChecklist.click();
    await page.keyboard.type("First step");
    await page.keyboard.press("Enter");
    await root.locator(".modal-title-input").click();
    await expect(root.locator(".checklist-item")).toHaveCount(1);
    await expect(addChecklist).toHaveCount(0);

    // "+ Attachment" is the file chooser; afterwards the tiles take over.
    const chooser = page.waitForEvent("filechooser");
    await root.locator(".detail-add-attachment").click();
    await (await chooser).setFiles([
      { name: "a.png", mimeType: "image/png", buffer: PNG },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
      { name: "report.final.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    ]);
    await expect(root.locator(".attachment-item")).toHaveCount(3);
    await expect(root.locator(".detail-add-row")).toHaveCount(0);
    // (Parallel uploads: any order.)
    expect((await root.locator(".attachment-ext").allTextContents()).sort()).toEqual(["PDF", "TXT"]);
    // Tiles sit side by side, compact, with the add tile in the same grid.
    const boxes = await root.locator(".attachment-item, .attachment-upload").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()).map((r) => ({ y: Math.round(r.y), h: r.height, w: r.width })),
    );
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
    for (const b of boxes) {
      expect(b.h).toBeLessThan(130);
      expect(b.w).toBeLessThan(200);
    }
    // Actions show on focus; Del removes the focused tile.
    const txt = root.locator(".attachment-item", { hasText: "notes.txt" });
    await txt.focus();
    await expect(txt.locator(".attachment-actions")).toHaveCSS("opacity", "1");
    await page.keyboard.press("Delete");
    await expect(root.locator(".attachment-item")).toHaveCount(2);
  });

  test(`${mode}: Save is quiet until there is something to save; the card icon shows a dot`, async ({ page, request }) => {
    await seed(request, mode, ["Dotted", "Other"]).then((s) => open(page, mode, s.boardId));
    const root = page.locator(mode === "kanban" ? ".modal-overlay" : ".notes-detail");
    const save = root.locator(".modal-save-btn");
    const dot = root.locator(".modal-header-icon .dirty-dot");
    await expect(save).toHaveClass(/btn-quiet/);
    await expect(save).not.toHaveClass(/btn-primary/);
    await expect(page.locator(".dirty-dot")).toHaveCount(0);

    await root.locator(".modal-title-input").fill("Dotted, edited");
    await expect(save).toHaveClass(/btn-primary/);
    await expect(dot).toBeVisible();
    await expect(root.locator(".unsaved-indicator")).toHaveText("Unsaved changes");
    // The dot sits on the icon's top-right corner.
    const [d, icon] = await Promise.all([dot.boundingBox(), root.locator(".modal-header-icon svg").boundingBox()]);
    expect(d!.x + d!.width / 2).toBeGreaterThan(icon!.x + icon!.width / 2);
    expect(d!.y + d!.height / 2).toBeLessThan(icon!.y + icon!.height / 2);
    // Not on the master/board card.
    await expect(page.locator(".card .dirty-dot")).toHaveCount(0);
    if (mode === "notes") {
      await expect(page.locator(".notes-tab", { hasText: "Todo" }).locator(".dirty-dot")).toHaveCount(1);
      await expect(page.locator(".notes-tab", { hasText: "Later" }).locator(".dirty-dot")).toHaveCount(0);
    }

    // Typing it back clears it; saving clears it too.
    await root.locator(".modal-title-input").fill("Dotted");
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    await root.locator(".modal-title-input").fill("Dotted again");
    await expect(dot).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator(".dirty-dot")).toHaveCount(0);
    if (mode === "notes") await expect(save).toHaveClass(/btn-quiet/);
  });

  test(`${mode}: empty card title cannot be saved`, async ({ page, request }) => {
    const s = await seed(request, mode, ["Needs title"]);
    const root = await open(page, mode, s.boardId);
    const titleInput = root.locator(".modal-title-input");
    const save = root.locator(".modal-save-btn");

    await titleInput.fill("   ");
    await expect(save).toBeEnabled();

    // Clicking Save shows the error banner and focuses the title input.
    await save.click();
    await expect(root.locator(".detail-error-banner")).toContainText("Card title cannot be empty.");
    await expect(titleInput).toBeFocused();

    // Dismissing the banner and pressing Accel+S also shows the error and focuses the title input.
    await root.locator(".detail-error-banner button").click();
    await expect(root.locator(".detail-error-banner")).toHaveCount(0);
    await root.locator(".editor-wrapper .ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(root.locator(".detail-error-banner")).toContainText("Card title cannot be empty.");
    await expect(titleInput).toBeFocused();

    // Attempting to leave via Escape and choosing Save in the unsaved dialog also blocks.
    await page.keyboard.press("Escape");
    await expect(page.locator(".unsaved-dialog")).toBeVisible();
    await page.locator(".unsaved-dialog .btn-primary").click();
    await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
    await expect(root.locator(".detail-error-banner")).toContainText("Card title cannot be empty.");
    await expect(titleInput).toBeFocused();

    // Typing a valid title clears the error and allows saving.
    await titleInput.fill("Restored title");
    await expect(root.locator(".detail-error-banner")).toHaveCount(0);
    await save.click();
    await expect
      .poll(async () => (await (await request.get(`/api/boards/${s.boardId}`)).json()).lists[0].cards[0].title)
      .toBe("Restored title");
  });
}

test("board color can be set and reset to default", async ({ page, request }) => {
  const s = await seed(request, "kanban");
  await request.put(`/api/boards/${s.boardId}`, { data: { color: "#cc3366" } });
  await page.goto(`/board/${s.boardId}`);
  await page.locator(".board-color-btn").click();
  await page.locator(".board-color-reset").click();
  await expect(page.locator(".board-color-dropdown")).toHaveCount(0);
  const board = await (await request.get(`/api/boards/${s.boardId}`)).json();
  expect(board.color).toBeUndefined();
});

test("notes: keys in the due-date picker stay there", async ({ page, request }) => {
  const s = await seed(request, "notes");
  const root = await open(page, "notes", s.boardId);
  await root.locator(".due-chip").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".due-picker-day[tabindex='0']")).toBeFocused();
  // Board shortcuts (v: view, n: new card, l: new list) don't fire from the grid.
  for (const k of ["v", "n", "l"]) await page.keyboard.press(k);
  await expect(page.locator(".notes-view")).toBeVisible();
  await expect(page.locator(".add-form input")).toHaveCount(0);
  await expect(page.locator(".due-picker")).toBeVisible();
});

test("notes: long titles in the list stop after three lines", async ({ page, request }) => {
  const long = "A very long note title that keeps going and going so it would wrap onto many lines ".repeat(3);
  const s = await seed(request, "notes", [long, "Short"]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "notes", s.boardId);
  const title = page.locator(".notes-master .card-title").first();
  const lh = parseFloat(await title.evaluate((el) => getComputedStyle(el).lineHeight));
  const box = await title.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(3 * lh + 1);
  expect(await title.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // The kanban board still shows the whole title.
  await page.keyboard.press("v");
  const full = page.locator(".lists-container .card-title").first();
  await expect(full).toBeVisible();
  await expect.poll(async () => (await full.boundingBox())!.height).toBeGreaterThan(3 * lh + 1);
});

// Shortcut help: opens on the tab for where the user is.
const helpTab = (page: Page) => page.locator(".shortcut-tab[aria-selected=true]");

test("help opens on the current context and switches tabs by keyboard", async ({ page, request }) => {
  const s = await seed(request, "kanban");
  await page.goto("/");
  await expect(page.locator(".board-card")).not.toHaveCount(0);
  await page.keyboard.press("?");
  await expect(helpTab(page)).toHaveText(/^Boards/);
  await expect(page.locator(".shortcut-tab-here")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".shortcut-help-overlay")).toHaveCount(0);

  await page.goto(`/board/${s.boardId}`);
  await page.locator(".card").first().focus();
  await page.keyboard.press("?");
  await expect(helpTab(page)).toHaveText(/^Board/);
  await expect(helpTab(page)).toBeFocused();
  await expect(page.locator(".shortcut-help-body")).toContainText("Neighbouring list");
  // Every board key is listed, c included; labels / filter panel keys too.
  for (const t of ["Collapse / expand this list", "Rename list", "Labels: reorder", "Filter: clear it"])
    await expect(page.locator(".shortcut-help-body")).toContainText(t);
  // ←/→ and the number keys switch tabs; the "here" marker stays on Board.
  await page.keyboard.press("ArrowRight");
  await expect(helpTab(page)).toHaveText(/^Notes/);
  await expect(helpTab(page)).toBeFocused();
  await page.keyboard.press("5");
  await expect(helpTab(page)).toHaveText(/^Editor/);
  await page.keyboard.press("ArrowRight");
  await expect(helpTab(page)).toHaveText(/^Boards/);
  await expect(page.locator(".shortcut-tab[data-tab=board] .shortcut-tab-here")).toHaveCount(1);
  // Closing gives the keyboard back to the card.
  await page.keyboard.press("?");
  await expect(page.locator(".shortcut-help-overlay")).toHaveCount(0);
  await expect(page.locator(".card").first()).toBeFocused();

  // In the card dialog: the Card tab; in its description: the Editor tab.
  await page.keyboard.press("Enter");
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await page.locator(".modal-save-btn").focus();
  await page.keyboard.press("?");
  await expect(helpTab(page)).toHaveText(/^Card/);
  await expect(page.locator(".shortcut-help-body")).toContainText("Due date picker");
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(1);
  await page.locator(".shortcut-help-overlay").waitFor({ state: "detached" });
  await page.locator(".editor-wrapper .ProseMirror").click();
  await page.locator(".btn-header-shortcuts").evaluate((b: HTMLElement) => b.click());
  // (The header button takes focus on a real click; the editor context is
  // what the user was in.) Focus is still in the editor here.
  await expect(helpTab(page)).toHaveText(/^Editor/);
});

test("help in Notes view opens on Notes", async ({ page, request }) => {
  const s = await seed(request, "notes");
  await page.goto(`/board/${s.boardId}`);
  await page.locator(".notes-master .card").first().click();
  await page.keyboard.press("?");
  await expect(helpTab(page)).toHaveText(/^Notes/);
  await expect(page.locator(".shortcut-help-body")).toContainText("Previous / next list tab");
});

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
