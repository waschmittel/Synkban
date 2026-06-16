import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { touchDrag } from "./touchHelpers";

// The e2e backend is shared across spec files running in parallel, so other
// boards may exist. Scope every assertion to the ids this test created by
// reading their relative order out of the home grid.
async function makeBoards(request: APIRequestContext, titles: string[]) {
  const ids: string[] = [];
  for (const title of titles) {
    const b = await (await request.post("/api/boards", { data: { title } })).json();
    ids.push(b.id);
  }
  return ids;
}

async function relativeOrder(page: Page, ids: string[]): Promise<string[]> {
  const all = await page
    .locator(".board-card[data-board-id]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-board-id")));
  return all.filter((id): id is string => !!id && ids.includes(id));
}

// Reorder is optimistic — the UI shows the new order while the PUT is still in
// flight. Poll the backend so we don't reload before it persists.
async function persistedOrder(
  request: APIRequestContext,
  ids: string[]
): Promise<string[]> {
  const all = await (await request.get("/api/boards")).json();
  return all.map((b: { id: string }) => b.id).filter((id: string) => ids.includes(id));
}

// Dispatch a full HTML5 drag of `srcId` onto the top edge of `tgtId`'s row,
// sharing one DataTransfer across the event sequence so our handlers see the
// same dataTransfer object the browser would supply.
async function dragBoardBeforeTop(page: Page, srcId: string, tgtId: string) {
  await page.evaluate(
    ({ srcId, tgtId }) => {
      const grid = document.querySelector(".board-grid")!;
      const src = document.querySelector(`.board-card[data-board-id="${srcId}"]`)!;
      const tgt = document.querySelector(`.board-card[data-board-id="${tgtId}"]`)!;
      const r = tgt.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + 4;
      const dt = new DataTransfer();
      const fire = (el: Element, type: string) =>
        el.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y })
        );
      fire(src, "dragstart");
      fire(grid, "dragover");
      fire(grid, "drop");
      fire(src, "dragend");
    },
    { srcId, tgtId }
  );
}

test("keyboard reorder keeps focus across multiple Shift+Arrow steps", async ({
  page,
  request,
}) => {
  const ts = Date.now();
  const [A, B, C] = await makeBoards(request, [
    `kb-A-${ts}`,
    `kb-B-${ts}`,
    `kb-C-${ts}`,
  ]);

  await page.goto("/");
  const cardA = page.locator(`.board-card[data-board-id="${A}"]`);
  await expect(cardA).toBeVisible();
  await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([A, B, C]);

  // Each Shift+ArrowRight moves A one slot toward the end. Keep pressing until
  // A has passed both B and C (subset order [B, C, A]). Looping-until-target
  // (rather than a fixed count) stays correct even when parallel specs append
  // boards to the shared backend mid-test. The regression under test: focus
  // used to drop off A after the FIRST press (the refetch recreated the node),
  // so assert focus survives EVERY step.
  await cardA.focus();
  await expect(cardA).toBeFocused();
  const target = [B, C, A].join();
  for (let i = 0; i < 60; i++) {
    if ((await relativeOrder(page, [A, B, C])).join() === target) break;
    await page.keyboard.press("Shift+ArrowRight");
    await expect(cardA).toBeFocused();
  }

  await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([B, C, A]);
});

test("drag and drop reorders boards and persists", async ({ page, request }) => {
  const ts = Date.now();
  const [A, B, C] = await makeBoards(request, [
    `dnd-A-${ts}`,
    `dnd-B-${ts}`,
    `dnd-C-${ts}`,
  ]);

  await page.goto("/");
  await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([A, B, C]);

  // Drag C onto the top of A's row → insert C before A → order [C, A, B].
  // Drive the native HTML5 sequence by dispatching DragEvents with a shared
  // DataTransfer: synthetic mouse-driven drag of an <a> element is unreliable
  // in headless Chromium (the anchor's built-in link drag fights the test),
  // whereas dispatching exercises the same dragstart→dragover→drop handlers
  // deterministically. Aim at the row's top edge (the drop boundary is the
  // row midpoint, so the centre flip-flops between "before A" and "before B").
  await dragBoardBeforeTop(page, C, A);

  await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([C, A, B]);

  // Wait for the PUT to land, then confirm it survives a reload (page refetches
  // from backend).
  await expect.poll(() => persistedOrder(request, [A, B, C])).toEqual([C, A, B]);
  await page.reload();
  await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([C, A, B]);
});

// Touch reorder of boards lives here (not touch.spec.ts) so it runs serially with
// the mouse board-reorder tests above: PUT /api/boards/order renumbers ALL boards,
// so two board reorders racing on the shared backend would clobber each other.
test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 1400, height: 900 } });

  test("touch drag reorders boards and persists", async ({ page, request }) => {
    const ts = Date.now();
    const [A, B, C] = await makeBoards(request, [`tdnd-A-${ts}`, `tdnd-B-${ts}`, `tdnd-C-${ts}`]);
    await page.goto("/");
    await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([A, B, C]);

    // Long-press C, drag onto the upper part of A (fy < row midpoint 0.5 → insert
    // before A) → [C, A, B]. touchDrag keeps the target mid-viewport.
    await touchDrag(page, `.board-card[data-board-id="${C}"]`, `.board-card[data-board-id="${A}"]`, 0.5, 0.25);

    await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([C, A, B]);
    await expect.poll(() => persistedOrder(request, [A, B, C])).toEqual([C, A, B]);
    await page.reload();
    await expect.poll(() => relativeOrder(page, [A, B, C])).toEqual([C, A, B]);
  });
});
