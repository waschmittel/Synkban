import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// Notes mode (ADR-0022): lists as tabs, the active list's cards as master,
// the selected card edited inline beside it.

interface Seeded {
  boardId: string;
  lists: { id: string; cards: string[] }[];
}

async function seed(
  request: APIRequestContext,
  lists: { title: string; cards: string[] }[],
  mode: "kanban" | "notes" = "notes",
): Promise<Seeded> {
  const board = await (await request.post("/api/boards", { data: { title: `Notes ${Date.now()}` } })).json();
  const out: Seeded = { boardId: board.id, lists: [] };
  for (const l of lists) {
    const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: l.title } })).json();
    const cards: string[] = [];
    for (const title of l.cards)
      cards.push((await (await request.post(`/api/lists/${list.id}/cards`, { data: { title } })).json()).id);
    out.lists.push({ id: list.id, cards });
  }
  await request.put(`/api/boards/${board.id}`, { data: { mode } });
  return out;
}

const getBoard = async (request: APIRequestContext, id: string) =>
  (await request.get(`/api/boards/${id}`)).json();

const pane = (page: Page) => page.locator(".notes-detail");
const paneTitle = (page: Page) => page.locator(".notes-detail .modal-title-input");
const editor = (page: Page) => page.locator(".notes-detail .ProseMirror");
const master = (page: Page, title: string) => page.locator(".notes-master .card", { hasText: title });
const tab = (page: Page, title: string) => page.locator(".notes-tab", { hasText: title });
const dialog = (page: Page) => page.locator(".unsaved-dialog");

/// Opens `title` from the master and types into its description.
async function editDescription(page: Page, title: string, text: string) {
  await master(page, title).click();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type(text);
  await expect(page.locator(".notes-detail .unsaved-indicator")).toBeVisible();
}

/// Full HTML5 drag of a master card onto a list tab, one shared DataTransfer.
async function dragCardToTab(page: Page, cardId: string, listId: string) {
  await page.evaluate(
    ({ cardId, listId }) => {
      const src = document.querySelector(`.card[data-card-id="${cardId}"]`)!;
      const tgt = document.querySelector(`.notes-tab[data-list-id="${listId}"]`)!;
      const r = tgt.getBoundingClientRect();
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
          }),
        );
      fire(src, "dragstart");
      fire(tgt, "dragenter");
      fire(tgt, "dragover");
      (window as unknown as { __dropHighlight: boolean }).__dropHighlight = tgt.classList.contains("notes-tab--drop");
      fire(tgt, "drop");
      fire(src, "dragend");
    },
    { cardId, listId },
  );
}

test("V and the switch toggle the mode; it is stored per board and survives a reload", async ({
  page,
  request,
}) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["One"] }], "kanban");
  const other = await seed(request, [{ title: "Other", cards: ["Elsewhere"] }], "kanban");
  await page.goto(`/board/${s.boardId}`);
  await expect(page.locator(".lists-container .card", { hasText: "One" })).toBeVisible();
  await expect(page.locator(".board-mode-btn", { hasText: "Board" })).toHaveAttribute("aria-pressed", "true");

  await page.locator(".board-page").focus();
  await page.keyboard.press("v");
  await expect(page.locator(".notes-view")).toBeVisible();
  await expect(page.locator(".lists-container")).toHaveCount(0);
  await expect(page.locator(".board-mode-btn", { hasText: "Notes" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await getBoard(request, s.boardId)).mode).toBe("notes");

  await page.reload();
  await expect(page.locator(".notes-view")).toBeVisible();
  expect((await getBoard(request, other.boardId)).mode).toBe("kanban");

  // The other board keeps its own mode.
  await page.goto(`/board/${other.boardId}`);
  await expect(page.locator(".lists-container .card", { hasText: "Elsewhere" })).toBeVisible();

  await page.goto(`/board/${s.boardId}`);
  await page.locator(".board-mode-btn", { hasText: "Board" }).click();
  await expect(page.locator(".lists-container .card", { hasText: "One" })).toBeVisible();
  await expect.poll(async () => (await getBoard(request, s.boardId)).mode).toBe("kanban");
});

test("a mode change on another device applies on the next visit, not on a poll", async ({
  page,
  request,
}) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["One"] }], "kanban");
  await page.clock.install();
  await page.goto(`/board/${s.boardId}`);
  await expect(page.locator(".lists-container")).toBeVisible();

  await request.put(`/api/boards/${s.boardId}`, { data: { mode: "notes" } });
  await request.post(`/api/lists/${s.lists[0].id}/cards`, { data: { title: "Two" } });
  await page.clock.fastForward("00:20");
  await expect(page.locator(".lists-container .card", { hasText: "Two" })).toBeVisible();
  await expect(page.locator(".notes-view")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".notes-view")).toBeVisible();
});

test("entering Notes opens the focused card's list and card; leaving focuses it on the board", async ({
  page,
  request,
}) => {
  const s = await seed(
    request,
    [
      { title: "Inbox", cards: ["A1"] },
      { title: "Drafts", cards: ["D1", "D2"] },
    ],
    "kanban",
  );
  await page.goto(`/board/${s.boardId}`);
  await page.locator(".lists-container .card", { hasText: "D2" }).focus();
  await page.keyboard.press("v");

  await expect(tab(page, "Drafts")).toHaveAttribute("aria-selected", "true");
  await expect(paneTitle(page)).toHaveValue("D2");
  await expect(master(page, "D2")).toBeFocused();
  await expect(master(page, "D2")).toHaveClass(/card--selected/);
  await expect(master(page, "A1")).toHaveCount(0);

  await page.keyboard.press("ArrowUp");
  await expect(paneTitle(page)).toHaveValue("D1");
  await page.keyboard.press("v");
  await expect(page.locator(".lists-container .card", { hasText: "D1" })).toBeFocused();
});

test("the master reuses the board's card rendering; the tab is its title", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Badged"] }]);
  const desc = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "text" }] }],
  });
  await request.put(`/api/cards/${s.lists[0].cards[0]}`, {
    data: { due_date: "2099-01-01", checklist: [{ id: "x", text: "Step", done: true }], description: desc },
  });
  await page.goto(`/board/${s.boardId}`);
  const card = master(page, "Badged");
  await expect(card.locator(".due-badge")).toBeVisible();
  await expect(card.locator(".checklist-badge")).toHaveText("1/1");
  await expect(card.locator(".card-archive")).toHaveCount(1);
  // No list header: the tab is the list's title.
  await expect(page.locator(".notes-master .list-header")).toHaveCount(0);
  await expect(tab(page, "Inbox")).toHaveClass(/notes-tab--active/);
  await expect(page.locator(".notes-master .add-trigger")).toBeVisible();
  // The detail is the card dialog's layout, inline: same sections, no ✕.
  await expect(pane(page).locator(".description-row .editor-wrapper")).toBeVisible();
  await expect(pane(page).locator(".checklist-add-input")).toBeVisible();
  await expect(pane(page).locator(".modal-close")).toHaveCount(0);
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
});

test("arrows show cards while clean; Enter goes to the description, a click stays on the card", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["First", "Second", "Third"] }]);
  await page.goto(`/board/${s.boardId}`);
  await expect(paneTitle(page)).toHaveValue("First");
  await master(page, "First").focus();
  await page.keyboard.press("ArrowDown");
  await expect(paneTitle(page)).toHaveValue("Second");
  await expect(master(page, "Second")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();

  await master(page, "Third").click();
  await expect(paneTitle(page)).toHaveValue("Third");
  await expect(master(page, "Third")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(paneTitle(page)).toHaveValue("Second");
  await page.keyboard.press("ArrowDown");
  // `e` (edit) works like Enter.
  await page.keyboard.press("e");
  await expect(editor(page)).toBeFocused();

  // Dirty: arrows only move focus, the pane keeps the edited card.
  await page.keyboard.type("draft");
  await master(page, "Third").focus();
  await page.keyboard.press("ArrowUp");
  await expect(master(page, "Second")).toBeFocused();
  await expect(paneTitle(page)).toHaveValue("Third");
  await expect(dialog(page)).toHaveCount(0);
});

test("Save saves and stays; the saved state becomes the new baseline", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Note"] }]);
  const id = s.lists[0].cards[0];
  await page.goto(`/board/${s.boardId}`);
  await editDescription(page, "Note", "Body text");
  await paneTitle(page).fill("Renamed note");
  await page.keyboard.press("ControlOrMeta+s");

  await expect(page.locator(".notes-detail .saved-indicator")).toBeVisible();
  await expect(page.locator(".notes-detail .unsaved-indicator")).toHaveCount(0);
  await expect(pane(page)).toBeVisible();
  await expect(paneTitle(page)).toBeFocused();
  await expect(master(page, "Renamed note")).toBeVisible();
  const card = (await getBoard(request, s.boardId)).lists[0].cards.find((c: { id: string }) => c.id === id);
  expect(card.title).toBe("Renamed note");
  expect(card.description).toContain("Body text");
  await expect(page.locator(".notes-detail .btn-cancel")).toBeDisabled();

  // Editing again clears "Saved"; reverting the edit back clears "dirty".
  await editor(page).click();
  await page.keyboard.type("!");
  await expect(page.locator(".notes-detail .saved-indicator")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(page.locator(".notes-detail .unsaved-indicator")).toHaveCount(0);

  // The Save button does the same.
  await page.keyboard.type(" more");
  await pane(page).locator(".modal-save-btn").click();
  await expect(page.locator(".notes-detail .saved-indicator")).toBeVisible();
  await expect(pane(page)).toBeVisible();
});

test("Revert restores the saved card", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Keep me"] }]);
  await page.goto(`/board/${s.boardId}`);
  await editDescription(page, "Keep me", "throwaway");
  await paneTitle(page).fill("Changed");
  await pane(page).locator(".modal-footer .btn-cancel").click();
  await expect(paneTitle(page)).toHaveValue("Keep me");
  await expect(editor(page)).not.toContainText("throwaway");
  await expect(page.locator(".notes-detail .unsaved-indicator")).toHaveCount(0);
});

test("Esc in the pane: clean goes back to the list; dirty asks (cancel, discard, save)", async ({
  page,
  request,
}) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Esc card"] }]);
  const id = s.lists[0].cards[0];
  await page.goto(`/board/${s.boardId}`);
  await master(page, "Esc card").click();
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(master(page, "Esc card")).toBeFocused();
  await expect(dialog(page)).toHaveCount(0);

  // Cancel: edits and caret stay. Regression: ProseMirror's Escape used to
  // node-select the block, so the next keystroke replaced all of it.
  await page.keyboard.press("Enter");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("abc");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("def");
  await expect(editor(page)).toHaveText("abcdef");

  // Discard: back to the saved state, focus on the card.
  await page.keyboard.press("Escape");
  await dialog(page).locator(".btn-danger").click();
  await expect(editor(page)).not.toContainText("abc");
  await expect(master(page, "Esc card")).toBeFocused();

  // Save (Enter on the focused default button): saved, pane stays.
  await page.keyboard.press("Enter");
  await page.keyboard.type("kept");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
  await expect(master(page, "Esc card")).toBeFocused();
  await expect(pane(page)).toBeVisible();
  await expect
    .poll(async () => JSON.stringify((await getBoard(request, s.boardId)).lists[0].cards.find((c: { id: string }) => c.id === id).description))
    .toContain("kept");
});

test("picking another card with unsaved edits asks first", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Alpha", "Beta"] }]);
  const [alpha] = s.lists[0].cards;
  await page.goto(`/board/${s.boardId}`);
  await editDescription(page, "Alpha", "unsaved");

  await master(page, "Beta").click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(paneTitle(page)).toHaveValue("Alpha");
  await expect(master(page, "Alpha")).toBeFocused();

  await master(page, "Beta").click();
  await dialog(page).locator(".btn-danger").click();
  await expect(paneTitle(page)).toHaveValue("Beta");
  await expect(master(page, "Beta")).toBeFocused();
  const after = (await getBoard(request, s.boardId)).lists[0].cards.find((c: { id: string }) => c.id === alpha);
  expect(after.description ?? "").not.toContain("unsaved");

  await editDescription(page, "Beta", "saved on leave");
  await master(page, "Alpha").click();
  await dialog(page).locator(".btn-primary").click();
  await expect(paneTitle(page)).toHaveValue("Alpha");
  await expect
    .poll(async () => JSON.stringify((await getBoard(request, s.boardId)).lists[0].cards))
    .toContain("saved on leave");
});

test("tab switch, V, board cycling and going home all ask before dropping edits", async ({
  page,
  request,
}) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["Guarded"] },
    { title: "Drafts", cards: ["Other"] },
  ]);
  await seed(request, [{ title: "Next", cards: ["N"] }]);
  await page.goto(`/board/${s.boardId}`);
  await editDescription(page, "Guarded", "x");

  await tab(page, "Drafts").click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(tab(page, "Inbox")).toHaveAttribute("aria-selected", "true");

  await master(page, "Guarded").focus();
  await page.keyboard.press("v");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(page.locator(".notes-view")).toBeVisible();

  await master(page, "Guarded").focus();
  await page.keyboard.press(".");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(page).toHaveURL(new RegExp(s.boardId));

  await master(page, "Guarded").focus();
  await page.keyboard.press("b");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-danger").click();
  await expect(page).toHaveURL(/\/$/);
});

test("closing the window with unsaved edits triggers beforeunload; clean does not", async ({
  page,
  request,
}) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Unload"] }]);
  await page.goto(`/board/${s.boardId}`);
  const prevented = () =>
    page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await prevented()).toBe(false);
  await editDescription(page, "Unload", "x");
  expect(await prevented()).toBe(true);
});

test("arrow keys switch tabs and each list remembers its card", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["I1", "I2"] },
    { title: "Empty", cards: [] },
    { title: "Drafts", cards: ["D1", "D2"] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await expect(tab(page, "Inbox").locator(".notes-tab-count")).toHaveText("2");
  await expect(tab(page, "Empty").locator(".notes-tab-count")).toHaveText("0");

  await master(page, "I1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(paneTitle(page)).toHaveValue("I2");

  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Empty")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".notes-master .list-empty")).toHaveText("No cards in this list.");
  await expect(page.locator(".notes-placeholder", { hasText: "No card selected" })).toBeVisible();

  await tab(page, "Drafts").click();
  await expect(paneTitle(page)).toHaveValue("D1");
  await master(page, "D1").focus();
  await page.keyboard.press("ArrowDown");
  await expect(paneTitle(page)).toHaveValue("D2");
  // ArrowRight at the last tab stays put.
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Drafts")).toHaveAttribute("aria-selected", "true");

  await tab(page, "Inbox").click();
  await expect(paneTitle(page)).toHaveValue("I2");
  await tab(page, "Drafts").click();
  await expect(paneTitle(page)).toHaveValue("D2");
});

test("Shift+Arrow moves cards: within the list, and to the neighbour list with the selection", async ({
  page,
  request,
}) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["Mover", "Stay"] },
    { title: "Done", cards: ["Old"] },
  ]);
  const [mover] = s.lists[0].cards;
  await page.goto(`/board/${s.boardId}`);
  await master(page, "Mover").focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.locator(".notes-master .card").nth(1)).toHaveText(/Mover/);
  await expect(master(page, "Mover")).toBeFocused();

  await page.keyboard.press("Shift+ArrowRight");
  await expect(tab(page, "Done")).toHaveAttribute("aria-selected", "true");
  await expect(master(page, "Mover")).toBeFocused();
  await expect(paneTitle(page)).toHaveValue("Mover");
  const b = await getBoard(request, s.boardId);
  expect(b.lists[1].cards.map((c: { id: string }) => c.id)).toContain(mover);
});

test("Shift+Alt+Arrow in the master reorders the lists (tabs)", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "First", cards: ["F"] },
    { title: "Second", cards: ["S"] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await master(page, "F").focus();
  await page.keyboard.press("Shift+Alt+ArrowRight");
  await expect(page.locator(".notes-tab").first()).toHaveText(/Second/);
  await expect.poll(async () => (await getBoard(request, s.boardId)).lists[0].title).toBe("Second");
});

test("dragging a card onto a tab moves it to the bottom of that list", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["Drag me", "Selected"] },
    { title: "Archive-ish", cards: ["Existing"] },
  ]);
  const [dragged, selected] = s.lists[0].cards;
  const target = s.lists[1].id;
  await page.goto(`/board/${s.boardId}`);
  await master(page, "Selected").click();
  await expect(paneTitle(page)).toHaveValue("Selected");

  await dragCardToTab(page, dragged, target);
  expect(await page.evaluate(() => (window as unknown as { __dropHighlight: boolean }).__dropHighlight)).toBe(true);
  await expect(master(page, "Drag me")).toHaveCount(0);
  await expect(tab(page, "Archive-ish").locator(".notes-tab-count")).toHaveText("2");
  await expect(page.locator(".notes-tab--drop")).toHaveCount(0);
  // Not the selected card: the selection stays where it was.
  await expect(tab(page, "Inbox")).toHaveAttribute("aria-selected", "true");
  await expect(paneTitle(page)).toHaveValue("Selected");
  const b = await getBoard(request, s.boardId);
  expect(b.lists[1].cards.map((c: { id: string }) => c.id)).toEqual([s.lists[1].cards[0], dragged]);

  // The selected card follows its move.
  await dragCardToTab(page, selected, target);
  await expect(tab(page, "Archive-ish")).toHaveAttribute("aria-selected", "true");
  await expect(paneTitle(page)).toHaveValue("Selected");

  // Dropping on the card's own tab is a no-op.
  await dragCardToTab(page, selected, target);
  await expect(tab(page, "Archive-ish").locator(".notes-tab-count")).toHaveText("3");
});

test("a dragged card's unsaved edits survive moving it to another tab", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["Editing"] },
    { title: "Later", cards: [] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await editDescription(page, "Editing", "in progress");
  await dragCardToTab(page, s.lists[0].cards[0], s.lists[1].id);
  await expect(tab(page, "Later")).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toContainText("in progress");
  await expect(page.locator(".notes-detail .unsaved-indicator")).toBeVisible();
  await expect(page.locator(".pane-banner")).toHaveCount(0);
});

test("N adds a card to the active list and lands in its description", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Inbox", cards: [] },
    { title: "Ideas", cards: ["Old idea"] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await tab(page, "Ideas").click();
  await page.locator(".board-page").focus();
  await page.keyboard.press("n");
  await page.locator(".notes-master .add-form input").fill("Fresh idea");
  await page.keyboard.press("Enter");
  await expect(paneTitle(page)).toHaveValue("Fresh idea");
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type("written right away");
  await expect(editor(page)).toContainText("written right away");
  const b = await getBoard(request, s.boardId);
  expect(b.lists[1].cards.map((c: { title: string }) => c.title)).toContain("Fresh idea");
});

test("a new list from the tab strip becomes the active tab", async ({ page, request }) => {
  const s = await seed(request, []);
  await page.goto(`/board/${s.boardId}`);
  await expect(page.locator(".notes-placeholder", { hasText: "No lists yet" })).toBeVisible();
  await page.locator(".board-page").focus();
  await page.keyboard.press("l");
  await page.locator(".notes-tabs .add-form input").fill("Journal");
  await page.keyboard.press("Enter");
  await expect(tab(page, "Journal")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".notes-master .list-empty")).toBeVisible();
});

test("filter: tabs count matches, the master filters, the open card stays", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["apple pie", "banana", "apple jam"] },
    { title: "Other", cards: ["cherry"] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await master(page, "banana").click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  await page.locator(".filter-bar input").fill("apple");
  await expect(tab(page, "Inbox").locator(".notes-tab-count")).toHaveText("2/3");
  await expect(tab(page, "Other").locator(".notes-tab-count")).toHaveText("0/1");
  await expect(master(page, "banana")).toHaveCount(0);
  await expect(paneTitle(page)).toHaveValue("banana");
  await tab(page, "Other").click();
  await expect(page.locator(".notes-master .list-empty")).toHaveText("No matching cards.");
  await expect(page.locator(".notes-placeholder", { hasText: "No card selected" })).toBeVisible();
});

test("archiving the selected card shows its neighbour; with edits it asks first", async ({
  page,
  request,
}) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["One", "Two", "Three"] }]);
  await page.goto(`/board/${s.boardId}`);
  await master(page, "Two").focus();
  await expect(paneTitle(page)).toHaveValue("Two");
  await page.keyboard.press("Delete");
  await dialog(page).locator(".btn-primary").click(); // "Archive" confirm
  await expect(master(page, "Two")).toHaveCount(0);
  await expect(paneTitle(page)).toHaveValue("Three");

  await editDescription(page, "Three", "x");
  await master(page, "Three").focus();
  await page.keyboard.press("Delete");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(master(page, "Three")).toBeVisible();
});

test.describe("changes from elsewhere", () => {
  test.setTimeout(45_000);

  test("clean pane reloads silently; dirty pane warns and can load theirs", async ({ page, request }) => {
    const s = await seed(request, [{ title: "Inbox", cards: ["Shared"] }]);
    const id = s.lists[0].cards[0];
    await page.clock.install();
    await page.goto(`/board/${s.boardId}`);
    await expect(paneTitle(page)).toHaveValue("Shared");

    await request.put(`/api/cards/${id}`, { data: { title: "Shared v2" } });
    await page.clock.fastForward("00:20");
    await expect(paneTitle(page)).toHaveValue("Shared v2");
    await expect(page.locator(".pane-banner")).toHaveCount(0);

    await editDescription(page, "Shared v2", "mine");
    await request.put(`/api/cards/${id}`, { data: { title: "Shared v3" } });
    await page.clock.fastForward("00:20");
    await expect(page.locator(".pane-banner")).toContainText("changed elsewhere");
    await expect(paneTitle(page)).toHaveValue("Shared v2");
    await expect(editor(page)).toContainText("mine");

    await page.locator(".pane-banner button", { hasText: "Load theirs" }).click();
    await expect(paneTitle(page)).toHaveValue("Shared v3");
    await expect(editor(page)).not.toContainText("mine");
    await expect(page.locator(".pane-banner")).toHaveCount(0);
    await expect(page.locator(".notes-detail .unsaved-indicator")).toHaveCount(0);
  });

  test("saving over a foreign change keeps mine", async ({ page, request }) => {
    const s = await seed(request, [{ title: "Inbox", cards: ["Clash"] }]);
    const id = s.lists[0].cards[0];
    await page.clock.install();
    await page.goto(`/board/${s.boardId}`);
    await editDescription(page, "Clash", "mine");
    await request.put(`/api/cards/${id}`, { data: { title: "Theirs" } });
    await page.clock.fastForward("00:20");
    await expect(page.locator(".pane-banner")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.locator(".pane-banner")).toHaveCount(0);
    await expect(page.locator(".notes-detail .saved-indicator")).toBeVisible();
    const card = (await getBoard(request, s.boardId)).lists[0].cards[0];
    expect(card.title).toBe("Clash");
    expect(card.description).toContain("mine");
  });

  test("archived elsewhere: clean moves on, dirty keeps edits and can restore", async ({ page, request }) => {
    const s = await seed(request, [{ title: "Inbox", cards: ["Gone", "Next", "Kept"] }]);
    const [gone, , kept] = s.lists[0].cards;
    await page.clock.install();
    await page.goto(`/board/${s.boardId}`);
    await expect(paneTitle(page)).toHaveValue("Gone");

    await request.put(`/api/cards/${gone}`, { data: { archived: true } });
    await page.clock.fastForward("00:20");
    await expect(paneTitle(page)).toHaveValue("Next");

    await editDescription(page, "Kept", "rescued text");
    await request.put(`/api/cards/${kept}`, { data: { archived: true } });
    await page.clock.fastForward("00:20");
    await expect(master(page, "Kept")).toHaveCount(0);
    await expect(page.locator(".pane-banner--removed")).toBeVisible();
    await expect(paneTitle(page)).toHaveValue("Kept");
    await expect(editor(page)).toContainText("rescued text");

    await page.locator(".pane-banner--removed button").click();
    await expect(master(page, "Kept")).toBeVisible();
    await expect(page.locator(".pane-banner--removed")).toHaveCount(0);
    const card = (await getBoard(request, s.boardId)).lists[0].cards.find((c: { id: string }) => c.id === kept);
    expect(card.description).toContain("rescued text");
  });
});

test("the active tab renames its list (click, R; Enter keeps, Esc cancels); × deletes it", async ({
  page,
  request,
}) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["Kept focus"] },
    { title: "Spare", cards: ["Spare card"] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  const input = page.locator(".notes-tab-input");

  // An inactive tab selects; only the active one renames.
  await tab(page, "Spare").locator(".notes-tab-btn").click();
  await expect(tab(page, "Spare")).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveCount(0);
  await tab(page, "Inbox").locator(".notes-tab-btn").click();
  await tab(page, "Inbox").locator(".notes-tab-btn").click();
  await expect(input).toBeFocused();
  await input.fill("Journal");
  await page.keyboard.press("Enter");
  await expect(tab(page, "Journal")).toHaveClass(/notes-tab--active/);
  await expect.poll(async () => (await getBoard(request, s.boardId)).lists[0].title).toBe("Journal");
  await expect(master(page, "Kept focus")).toBeFocused();

  // R from a card; Esc cancels and the keyboard is back on the card.
  await page.keyboard.press("r");
  await expect(input).toBeFocused();
  await input.fill("Nope");
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(tab(page, "Journal")).toBeVisible();
  await expect(master(page, "Kept focus")).toBeFocused();
  await page.waitForTimeout(300); // a stray commit from the unmount blur would land by now
  expect((await getBoard(request, s.boardId)).lists[0].title).toBe("Journal");

  // × on the active tab: confirm (it has cards), then the next list shows.
  await tab(page, "Journal").hover();
  await tab(page, "Journal").locator(".notes-tab-delete").click();
  await page.locator(".unsaved-dialog .btn-primary").click();
  await expect(tab(page, "Journal")).toHaveCount(0);
  await expect(tab(page, "Spare")).toHaveAttribute("aria-selected", "true");
  await expect(paneTitle(page)).toHaveValue("Spare card");
  await expect(tab(page, "Spare").locator(".notes-tab-delete")).toHaveCount(1);
});

test("Esc from anywhere returns the keyboard to the selected card", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["First", "Chosen"] }]);
  await page.goto(`/board/${s.boardId}`);
  await master(page, "Chosen").click();

  // Pane background (nothing focusable): Esc, then the arrows work again.
  await pane(page).locator(".due-date-area .detail-row-label").click();
  await expect(master(page, "Chosen")).not.toBeFocused();
  await page.keyboard.press("Escape");
  await expect(master(page, "Chosen")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(paneTitle(page)).toHaveValue("First");

  // Title bar button.
  await page.locator(".board-mode-btn--active").focus();
  await page.keyboard.press("Escape");
  await expect(master(page, "First")).toBeFocused();

  // A pane button (Save).
  await pane(page).locator(".modal-save-btn").focus();
  await page.keyboard.press("Escape");
  await expect(master(page, "First")).toBeFocused();

  // On the card already: Esc keeps it there.
  await page.keyboard.press("Escape");
  await expect(master(page, "First")).toBeFocused();

  // Arrows from nowhere start at the selected card, not the list's first.
  await master(page, "Chosen").click();
  await page.locator(".notes-body").click({ position: { x: 600, y: 5 } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowDown");
  await expect(master(page, "Chosen")).toBeFocused();

  // Dirty: Esc from outside goes through the pane's guard.
  await page.keyboard.press("Enter");
  await page.keyboard.type("draft");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await dialog(page).locator(".btn-cancel").click();
  await expect(editor(page)).toContainText("draft");
});

test("←/→ on the master's add-card trigger switch tabs", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Empty", cards: [] },
    { title: "Full", cards: ["Only"] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await expect(tab(page, "Empty")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  const trigger = page.locator(".notes-master .add-trigger");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Full")).toHaveAttribute("aria-selected", "true");
  await expect(master(page, "Only")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab(page, "Empty")).toHaveAttribute("aria-selected", "true");
  await expect(trigger).toBeFocused();
});

test("master and detail are one surface; the pane doesn't animate; the description fills it", async ({
  page,
  request,
}) => {
  const s = await seed(request, [
    { title: "Inbox", cards: ["Surface", "Other"] },
    { title: "Second", cards: [] },
  ]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/board/${s.boardId}`);
  await expect(pane(page)).toBeVisible();
  const style = (sel: string, prop: string) =>
    page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  // One shadowed surface; the pane and the master list carry none of their own.
  expect(await style(".notes-body", "box-shadow")).not.toBe("none");
  expect(await style(".notes-detail .modal-content", "box-shadow")).toBe("none");
  expect(await style(".notes-master .list", "box-shadow")).toBe("none");
  expect(await style(".notes-detail .modal-content", "border-radius")).toBe("0px");
  // Master column touches the pane: no gap between them.
  const m = await page.locator(".notes-master").boundingBox();
  const d = await page.locator(".notes-detail-slot").boundingBox();
  expect(Math.abs(m!.x + m!.width - d!.x)).toBeLessThan(1);
  // Square under the tabs whichever tab is active; rounded elsewhere.
  expect(await style(".notes-body", "border-top-left-radius")).toBe("0px");
  expect(await style(".notes-body", "border-bottom-left-radius")).not.toBe("0px");
  // Selected card: the plain highlight, no extra bar; focused or not.
  const sel = ".notes-master .card--selected";
  expect(await style(sel, "box-shadow")).not.toContain("inset");
  expect(await style(sel, "background-color")).not.toBe(await style(".notes-master .card:not(.card--selected)", "background-color"));
  await page.locator(sel).focus();
  expect(await style(sel, "box-shadow")).not.toContain("inset");
  // The active tab is the master's colour, so it flows into the column.
  expect(await style(".notes-tab--active", "background-color")).toBe(await style(".notes-master", "background-color"));

  // No slide-in, on mount or on switching cards.
  expect(await style(".notes-detail .modal-content", "animation-name")).toBe("none");
  await master(page, "Other").click();
  await expect(paneTitle(page)).toHaveValue("Other");
  expect(await style(".notes-detail .modal-content", "animation-name")).toBe("none");
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Second")).toHaveAttribute("aria-selected", "true");
  expect(await style(".notes-body", "border-top-left-radius")).toBe("0px");
  await page.keyboard.press("ArrowLeft");

  // The description takes the spare height: the pane ends at the surface's
  // bottom, nothing scrolls, and a taller window goes to the editor.
  const body = await page.locator(".notes-body").boundingBox();
  const content = await page.locator(".notes-detail .modal-content").boundingBox();
  expect(Math.abs(content!.y + content!.height - (body!.y + body!.height))).toBeLessThan(2);
  const modalBody = pane(page).locator(".modal-body");
  expect(await modalBody.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  const h900 = (await editor(page).boundingBox())!.height;
  await page.setViewportSize({ width: 1280, height: 1200 });
  await expect.poll(async () => (await editor(page).boundingBox())!.height).toBeGreaterThan(h900 + 250);
  expect(await modalBody.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);

  // A long description grows the editor and scrolls the body instead.
  await page.setViewportSize({ width: 1280, height: 900 });
  await master(page, "Other").press("Enter");
  for (let i = 0; i < 40; i++) await page.keyboard.press("Enter");
  await page.keyboard.type("last line");
  expect(await modalBody.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Not clipped: the editor holds all of its content.
  expect(await editor(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await expect(editor(page).getByText("last line")).toBeInViewport();
});

test("due date sits left of the labels in the pane, above them in the dialog", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Meta"] }]);
  await page.goto(`/board/${s.boardId}`);
  const due = () => page.locator(".due-date-area").boundingBox();
  const labels = () => page.locator(".card-meta-labels").boundingBox();
  let [d, l] = [await due(), await labels()];
  expect(d!.x + d!.width).toBeLessThanOrEqual(l!.x);
  expect(Math.abs(d!.y - l!.y)).toBeLessThan(2);

  await page.keyboard.press("v");
  await page.locator(".lists-container .card", { hasText: "Meta" }).click();
  await expect(page.locator(".modal-overlay")).toBeVisible();
  [d, l] = [await due(), await labels()];
  expect(d!.y + d!.height).toBeLessThanOrEqual(l!.y);
  // Tab order follows the reading order: due date, then labels.
  expect(
    await page.evaluate(() => {
      const d = document.querySelector(".due-chip")!;
      const l = document.querySelector(".card-meta-labels")!;
      return !!(d.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
});

test("card detail layout, both views: icons left of their sections in one column; long titles end in …", async ({
  page,
  request,
}) => {
  const long = "A card title far too long for the header, so it has to end in an ellipsis when not edited — ".repeat(2).trim();
  const s = await seed(request, [{ title: "Inbox", cards: [long] }]);
  await request.put(`/api/cards/${s.lists[0].cards[0]}`, {
    data: { due_date: "2099-01-01", checklist: [{ id: "x", text: "Step", done: false }] },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/board/${s.boardId}`);

  /// Each section icon is centred on the first line of its content.
  const expectIconsCentred = async (root: string) => {
    const off = await page.locator(`${root} .detail-row`).evaluateAll((rows) =>
      rows.filter((r) => r.querySelector(".detail-row-label svg")!.getBoundingClientRect().height > 0).map((r) => {
        const icon = r.querySelector(".detail-row-label svg")!.getBoundingClientRect();
        const first = [
          ...r.querySelectorAll<HTMLElement>(
            ".due-chip, .label-toggle, .label-new-chip, .ProseMirror-menubar, .checklist-item, .checklist-add-input, .attachment-item, .attachment-upload",
          ),
        ].find((e) => e.getBoundingClientRect().height > 0)!.getBoundingClientRect();
        // Attachment tiles are tall: the icon sits beside their top 30px.
        const line = r.classList.contains("attachments-area") ? first.top + 15 : first.top + first.height / 2;
        return `${r.className}: ${Math.round(Math.abs(icon.top + icon.height / 2 - line))}`;
      }),
    );
    for (const o of off) expect(Number(o.split(": ")[1]), o).toBeLessThanOrEqual(1);
  };

  const check = async (root: string, sections: number) => {
    // The dialog's slide-in scales it: measure once it has settled.
    await page.locator(`${root} .modal-content`).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const rows = page.locator(`${root} .detail-row`);
    // Due date, labels, description, checklist, attachments (once there are any).
    await expect(rows).toHaveCount(sections);
    const icon = await page.locator(`${root} .modal-header-icon svg`).boundingBox();
    expect(icon!.width).toBe(16);
    for (let i = 0; i < sections; i++) {
      // Notes: the description is the page — no icon (see the editor test).
      if (root === ".notes-detail" && (await rows.nth(i).getAttribute("class"))!.includes("description-row")) {
        await expect(rows.nth(i).locator(".detail-row-label")).toBeHidden();
        continue;
      }
      const label = await rows.nth(i).locator(".detail-row-label").boundingBox();
      const body = await rows.nth(i).locator(".detail-row-body").boundingBox();
      const svg = await rows.nth(i).locator(".detail-row-label svg").boundingBox();
      // Left of its content, top-aligned with it.
      expect(label!.x + label!.width).toBeLessThanOrEqual(body!.x);
      expect(Math.abs(label!.y - body!.y)).toBeLessThan(2);
      // Same size and column as the title's card icon (Notes: except the labels,
      // which sit beside the due date).
      expect(svg!.width).toBe(16);
      const beside = root === ".notes-detail" && (await rows.nth(i).getAttribute("class"))!.includes("label-section");
      if (!beside) expect(Math.abs(svg!.x - icon!.x)).toBeLessThan(1);
      await expect(rows.nth(i).locator(".detail-row-label")).toHaveAttribute("title", /\S/);
    }
    await expectIconsCentred(root);
    // Icons alone, no text labels.
    await expect(page.locator(`${root} .detail-row-label`)).toHaveText(Array(sections).fill(""));
    // No hint under the editor (the help has the keys).
    await expect(page.locator(`${root} .editor-hint`)).toHaveCount(0);
    // Without attachments a "+ Attachment" button stands in, in the content column.
    const add = page.locator(`${root} .detail-add-attachment`);
    await expect(add).toHaveCount(sections === 4 ? 1 : 0);
    if (sections === 4) {
      const body = await page.locator(`${root} .checklist-area .detail-row-body`).boundingBox();
      expect(Math.abs((await add.boundingBox())!.x - body!.x)).toBeLessThan(1);
    }
    // Long title: clipped with an ellipsis, from its start, when not being edited.
    const title = page.locator(`${root} .modal-title-input`);
    await title.focus();
    await page.keyboard.press("End");
    await page.locator(`${root} .checklist-area .detail-row-label`).click();
    await expect(title).not.toBeFocused();
    await expect
      .poll(() =>
        title.evaluate((el: HTMLInputElement) => [
          getComputedStyle(el).textOverflow,
          // (Inputs don't report overflow via scrollWidth: measure the text.)
          (() => {
            const ctx = document.createElement("canvas").getContext("2d")!;
            ctx.font = getComputedStyle(el).font;
            return ctx.measureText(el.value).width > el.clientWidth;
          })(),
          el.scrollLeft,
        ]),
      )
      .toEqual(["ellipsis", true, 0]);
    await expect(title).toHaveValue(long);
  };

  await check(".notes-detail", 4);
  // With attachments the section appears; its icon sits beside the first tile.
  await page.locator('.notes-detail input[type="file"]').setInputFiles({
    name: "a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("x"),
  });
  await expect(page.locator(".notes-detail .attachment-item")).toHaveCount(1);
  await expect(page.locator(".notes-detail .detail-add-row")).toHaveCount(0);
  await check(".notes-detail", 5);
  // Notes: due date beside the labels, same row.
  const due = await page.locator(".notes-detail .due-date-area").boundingBox();
  const labels = await page.locator(".notes-detail .label-section").boundingBox();
  expect(Math.abs(due!.y - labels!.y)).toBeLessThan(2);

  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.locator(".lists-container .card").first().click();
  await expect(page.locator(".modal-overlay")).toBeVisible();
  await check(".modal-overlay", 5);
});

test("prose stops at the text measure; tables are centred, code blocks too once wider than it", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Wide"] }]);
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const cell = (t: string, h = false) => ({ type: h ? "table_header" : "table_cell", content: [p(t)] });
  const long = "lorem ipsum dolor sit amet ".repeat(12);
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: long }] },
      p(long),
      {
        type: "table",
        content: [
          { type: "table_row", content: ["Alpha", "Beta", "Gamma", "Delta"].map((t) => cell(`${t} ${long.slice(0, 60)}`, true)) },
          { type: "table_row", content: ["a", "b", "c", "d"].map((t) => cell(t)) },
        ],
      },
      { type: "table", content: [{ type: "table_row", content: [cell("tiny", true)] }] },
      { type: "code_block", content: [{ type: "text", text: "x".repeat(400) }] },
      { type: "code_block", content: [{ type: "text", text: "x".repeat(150) }] },
      { type: "code_block", content: [{ type: "text", text: "short" }] },
    ],
  };
  await request.put(`/api/cards/${s.lists[0].cards[0]}`, { data: { description: JSON.stringify(doc) } });
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto(`/board/${s.boardId}`);
  await expect(editor(page).locator("table").first()).toBeVisible();

  const m = await page.evaluate(() => {
    const pm = document.querySelector<HTMLElement>(".notes-detail .ProseMirror")!;
    const w = (sel: string) => pm.querySelector(sel)!.getBoundingClientRect().width;
    // Out of flow, so it can't wrap with the paragraph's text.
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden";
    probe.textContent = "0".repeat(90);
    pm.querySelector("p")!.appendChild(probe);
    const ch90 = probe.getBoundingClientRect().width;
    probe.remove();
    const tables = pm.querySelectorAll("table");
    const pres = pm.querySelectorAll("pre");
    // Gap left minus gap right inside the editor's content box: 0 = centred.
    const cs = getComputedStyle(pm);
    const box = pm.getBoundingClientRect();
    const left = box.left + parseFloat(cs.paddingLeft);
    const right = box.right - parseFloat(cs.paddingRight) - (pm.offsetWidth - pm.clientWidth);
    const off = (el: Element) => {
      const r = el.getBoundingClientRect();
      return Math.round(r.left - left - (right - r.right));
    };
    const pBox = pm.querySelector("p")!.getBoundingClientRect();
    return {
      pOff: off(pm.querySelector("p")!),
      pLeft: pBox.left,
      tableOffs: [...tables].map(off),
      preOffs: [...pres].map(off),
      midPre: pres[1].getBoundingClientRect().width,
      shortPre: pres[2].getBoundingClientRect(),
      ch90,
      p: w("p"),
      h1: w("h1"),
      wideTable: tables[0].getBoundingClientRect().width,
      tinyTable: tables[1].getBoundingClientRect().width,
      pre: w("pre"),
      content: pm.clientWidth,
    };
  });
  // ~90 characters: CSS `ch` (font metrics) and 90 shaped zeros differ by a
  // percent or two across fonts.
  expect(Math.abs(m.p / m.ch90 - 1)).toBeLessThan(0.03);
  // Headings share the body-text measure, not 90 of their own (wider) ch.
  expect(Math.abs(m.h1 - m.p)).toBeLessThan(2);
  expect(m.wideTable).toBeGreaterThan(m.p + 50);
  // Small tables still start at the measure.
  expect(Math.abs(m.tinyTable - m.p)).toBeLessThan(2);
  expect(m.pre).toBeGreaterThan(m.p + 50);
  expect(m.pre).toBeLessThanOrEqual(m.content);
  // Centred: the text column, every table, every code block.
  for (const o of [m.pOff, ...m.tableOffs, ...m.preOffs]) expect(Math.abs(o)).toBeLessThanOrEqual(2);
  // A code block wider than the measure but narrower than the pane: centred, not at the column's edge.
  expect(m.midPre).toBeGreaterThan(m.p + 50);
  expect(m.midPre).toBeLessThan(m.content - 50);
  // A short one is the column: same edge as the text.
  expect(Math.abs(m.shortPre.left - m.pLeft)).toBeLessThan(2);
  expect(Math.abs(m.shortPre.width - m.p)).toBeLessThan(2);
});

test("the card dialog keeps its layout: full-width tables, text within the dialog", async ({
  page,
  request,
}) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Modal"] }], "kanban");
  const doc = {
    type: "doc",
    content: [{ type: "table", content: [{ type: "table_row", content: [{ type: "table_header", content: [{ type: "paragraph", content: [{ type: "text", text: "t" }] }] }] }] }],
  };
  await request.put(`/api/cards/${s.lists[0].cards[0]}`, { data: { description: JSON.stringify(doc) } });
  await page.goto(`/board/${s.boardId}`);
  await page.locator(".card", { hasText: "Modal" }).click();
  await expect(page.locator(".modal-overlay .ProseMirror table")).toBeVisible();
  const widths = await page.evaluate(() => {
    const pm = document.querySelector<HTMLElement>(".modal-overlay .ProseMirror")!;
    const cs = getComputedStyle(pm);
    return {
      // offsetWidth: the dialog's slide-in transform skews bounding rects.
      table: pm.querySelector("table")!.offsetWidth,
      inner: pm.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    };
  });
  expect(Math.abs(widths.table - widths.inner)).toBeLessThan(2);
  // Save still closes the dialog in Kanban mode.
  await page.locator(".modal-title-input").fill("Modal saved");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
});

test("narrow window stacks the list above the card", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Small"] }]);
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto(`/board/${s.boardId}`);
  await expect(paneTitle(page)).toHaveValue("Small");
  const [m, d] = await Promise.all([
    page.locator(".notes-master").boundingBox(),
    page.locator(".notes-detail-slot").boundingBox(),
  ]);
  expect(d!.y).toBeGreaterThanOrEqual(m!.y + m!.height - 1);
  expect(Math.abs(d!.width - m!.width)).toBeLessThan(2);
});

test("dark mode styles the switch, tabs and banners", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Inbox", cards: ["Dark"] }]);
  await page.emulateMedia({ colorScheme: "dark" }); // theme "system"
  await page.goto(`/board/${s.boardId}`);
  await expect(page.locator("html")).toHaveClass(/theme-dark/);
  const bg = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  // Never the light-mode surfaces on a dark page.
  expect(await bg(".board-mode-btn--active")).not.toBe("rgb(255, 255, 255)");
  expect(await bg(".notes-tab--active")).not.toBe("rgba(241, 242, 244, 0.96)");
  expect(await bg(".notes-body")).not.toBe("rgb(255, 255, 255)");
  expect(await bg(".notes-master")).not.toBe("rgb(244, 245, 247)");
});
