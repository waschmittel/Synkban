import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Quick-add tokens, label merge, due filter, collapsible lists, list counts,
// the Notes editor page, home tiles.

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

async function seed(request: APIRequestContext, lists: { title: string; cards: { title: string; due_date?: string }[] }[]) {
  const board = await (await request.post("/api/boards", { data: { title: "Organize" } })).json();
  const out: { id: string; cards: string[] }[] = [];
  for (const l of lists) {
    const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: l.title } })).json();
    const cards = [];
    for (const c of l.cards) cards.push((await (await request.post(`/api/lists/${list.id}/cards`, { data: c })).json()).id);
    out.push({ id: list.id, cards });
  }
  return { boardId: board.id as string, lists: out };
}

const boardJson = async (request: APIRequestContext, id: string) => (await request.get(`/api/boards/${id}`)).json();
const list = (page: Page, title: string) => page.locator(".lists-container .list", { hasText: title });

test("quick-add: #labels match loosely, unknown ones are created once, due: sets the date", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Todo", cards: [] }]);
  await request.post(`/api/boards/${s.boardId}/labels`, { data: { name: "In Progress" } });
  await page.goto(`/board/${s.boardId}`);
  await list(page, "Todo").locator(".add-trigger").click();
  const input = page.locator(".add-form input");
  await input.fill("Ship it #in-progress #New-Thing #newthing due:+3d");
  // The preview shows what the tokens do.
  const preview = page.locator(".quick-add-preview");
  await expect(preview.locator(".card-label-chip")).toHaveText(["In Progress", "+ New-Thing"]);
  await expect(preview.locator(".due-badge")).toContainText("in 3 days");
  await page.keyboard.press("Enter");
  await expect(page.locator(".card", { hasText: "Ship it" })).toBeVisible();

  const b = await boardJson(request, s.boardId);
  expect(b.labels.map((l: { name: string }) => l.name)).toEqual(["In Progress", "New-Thing"]);
  const card = b.lists[0].cards[0];
  expect(card.title).toBe("Ship it");
  expect(card.label_ids).toEqual(b.labels.map((l: { id: string }) => l.id));
  expect(card.due_date).toBe(inDays(3));
  await expect(page.locator(".card", { hasText: "Ship it" }).locator(".card-label-chip")).toHaveCount(2);

  // Text that only looks like a token stays; tokens alone can't make a card.
  await list(page, "Todo").locator(".add-trigger").click();
  await input.fill("Fix issue #42 due:someday");
  await expect(preview).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator(".card", { hasText: "Fix issue #42 due:someday" })).toBeVisible();
  await list(page, "Todo").locator(".add-trigger").click();
  await input.fill("#in-progress");
  await expect(preview.locator(".quick-add-missing")).toHaveText("Needs a title");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("#in-progress");
  expect((await boardJson(request, s.boardId)).lists[0].cards).toHaveLength(2);
});

test("renaming a label onto another one merges them after asking", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Todo", cards: [{ title: "Tagged" }, { title: "Both" }] }]);
  const bug = await (await request.post(`/api/boards/${s.boardId}/labels`, { data: { name: "Bug" } })).json();
  const defect = await (await request.post(`/api/boards/${s.boardId}/labels`, { data: { name: "Defect" } })).json();
  await request.put(`/api/cards/${s.lists[0].cards[0]}`, { data: { label_ids: [defect.id] } });
  await request.put(`/api/cards/${s.lists[0].cards[1]}`, { data: { label_ids: [bug.id, defect.id] } });
  await page.goto(`/board/${s.boardId}`);
  await page.keyboard.press("g");
  const rename = async (from: string, to: string) => {
    await page.locator(".label-drawer-item", { hasText: from }).locator(".label-drawer-name").click();
    await page.locator(".label-drawer-edit-input").fill(to);
    await page.keyboard.press("Enter");
  };

  // Destructive: red button, Cancel focused — Enter cancels; both stay.
  const dialog = page.locator(".unsaved-dialog");
  await rename("Defect", " b-U-g ");
  await expect(dialog).toContainText("Merge “Defect” into “Bug”? “Defect” is deleted and its 2 cards");
  await expect(dialog).toContainText("can't be undone");
  await expect(dialog.locator(".btn-danger")).toHaveText("Merge labels");
  await expect(dialog.locator(".btn", { hasText: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect((await boardJson(request, s.boardId)).labels).toHaveLength(2);
  // Esc cancels too.
  await rename("Defect", "bug");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect((await boardJson(request, s.boardId)).labels).toHaveLength(2);
  // The server refuses a merge nobody confirmed.
  const raw = await request.put(`/api/labels/${defect.id}`, { data: { name: "bug" } });
  expect(raw.status()).toBe(409);
  expect((await boardJson(request, s.boardId)).labels).toHaveLength(2);

  // Merge: one label left, every card carries it once.
  await rename("Defect", "BUG");
  await dialog.locator(".btn-danger").click();
  await expect(page.locator(".label-drawer-item")).toHaveText(["BUG"]);
  const b = await boardJson(request, s.boardId);
  expect(b.labels).toEqual([{ ...bug, name: "BUG" }]);
  for (const c of b.lists[0].cards) expect(c.label_ids).toEqual([bug.id]);
  await expect(page.locator(".card .card-label-chip")).toHaveText(["BUG", "BUG"]);

  // A plain rename (own spelling variant) asks nothing.
  await rename("BUG", "Bug");
  await expect(page.locator(".label-drawer-item")).toHaveText(["Bug"]);
  await expect(page.locator(".unsaved-dialog")).toHaveCount(0);
});
test("due filter: overdue, this week, until a picked day; combined and remembered", async ({ page, request }) => {
  const s = await seed(request, [
    {
      title: "Todo",
      cards: [
        { title: "Late", due_date: inDays(-10) },
        { title: "Now", due_date: inDays(0) },
        { title: "Far", due_date: inDays(40) },
        { title: "Undated" },
      ],
    },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await page.locator(".board-filter-btn").click();
  const titles = () => page.locator(".lists-container .card .card-title");
  const chip = (t: string) => page.locator(".filter-due-chip", { hasText: t });

  // One segmented control: the three share a track, touching each other.
  const group = page.locator(".filter-due[role=group]");
  await expect(group.locator(".filter-due-chip")).toHaveCount(3);
  const xs = await group.locator(".filter-due-chip").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  for (let i = 1; i < xs.length; i++) {
    expect(Math.abs(xs[i].left - xs[i - 1].right)).toBeLessThan(1);
    expect(Math.abs(xs[i].top - xs[0].top)).toBeLessThan(1);
  }
  // A button group: square inner corners, straight separators, rounded ends.
  const radius = (i: number) =>
    group.locator(".filter-due-chip").nth(i).evaluate((el) => getComputedStyle(el).borderRadius);
  for (const i of [0, 1, 2]) expect(await radius(i)).toBe("0px");
  await expect(group).toHaveCSS("overflow", "hidden");
  expect(parseFloat(await group.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(0);
  for (const i of [1, 2]) await expect(group.locator(".filter-due-chip").nth(i)).toHaveCSS("border-left-style", "solid");
  await chip("Overdue").click();
  await expect(titles()).toHaveText(["Late"]);
  await expect(group.locator("[aria-pressed=true]")).toHaveCount(1);
  // The selected segment fills its cell, top to bottom.
  const [g, c] = await Promise.all([group.boundingBox(), chip("Overdue").boundingBox()]);
  expect(Math.abs(c!.y - g!.y - 1)).toBeLessThan(1);
  expect(Math.abs(c!.y + c!.height - (g!.y + g!.height - 1))).toBeLessThan(1);
  await expect(chip("Overdue")).toHaveAttribute("aria-pressed", "true");
  await expect(list(page, "Todo").locator(".list-count")).toHaveText("1/4");
  await chip("This week").click();
  await expect(chip("Overdue")).toHaveAttribute("aria-pressed", "false");
  await expect(titles()).toContainText(["Now"]);
  await expect(titles()).not.toContainText(["Late", "Far", "Undated"].join(""));
  await chip("This week").click();
  await expect(titles()).toHaveCount(4);

  // Until a day from the picker, typed in: on or before it, overdue included.
  await page.locator(".filter-due-date").click();
  await page.locator(".due-picker-input").fill("+39");
  await page.keyboard.press("Enter");
  await expect(titles()).toHaveText(["Late", "Now"]);
  await expect(page.locator(".filter-due-date")).toContainText("Until ");
  await page.locator(".filter-due-date").click();
  await page.locator(".due-picker-input").fill("+40");
  await page.keyboard.press("Enter");
  await expect(titles()).toHaveText(["Late", "Now", "Far"]);
  await expect(page.locator(".filter-due-date")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".filter-due-date")).toBeFocused();
  // With text: AND.
  await page.locator(".filter-text-input").fill("nothing like it");
  await expect(titles()).toHaveCount(0);
  await page.locator(".filter-text-input").fill("");

  // Remembered per board for the tab session (ADR-0021).
  await page.reload();
  await expect(titles()).toHaveText(["Late", "Now", "Far"]);
  // Clear in the picker.
  await page.locator(".filter-due-date").click();
  await page.locator(".due-picker-clear").click();
  await expect(titles()).toHaveCount(4);
  await expect(page.locator(".filter-due-date")).toHaveText("Until…");
});

test("lists collapse to a strip and back; Add list is the same strip; counts in headers", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "Alpha", cards: [{ title: "A1" }, { title: "A2" }] },
    { title: "Beta with a long name that does not fit the strip", cards: [{ title: "B1" }] },
    { title: "Gamma", cards: [] },
  ]);
  await page.goto(`/board/${s.boardId}`);
  await expect(page.locator(".lists-container .list-header .list-count")).toHaveText(["2", "1", "0"]);
  const beta = list(page, "Beta");

  await beta.locator(".list-collapse").click();
  await expect(beta).toHaveClass(/list--collapsed/);
  await expect(beta.locator(".list-expand")).toBeFocused();
  await expect(beta.locator(".list-count")).toHaveText("1");
  await expect(beta.locator(".card")).toHaveCount(0);
  // Persisted with the list.
  expect((await boardJson(request, s.boardId)).lists[1].collapsed).toBe(true);

  // Strip and closed Add list: same narrow size, title written vertically.
  const strip = (await beta.boundingBox())!;
  const add = (await page.locator(".lists-container > .add-list-wrapper").boundingBox())!;
  expect(strip.width).toBeLessThan(50);
  expect(add.width).toBe(strip.width);
  expect(add.height).toBe(strip.height);
  await expect(beta.locator(".list-expand")).toHaveCSS("writing-mode", "vertical-rl");
  // Opening Add list gives the form its full width; Esc puts the strip back.
  await page.keyboard.press("l");
  await expect(page.locator(".add-list-wrapper .add-form input")).toBeFocused();
  expect((await page.locator(".lists-container > .add-list-wrapper").boundingBox())!.width).toBeGreaterThan(250);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await page.locator(".lists-container > .add-list-wrapper").boundingBox())!.width)
    .toBe(strip.width);

  // Keyboard: ←/→ go through the strip; Shift+→ moves a card onto it (end of list).
  await list(page, "Alpha").locator(".card", { hasText: "A2" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(beta.locator(".list-expand")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(list(page, "Gamma").locator(".add-trigger")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(list(page, "Alpha").locator(".card", { hasText: "A2" })).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(beta.locator(".list-count")).toHaveText("2");
  const b = await boardJson(request, s.boardId);
  expect(b.lists[1].cards.map((c: { title: string }) => c.title)).toEqual(["B1", "A2"]);

  // Drag a card onto the strip.
  await list(page, "Alpha").locator(".card", { hasText: "A1" }).dragTo(beta);
  await expect(beta.locator(".list-count")).toHaveText("3");
  await expect(list(page, "Alpha").locator(".list-header .list-count")).toHaveText("0");

  // C on a focused card collapses its list (focus to the strip); C again expands.
  const gamma = list(page, "Gamma");
  await gamma.locator(".add-trigger").focus();
  await page.keyboard.press("c");
  await expect(gamma).toHaveClass(/list--collapsed/);
  await expect(gamma.locator(".list-expand")).toBeFocused();
  await expect(page.locator(".add-form")).toHaveCount(0); // not "add card" any more
  await page.keyboard.press("c");
  await expect(gamma).not.toHaveClass(/list--collapsed/);
  await expect(gamma.locator(".list-title")).toBeFocused();
  await expect(beta.locator(".list-expand")).toHaveAttribute("title", /\(C\)$/);

  // Enter expands it again, focus on its title.
  await beta.locator(".list-expand").focus();
  await page.keyboard.press("Enter");
  await expect(beta).not.toHaveClass(/list--collapsed/);
  await expect(beta.locator(".list-title")).toBeFocused();
  await expect(beta.locator(".card")).toHaveCount(3);
  expect((await boardJson(request, s.boardId)).lists[1].collapsed).toBe(false);
});

test("Notes ignores collapsing; its description is the page: full width, no border, still yellow, centred measure", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Todo", cards: [{ title: "Note" }] }]);
  await request.put(`/api/lists/${s.lists[0].id}`, { data: { collapsed: true } });
  await request.put(`/api/boards/${s.boardId}`, { data: { mode: "notes" } });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/board/${s.boardId}`);
  await expect(page.locator(".notes-master .card")).toHaveCount(1);
  await expect(page.locator(".list--collapsed")).toHaveCount(0);
  // C does nothing here (lists are tabs).
  await page.locator(".notes-master .card").first().focus();
  await page.keyboard.press("c");
  await expect(page.locator(".list--collapsed")).toHaveCount(0);
  await expect(page.locator(".notes-master .card").first()).toBeFocused();

  const pane = page.locator(".notes-detail");
  await expect(pane.locator(".description-row .detail-row-label")).toBeHidden();
  const wrapper = pane.locator(".description-row .editor-wrapper");
  await expect(wrapper).toHaveCSS("border-top-width", "0px");
  await expect(wrapper).toHaveCSS("background-color", "rgb(255, 251, 230)");
  // As wide as the pane.
  const paneBox = (await pane.locator(".modal-body").boundingBox())!;
  const box = (await wrapper.boundingBox())!;
  expect(Math.abs(box.x - paneBox.x)).toBeLessThan(1);
  expect(Math.abs(box.width - paneBox.width)).toBeLessThan(16); // (scrollbar)

  // Text column: centred, text left-aligned in it.
  await pane.locator(".editor-wrapper .ProseMirror").click();
  await page.keyboard.type("Short line");
  const pm = (await pane.locator(".editor-wrapper .ProseMirror").boundingBox())!;
  const p = pane.locator(".editor-wrapper .ProseMirror > p").first();
  const pBox = (await p.boundingBox())!;
  expect(Math.abs(pBox.x - pm.x - (pm.x + pm.width - (pBox.x + pBox.width)))).toBeLessThan(2);
  expect(pBox.width).toBeLessThan(pm.width - 100);
  await expect(p).toHaveCSS("text-align", /start|left/);
  const range = await p.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().x;
  });
  expect(Math.abs(range - pBox.x)).toBeLessThan(1);
});

test("Export PDF shows a document icon, not a download arrow", async ({ page, request }) => {
  const s = await seed(request, [{ title: "Todo", cards: [{ title: "Doc" }] }]);
  await page.goto(`/board/${s.boardId}`);
  await page.locator(".card").first().click();
  const icon = page.locator(".modal-export-btn svg.pdf-icon");
  await expect(icon).toBeVisible();
  await expect(icon.locator("text")).toHaveText("PDF");
});

test("home tiles show card and overdue counts and the last edit", async ({ page, request }) => {
  const s = await seed(request, [
    { title: "A", cards: [{ title: "late", due_date: inDays(-1) }, { title: "today", due_date: inDays(0) }] },
    { title: "B", cards: [{ title: "x" }] },
  ]);
  const empty = await (await request.post("/api/boards", { data: { title: "Empty tile" } })).json();
  await page.goto("/");
  const tile = page.locator(`.board-card[data-board-id="${s.boardId}"]`);
  await expect(tile.locator(".board-card-count")).toHaveText("3 cards");
  await expect(tile.locator(".board-card-overdue")).toHaveText("1 overdue");
  await expect(tile.locator(".board-card-edited")).toHaveText("Edited just now");
  const none = page.locator(`.board-card[data-board-id="${empty.id}"]`);
  await expect(none.locator(".board-card-count")).toHaveText("0 cards");
  await expect(none.locator(".board-card-overdue")).toHaveCount(0);
});
