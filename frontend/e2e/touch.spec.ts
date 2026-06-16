import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { touchDrag } from "./touchHelpers";

// Touch reorder is the native-DnD bridge in src/touchDrag.ts: long-press to arm,
// then move, then release (driven via TouchEvents in touchHelpers.ts). Wide
// viewport so targets are on-screen. Backend is shared across parallel specs, so
// every assertion is scoped to the ids this test created.
//
// NB: the board (Home) touch reorder lives in reorder.spec.ts, not here — see the
// note in touchHelpers.ts about the global board-order renumber race.
test.use({ hasTouch: true, viewport: { width: 1400, height: 900 } });

async function domOrder(page: Page, selector: string, attr: string, ids: string[]) {
  const all = await page
    .locator(selector)
    .evaluateAll((els, a) => els.map((e) => e.getAttribute(a)), attr);
  return all.filter((id): id is string => !!id && ids.includes(id));
}

async function seedListsCards(
  request: APIRequestContext,
  boardTitle: string,
  lists: { title: string; cards: string[] }[]
) {
  const board = await (await request.post("/api/boards", { data: { title: boardTitle } })).json();
  const out: { id: string; cards: { id: string; title: string }[] }[] = [];
  for (const l of lists) {
    const list = await (
      await request.post(`/api/boards/${board.id}/lists`, { data: { title: l.title } })
    ).json();
    const cards: { id: string; title: string }[] = [];
    for (const c of l.cards) {
      const card = await (await request.post(`/api/lists/${list.id}/cards`, { data: { title: c } })).json();
      cards.push({ id: card.id, title: c });
    }
    out.push({ id: list.id, cards });
  }
  return { boardId: board.id, lists: out };
}

async function boardDetail(request: APIRequestContext, boardId: string) {
  return (await request.get(`/api/boards/${boardId}`)).json();
}

test("touch: reorder lists on a board", async ({ page, request }) => {
  const { boardId, lists } = await seedListsCards(request, `t-lists-${Date.now()}`, [
    { title: "L1", cards: [] },
    { title: "L2", cards: [] },
    { title: "L3", cards: [] },
  ]);
  const [L1, L2, L3] = lists.map((l) => l.id);
  await page.goto(`/board/${boardId}`);
  await expect.poll(() => domOrder(page, ".list[data-list-id]", "data-list-id", [L1, L2, L3])).toEqual([L1, L2, L3]);

  // Drag L3 onto the left half of L1 → [L3, L1, L2].
  await touchDrag(page, `.list[data-list-id="${L3}"]`, `.list[data-list-id="${L1}"]`, 0.1, 0.2);

  await expect.poll(() => domOrder(page, ".list[data-list-id]", "data-list-id", [L1, L2, L3])).toEqual([L3, L1, L2]);
  await expect
    .poll(async () => (await boardDetail(request, boardId)).lists.map((l: { id: string }) => l.id))
    .toEqual([L3, L1, L2]);
});

test("touch: reorder cards within a list", async ({ page, request }) => {
  const { boardId, lists } = await seedListsCards(request, `t-cards-${Date.now()}`, [
    { title: "Todo", cards: ["A", "B", "C"] },
  ]);
  const [A, B, C] = lists[0].cards.map((c) => c.id);
  await page.goto(`/board/${boardId}`);
  await expect.poll(() => domOrder(page, ".card[data-card-id]", "data-card-id", [A, B, C])).toEqual([A, B, C]);

  // Drag A to the bottom of C → append → [B, C, A].
  await touchDrag(page, `.card[data-card-id="${A}"]`, `.card[data-card-id="${C}"]`, 0.5, 0.95);

  await expect.poll(() => domOrder(page, ".card[data-card-id]", "data-card-id", [A, B, C])).toEqual([B, C, A]);
  await expect
    .poll(async () => (await boardDetail(request, boardId)).lists[0].cards.map((c: { id: string }) => c.id))
    .toEqual([B, C, A]);
});

test("touch: move a card to another list", async ({ page, request }) => {
  const { boardId, lists } = await seedListsCards(request, `t-move-${Date.now()}`, [
    { title: "Src", cards: ["X"] },
    { title: "Dst", cards: [] },
  ]);
  const X = lists[0].cards[0].id;
  const dstList = lists[1].id;
  await page.goto(`/board/${boardId}`);
  await expect(page.locator(`.list[data-list-id="${dstList}"] .card[data-card-id="${X}"]`)).toHaveCount(0);

  // Drag X into the Dst list body.
  await touchDrag(page, `.card[data-card-id="${X}"]`, `.list[data-list-id="${dstList}"]`, 0.5, 0.5);

  await expect(page.locator(`.list[data-list-id="${dstList}"] .card[data-card-id="${X}"]`)).toHaveCount(1);
  await expect
    .poll(async () => {
      const d = await boardDetail(request, boardId);
      return d.lists.find((l: { id: string }) => l.id === dstList).cards.map((c: { id: string }) => c.id);
    })
    .toEqual([X]);
});
