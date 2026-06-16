import { test, expect, type Page, type Locator } from "@playwright/test";

// Scripted walkthrough recorded as video (see playwright.demo.config.ts),
// converted to demo.gif by record-demo.sh. Paced for human viewing: typed
// input uses per-key delay, beats between scenes use pause().

const TYPE_DELAY = 55;

function pause(page: Page, ms = 700) {
  return page.waitForTimeout(ms);
}

async function slowFill(locator: Locator, text: string) {
  await locator.click();
  await locator.pressSequentially(text, { delay: TYPE_DELAY });
}

async function addCard(list: Locator, title: string, page: Page) {
  await list.locator(".add-trigger").click();
  await slowFill(list.locator(".add-form input"), title);
  await list.locator(".add-form input").press("Enter");
  await expect(list.locator(".card", { hasText: title })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function createBoard(page: Page, title: string) {
  await page.locator(".add-board, .empty-state .btn-primary").first().click();
  await slowFill(page.locator(".add-board-form input"), title);
  await page.locator(".add-board-form input").press("Enter");
  await expect(page.locator(".board-card", { hasText: title })).toBeVisible();
  await pause(page, 500);
}

test("record demo", async ({ page }) => {
  // --- Home: create two boards (second one makes the board switcher dock appear) ---
  await page.goto("/");
  await pause(page, 1000);

  await createBoard(page, "Project Phoenix");
  await createBoard(page, "Marketing Sprint");

  const boardCard = page.locator(".board-card", { hasText: "Project Phoenix" });
  await pause(page);
  await boardCard.click();
  await expect(page).toHaveURL(/\/board\/.+/);
  await pause(page, 1000);

  // --- Recolor the board with the free color picker ---
  await page.locator(".board-color-btn").click();
  await pause(page, 500);
  await page.locator(".board-color-input").fill("#6c5ce7");
  await pause(page, 800);
  // Close the dropdown by clicking the board background.
  await page.locator(".board-page").click({ position: { x: 5, y: 5 } });
  await pause(page);

  // --- Lists ---
  for (const title of ["To Do", "In Progress", "Done"]) {
    await page.locator(".add-list-wrapper .add-trigger").click();
    await slowFill(page.locator(".add-list-wrapper .add-form input"), title);
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await expect(page.locator(".list", { hasText: title })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await pause(page);

  // --- Cards ---
  const todo = page.locator(".list", { hasText: "To Do" });
  await addCard(todo, "Design landing page", page);
  await addCard(todo, "Set up CI pipeline", page);
  await addCard(todo, "Write API docs", page);
  await pause(page);

  // --- Labels via drawer ---
  await page.locator(".btn-header-labels").click();
  for (const name of ["Design", "Urgent"]) {
    await slowFill(page.locator(".label-drawer-input"), name);
    await page.locator(".label-drawer-form .btn-primary").click();
    await expect(
      page.locator(".label-drawer-item", { hasText: name })
    ).toBeVisible();
  }
  await pause(page);
  await page.locator(".label-drawer-close").click();
  await pause(page);

  // --- Card detail: description, label, due date, checklist ---
  await page.locator(".card", { hasText: "Design landing page" }).click();
  await expect(page.locator(".modal-title-input")).toBeVisible();
  await pause(page);

  await page.locator(".editor-wrapper .ProseMirror").click();
  await page.keyboard.type("Hero section with product screenshot, then a ", {
    delay: TYPE_DELAY,
  });
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("clear call to action", { delay: TYPE_DELAY });
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(".", { delay: TYPE_DELAY });
  await pause(page);

  await page.locator(".label-add-btn").click();
  await page.locator(".label-picker-item", { hasText: "Design" }).click();
  await pause(page, 400);
  await page.locator(".label-picker-item", { hasText: "Urgent" }).click();
  await pause(page, 400);
  // Inline label creation — define a new label without leaving the card.
  await slowFill(page.locator(".label-create-input"), "Polish");
  await page.locator(".label-create-btn").click();
  await expect(
    page.locator(".label-assigned-chip", { hasText: "Polish" })
  ).toBeVisible();
  await pause(page);
  await page.locator(".label-add-btn").click();
  await pause(page);

  await slowFill(page.locator(".due-date-input"), "2026-07-01");
  await pause(page);

  for (const item of ["Wireframe", "Copywriting", "Responsive layout"]) {
    await slowFill(page.locator(".checklist-add-input"), item);
    await page.locator(".checklist-add-input").press("Enter");
  }
  await page
    .locator(".checklist-item", { hasText: "Wireframe" })
    .locator(".checklist-checkbox")
    .click();
  await pause(page);

  await page.locator(".modal-footer .btn-primary", { hasText: "Save" }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await pause(page);

  // --- Move card across lists (keyboard) ---
  const designCard = page.locator(".card", { hasText: "Design landing page" });
  await designCard.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(
    page
      .locator(".list", { hasText: "In Progress" })
      .locator(".card", { hasText: "Design landing page" })
  ).toBeVisible();
  await pause(page);

  // --- Drag a card with the mouse ---
  const ciCard = page.locator(".card", { hasText: "Set up CI pipeline" });
  const target = page
    .locator(".list")
    .filter({ has: page.locator(".list-title", { hasText: "Done" }) });
  const from = (await ciCard.boundingBox())!;
  const to = (await target.boundingBox())!;
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  // Aim just below the list header — the empty cards-container has ~0 height,
  // so targeting it directly would drop below the list element.
  const endX = to.x + to.width / 2;
  const endY = to.y + 60;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several small moves so the HTML5 drag sequence kicks in and stays visible.
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      startX + ((endX - startX) * i) / 12,
      startY + ((endY - startY) * i) / 12
    );
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await expect(
    page
      .locator(".list", { hasText: "Done" })
      .locator(".card", { hasText: "Set up CI pipeline" })
  ).toBeVisible();
  await pause(page);

  // --- Filter ---
  await page.keyboard.press("f");
  await slowFill(page.locator(".filter-text-input"), "design");
  await expect(page.locator(".card")).toHaveCount(1);
  await pause(page, 1000);
  await page.locator(".filter-input-clear").click();
  await page.keyboard.press("f");
  await pause(page, 1000);

  // --- Board switcher: jump to the other board via the dock, then cycle back ---
  await page
    .locator(".board-dock-dot[aria-current='true'] ~ .board-dock-dot")
    .first()
    .click();
  await expect(page).toHaveURL(/\/board\/.+/);
  await pause(page, 1200);
  // Keyboard cycle back to the previous board.
  await page.keyboard.press(",");
  await pause(page, 1400);
});
