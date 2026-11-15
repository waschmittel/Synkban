import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { DRAFTS_PORT } from "../playwright.config";

// ADR-0024: crash safety for the one open card. Its unsaved edits are the
// single draft; starting the app reopens them, unless the card changed since.
// Own server, serial: the draft is one per machine.
test.use({ baseURL: `http://127.0.0.1:${DRAFTS_PORT}` });
test.describe.configure({ mode: "serial" });

async function seed(request: APIRequestContext, mode: "kanban" | "notes", title = `Drafts ${mode}`) {
  const board = await (await request.post("/api/boards", { data: { title } })).json();
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })).json();
  const card = await (await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Draft me" } })).json();
  const other = await (await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Other" } })).json();
  await request.put(`/api/boards/${board.id}`, { data: { mode } });
  return { boardId: board.id as string, cardId: card.id as string, otherId: other.id as string };
}

type Draft = { card_id: string; board_id: string; draft: { title: string } } | null;
const draft = async (request: APIRequestContext): Promise<Draft> => (await request.get("/api/draft")).json();
const root = (page: Page, mode: string) => page.locator(mode === "kanban" ? ".modal-overlay" : ".notes-detail");

async function openCard(page: Page, mode: string, title: string) {
  if (mode === "kanban") await page.locator(".card", { hasText: title }).click();
  else await page.locator(".notes-master .card", { hasText: title }).click();
}

/// Edit title and description until the draft is stored, then "crash": close
/// the page without unload handlers. Returns a fresh page.
async function editAndCrash(page: Page, mode: string, request: APIRequestContext, s: { boardId: string; cardId: string }) {
  await page.goto(`/board/${s.boardId}`);
  await openCard(page, mode, "Draft me");
  await root(page, mode).locator(".modal-title-input").fill("Draft me, edited");
  await root(page, mode).locator(".editor-wrapper .ProseMirror").click();
  await page.keyboard.type("Half-written thought");
  await expect.poll(async () => (await draft(request))?.draft.title).toBe("Draft me, edited");
  expect((await draft(request))!.card_id).toBe(s.cardId);
  const next = await page.context().newPage();
  await page.close();
  return next;
}

test.beforeEach(async ({ request }) => {
  const d = await draft(request);
  if (d) await request.delete(`/api/draft/${d.card_id}`);
});

for (const mode of ["kanban", "notes"] as const) {
  test(`${mode}: starting the app after a crash reopens the card with its edits; Save clears the draft`, async ({ page, request }) => {
    const s = await seed(request, mode);
    const next = await editAndCrash(page, mode, request, s);
    // App start ("/") goes to the draft's board, whatever the startup view.
    await next.goto("/");
    await expect(next).toHaveURL(`/board/${s.boardId}`);
    const r = root(next, mode);
    await expect(r.locator(".modal-title-input")).toHaveValue("Draft me, edited");
    await expect(r.locator(".editor-wrapper .ProseMirror")).toContainText("Half-written thought");
    await expect(r.locator(".draft-banner")).toContainText("Restored your unsaved edits");
    await expect(r.locator(".modal-save-btn")).toHaveClass(/btn-primary/);
    await expect(r.locator(".modal-header-icon .dirty-dot")).toBeVisible();
    await r.locator(".modal-save-btn").click();
    await expect.poll(() => draft(request)).toBeNull();
    const card = (await (await request.get(`/api/boards/${s.boardId}`)).json()).lists[0].cards.find(
      (c: { id: string }) => c.id === s.cardId,
    );
    expect(card.title).toBe("Draft me, edited");
    expect(card.description_text).toContain("Half-written thought");
  });

  test(`${mode}: a draft is dropped when the card changed elsewhere meanwhile`, async ({ page, request }) => {
    const s = await seed(request, mode);
    const next = await editAndCrash(page, mode, request, s);
    await request.put(`/api/cards/${s.cardId}`, { data: { title: "Changed by someone else" } });
    await next.goto("/");
    await expect(next.locator(".card", { hasText: "Changed by someone else" })).toBeVisible();
    await expect.poll(() => draft(request)).toBeNull();
    await expect(next.locator(".draft-banner")).toHaveCount(0);
    if (mode === "kanban") await expect(next.locator(".modal-overlay")).toHaveCount(0);
    else await expect(root(next, mode).locator(".modal-title-input")).not.toHaveValue("Draft me, edited");
  });

  test(`${mode}: Discard on the restored edits goes back to the stored card`, async ({ page, request }) => {
    const s = await seed(request, mode);
    const next = await editAndCrash(page, mode, request, s);
    await next.goto("/");
    const r = root(next, mode);
    await r.locator(".draft-banner button", { hasText: "Discard" }).click();
    await expect(r.locator(".modal-title-input")).toHaveValue("Draft me");
    await expect(r.locator(".editor-wrapper .ProseMirror")).not.toContainText("Half-written");
    await expect(r.locator(".draft-banner")).toHaveCount(0);
    await expect(r.locator(".modal-save-btn")).toHaveClass(/btn-quiet/);
    await expect.poll(() => draft(request)).toBeNull();
  });
}

test("there is only ever one draft: the open card's", async ({ page, request }) => {
  const s = await seed(request, "notes", "One draft");
  await page.goto(`/board/${s.boardId}`);
  await openCard(page, "notes", "Draft me");
  const title = root(page, "notes").locator(".modal-title-input");
  await title.fill("A edited");
  await expect.poll(async () => (await draft(request))?.card_id).toBe(s.cardId);
  // Leaving the card (Save) ends its draft; the next card's edits are the draft.
  await root(page, "notes").locator(".modal-save-btn").click();
  await expect.poll(() => draft(request)).toBeNull();
  await openCard(page, "notes", "Other");
  await root(page, "notes").locator(".modal-title-input").fill("B edited");
  await expect.poll(async () => (await draft(request))?.card_id).toBe(s.otherId);
  // Another card's id can't drop it; a new card's draft replaces it.
  expect((await request.delete(`/api/draft/${s.cardId}`)).status()).toBe(204);
  expect((await draft(request))?.card_id).toBe(s.otherId);
  await request.put(`/api/draft/${s.cardId}`, { data: { board_id: s.boardId, base: {}, draft: {}, saved_at: 1 } });
  expect((await draft(request))?.card_id).toBe(s.cardId);
});

test("typing an edit back to the stored text drops the draft; closing the dialog via Discard too", async ({ page, request }) => {
  const s = await seed(request, "kanban", "Back and forth");
  await page.goto(`/board/${s.boardId}`);
  await openCard(page, "kanban", "Draft me");
  const title = page.locator(".modal-title-input");
  await title.fill("Draft me!");
  await expect.poll(() => draft(request)).not.toBeNull();
  await title.fill("Draft me");
  await expect.poll(() => draft(request)).toBeNull();
  await title.fill("Draft me?");
  await expect.poll(() => draft(request)).not.toBeNull();
  await page.keyboard.press("Escape");
  await page.locator(".unsaved-dialog .btn", { hasText: "Discard" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await expect.poll(() => draft(request)).toBeNull();
});

test("only app start follows the draft: a board URL stays; a gone board drops it", async ({ page, request }) => {
  const s = await seed(request, "kanban", "Has draft");
  const elsewhere = await seed(request, "kanban", "Elsewhere");
  const next = await editAndCrash(page, "kanban", request, s);
  await next.goto(`/board/${elsewhere.boardId}`);
  await expect(next.locator(".app-logo--board")).toHaveText("Elsewhere");
  await expect(next.locator(".modal-overlay")).toHaveCount(0);
  expect((await draft(request))?.card_id).toBe(s.cardId);

  await request.put(`/api/boards/${s.boardId}`, { data: { archived: true } });
  await next.goto("/");
  await expect(next).toHaveURL("/");
  await expect(next.locator(".board-card").first()).toBeVisible();
  await expect.poll(() => draft(request)).toBeNull();
});

test("the draft API rejects unsafe ids", async ({ request }) => {
  expect((await request.put("/api/draft/..%2Fevil", { data: {} })).status()).toBe(400);
  expect((await request.put("/api/draft/ok-id", { data: [1] })).status()).toBe(400);
  expect((await request.delete("/api/draft/missing-id")).status()).toBe(204);
  expect(await draft(request)).toBeNull();
});
