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
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Editor card" } })
  ).json();
  await page.goto(`/board/${board.id}`);
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await page.locator(".editor-wrapper .ProseMirror").click();
  return { board, list, card };
}

const editor = (page: Page) => page.locator(".editor-wrapper .ProseMirror");
const insertDropdown = (page: Page) => page.locator(".ProseMirror-menu-dropdown.insert-dropdown");
const settle = (page: Page) => page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

test("highlights: split button, compact swatch popover, Accel+K H default toggle, Accel+K G color picker, and persist", async ({
  page,
  request,
}) => {
  const { board, card } = await openEditor(page, request, "Highlights E2E");

  await page.keyboard.type("important phrase");
  // Select "phrase" (6 chars from end) and wait for ProseMirror's selectionchange sync.
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await settle(page);

  // Split button left click applies default last-used color (yellow).
  await page.locator(".highlight-split-action").click();
  await expect(editor(page).locator('mark[data-highlight="yellow"]')).toHaveText("phrase");

  // Clicking the split button left half again while highlighted removes it.
  await page.locator(".highlight-split-action").click();
  await expect(editor(page).locator("mark[data-highlight]")).toHaveCount(0);

  // Right chevron opens compact swatch popover (no color names, no <kbd> hints).
  await page.locator(".highlight-split-chevron").click();
  const popover = page.locator(".highlight-swatch-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator("kbd")).toHaveCount(0);
  await expect(popover).toHaveText("");
  await expect(popover.locator("[data-highlight-color]")).toHaveCount(8);

  // Pick Blue from the compact popover -> applies Blue and updates last-used color.
  await popover.locator('[data-highlight-color="blue"]').click();
  await expect(popover).toHaveCount(0);
  await expect(editor(page).locator('mark[data-highlight="blue"]')).toHaveText("phrase");

  // Save and verify persistence across reload.
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(async () => {
      const b = await (await request.get(`/api/boards/${board.id}`)).json();
      return b.lists[0].cards[0].description;
    })
    .toContain('"type":"highlight"');

  await page.reload();
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await expect(editor(page).locator('mark[data-highlight="blue"]')).toHaveText("phrase");

  // Place caret inside the highlighted word (collapsed cursor, no selection):
  // Accel+K -> H removes the highlight from the word under the cursor.
  await editor(page).locator('mark[data-highlight="blue"]').click();
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Remove highlight" })).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.locator(".table-menu")).toHaveCount(0);
  await expect(editor(page).locator("mark[data-highlight]")).toHaveCount(0);

  // Select "important" and use Accel+K -> G (full color picker with names & 1–8 hints) -> 7 (Green).
  await editor(page).evaluate((pm) => {
    const textNode = pm.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 9);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Highlight color…" })).toBeVisible();
  await page.keyboard.press("g");
  await expect(page.locator(".highlight-menu")).toBeVisible();
  await expect(page.locator(".highlight-menu kbd").first()).toBeVisible();
  await page.keyboard.press("7");
  await expect(page.locator(".highlight-menu")).toHaveCount(0);
  await expect(editor(page).locator('mark[data-highlight="green"]')).toHaveText("important");

  // Last-used color is now green: selecting "phrase" and pressing Accel+K -> H applies green.
  await editor(page).evaluate((pm) => {
    const p = pm.querySelector("p")!;
    const tail = p.lastChild!;
    const range = document.createRange();
    range.setStart(tail, 1);
    range.setEnd(tail, 7);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("h");
  await expect(editor(page).locator('mark[data-highlight="green"]')).toHaveText(["important", "phrase"]);

  // Verify no markdown input rule fires for ==text==.
  await page.keyboard.press("End");
  await page.keyboard.type(" ==literal==");
  await expect(editor(page)).toContainText("==literal==");

  // PDF export returns valid PDF.
  await page.keyboard.press("ControlOrMeta+s");
  const pdfResp = await request.get(`/api/cards/${card.id}/pdf`);
  expect(pdfResp.status()).toBe(200);
  expect(pdfResp.headers()["content-type"]).toContain("application/pdf");
});

test("alerts: insert via Accel+K and Insert menu, switch kinds, escape, remove, and persist", async ({
  page,
  request,
}) => {
  const { board, card } = await openEditor(page, request, "Alerts E2E");

  // Typing markdown syntax does NOT trigger any input rule.
  await page.keyboard.type("[!note] literal text");
  await expect(editor(page).locator(".editor-alert")).toHaveCount(0);

  // Convert current paragraph into a Warning alert via Accel+K -> A -> W.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Insert alert…" })).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.locator(".alert-menu")).toBeVisible();
  await page.keyboard.press("w");
  await expect(page.locator(".alert-menu")).toHaveCount(0);

  const alertEl = editor(page).locator('.editor-alert[data-alert="warning"]');
  await expect(alertEl).toBeVisible();
  await expect(alertEl.locator(".editor-alert-title")).toHaveText("Warning");
  await expect(alertEl.locator(".editor-alert-body")).toContainText("[!note] literal text");

  // Switch kind by clicking the alert header badge -> Caution.
  await alertEl.locator(".editor-alert-badge").click();
  await expect(page.locator(".alert-menu")).toBeVisible();
  await page.locator('.alert-menu [data-alert-kind="caution"]').click();
  await expect(page.locator(".alert-menu")).toHaveCount(0);
  await expect(editor(page).locator('.editor-alert[data-alert="caution"] .editor-alert-title')).toHaveText("Caution");

  // Escape below via Accel+K -> P and insert a second alert via Insert menu -> Alert -> Tip.
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("p");
  await insertDropdown(page).click();
  await page.locator(".insert-alert-btn").click();
  await expect(page.locator(".alert-menu")).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.locator(".alert-menu")).toHaveCount(0);
  await page.keyboard.type("Helpful tip");
  await expect(editor(page).locator('.editor-alert[data-alert="tip"] .editor-alert-body')).toContainText("Helpful tip");

  // Save and verify persistence + PDF export.
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(async () => {
      const b = await (await request.get(`/api/boards/${board.id}`)).json();
      return b.lists[0].cards[0].description;
    })
    .toContain('"type":"alert"');

  const pdfResp = await request.get(`/api/cards/${card.id}/pdf`);
  expect(pdfResp.status()).toBe(200);
  expect(pdfResp.headers()["content-type"]).toContain("application/pdf");

  // Reload and verify both alerts survived.
  await page.reload();
  await page.locator(".card", { hasText: "Editor card" }).click();
  await expect(page.locator(".modal-title-input")).toBeFocused();
  await expect(editor(page).locator('.editor-alert[data-alert="caution"]')).toBeVisible();
  await expect(editor(page).locator('.editor-alert[data-alert="tip"]')).toBeVisible();

  // Remove the Tip alert via Accel+K -> A -> X (unwraps content).
  await editor(page).locator('.editor-alert[data-alert="tip"] .editor-alert-body p').click();
  await settle(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu-item", { hasText: "Change alert…" })).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.locator(".alert-menu")).toBeVisible();
  await page.keyboard.press("x");
  await expect(page.locator(".alert-menu")).toHaveCount(0);
  await expect(editor(page).locator('.editor-alert[data-alert="tip"]')).toHaveCount(0);
  await expect(editor(page)).toContainText("Helpful tip");
});

test("alerts in Notes mode are centred and aligned in width and position with prose", async ({
  page,
  request,
}) => {
  const board = await (await request.post("/api/boards", { data: { title: "Alert Measure Notes" } })).json();
  await request.put(`/api/boards/${board.id}`, { data: { mode: "notes" } });
  const list = await (
    await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Notes" } })
  ).json();
  const card = await (
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Aligned alert" } })
  ).json();
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Reference prose paragraph." }] },
      {
        type: "alert",
        attrs: { kind: "important" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Centred alert content." }] }],
      },
    ],
  };
  await request.put(`/api/cards/${card.id}`, { data: { description: JSON.stringify(doc) } });

  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto(`/board/${board.id}`);
  await expect(editor(page).locator('.editor-alert[data-alert="important"]')).toBeVisible();

  const metrics = await page.evaluate(() => {
    const pm = document.querySelector<HTMLElement>(".notes-detail .ProseMirror")!;
    const p = pm.querySelector(":scope > p")!.getBoundingClientRect();
    const alert = pm.querySelector(":scope > .editor-alert")!.getBoundingClientRect();
    const cs = getComputedStyle(pm);
    const box = pm.getBoundingClientRect();
    const contentLeft = box.left + parseFloat(cs.paddingLeft);
    const contentRight = box.right - parseFloat(cs.paddingRight) - (pm.offsetWidth - pm.clientWidth);
    const alertCenterOffset = Math.round(alert.left - contentLeft - (contentRight - alert.right));
    return {
      pLeft: p.left,
      pWidth: p.width,
      alertLeft: alert.left,
      alertWidth: alert.width,
      alertCenterOffset,
    };
  });

  expect(Math.abs(metrics.alertLeft - metrics.pLeft)).toBeLessThan(2);
  expect(Math.abs(metrics.alertWidth - metrics.pWidth)).toBeLessThan(2);
  expect(Math.abs(metrics.alertCenterOffset)).toBeLessThanOrEqual(2);
});

test("highlighting part of a word does not change text position or dimensions", async ({
  page,
  request,
}) => {
  await openEditor(page, request, "Highlight Geometry E2E");
  await page.keyboard.type("highlighting stays steady");
  await settle(page);

  const measureParagraphText = () =>
    editor(page).evaluate((pm) => {
      const p = pm.querySelector("p")!;
      const range = document.createRange();
      range.selectNodeContents(p);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });

  const before = await measureParagraphText();

  // Select "light" in the middle of "highlighting" (indices 4..9).
  await editor(page).evaluate((pm) => {
    const textNode = pm.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 9);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await settle(page);

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("g");
  await expect(page.locator(".highlight-menu")).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.locator(".highlight-menu")).toHaveCount(0);

  const mark = editor(page).locator('mark[data-highlight="yellow"]');
  await expect(mark).toHaveText("light");

  const styles = await mark.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      marginLeft: cs.marginLeft,
      marginRight: cs.marginRight,
    };
  });
  expect(styles).toEqual({
    paddingLeft: "0px",
    paddingRight: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    marginLeft: "0px",
    marginRight: "0px",
  });

  const after = await measureParagraphText();
  expect(Math.abs(after.left - before.left)).toBeLessThan(0.5);
  expect(Math.abs(after.right - before.right)).toBeLessThan(0.5);
  expect(Math.abs(after.width - before.width)).toBeLessThan(0.5);
  expect(Math.abs(after.height - before.height)).toBeLessThan(0.5);
});
