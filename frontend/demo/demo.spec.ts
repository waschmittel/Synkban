import { test, expect, type Page, type Locator } from "@playwright/test";

// Scripted walkthrough recorded as video (see playwright.demo.config.ts),
// converted to demo.gif by record-demo.sh. Paced for human viewing: typed
// input uses per-key delay, beats between scenes use pause().

const TYPE_DELAY = 40;

let wireframePng: Buffer;

function pause(page: Page, ms = 650) {
  return page.waitForTimeout(ms);
}

async function slowFill(locator: Locator, text: string) {
  await locator.click();
  await locator.pressSequentially(text, { delay: TYPE_DELAY });
}

async function createBoard(page: Page, title: string) {
  await page.locator(".add-board, .empty-state .btn-primary").first().click();
  await slowFill(page.locator(".add-board-form input"), title);
  await page.locator(".add-board-form input").press("Enter");
  await expect(page.locator(".board-card", { hasText: title })).toBeVisible();
  await pause(page, 450);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 520, height: 240 },
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  await p.setContent(`
    <!doctype html>
    <html>
      <body style="margin:0;padding:12px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:inline-block;">
        <div id="wireframe" style="width:420px;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;box-sizing:border-box;">
          <div style="background:#4f46e5;color:#fff;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:12px;font-weight:700;letter-spacing:0.02em;">Synkban</span>
            <span style="font-size:10px;opacity:0.88;">Features · Guide · Releases</span>
          </div>
          <div style="padding:14px 16px;display:flex;gap:14px;align-items:center;">
            <div style="flex:1.15;">
              <div style="display:inline-block;background:#eef2ff;color:#4338ca;font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;margin-bottom:6px;">
                LOCAL-FIRST KANBAN &amp; NOTES
              </div>
              <div style="font-size:14px;font-weight:700;color:#0f172a;line-height:1.25;">
                Your boards as plain files.
              </div>
              <div style="font-size:10.5px;color:#64748b;margin-top:5px;line-height:1.4;">
                Sync with Syncthing or Dropbox. Export archival PDFs offline.
              </div>
              <div style="margin-top:9px;display:flex;gap:6px;">
                <span style="background:#4f46e5;color:#fff;font-size:10px;font-weight:600;padding:4px 9px;border-radius:5px;">Download App</span>
                <span style="border:1px solid #cbd5e1;color:#334155;font-size:10px;font-weight:600;padding:4px 9px;border-radius:5px;">User Guide</span>
              </div>
            </div>
            <div style="flex:0.85;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;">
              <div style="background:#fff;border-radius:4px;padding:5px;height:60px;border:1px solid #e2e8f0;">
                <div style="height:5px;width:70%;background:#94a3b8;border-radius:2px;margin-bottom:5px;"></div>
                <div style="height:15px;background:#eef2ff;border-radius:3px;margin-bottom:4px;"></div>
                <div style="height:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;"></div>
              </div>
              <div style="background:#fff;border-radius:4px;padding:5px;height:60px;border:1px solid #e2e8f0;">
                <div style="height:5px;width:80%;background:#94a3b8;border-radius:2px;margin-bottom:5px;"></div>
                <div style="height:18px;background:#fef3c7;border-radius:3px;margin-bottom:4px;"></div>
                <div style="height:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;"></div>
              </div>
              <div style="background:#fff;border-radius:4px;padding:5px;height:60px;border:1px solid #e2e8f0;">
                <div style="height:5px;width:60%;background:#94a3b8;border-radius:2px;margin-bottom:5px;"></div>
                <div style="height:14px;background:#dcfce7;border-radius:3px;"></div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
  wireframePng = await p.locator("#wireframe").screenshot();
  await ctx.close();
});

test("record demo", async ({ page }) => {
  // --- 1. Home: create two boards (second one makes the Board Dock appear) ---
  await page.goto("/");
  await pause(page, 800);

  await createBoard(page, "Product Launch");
  await createBoard(page, "Architecture Notes");

  await page.locator(".board-card", { hasText: "Product Launch" }).click();
  await expect(page).toHaveURL(/\/board\/.+/);
  await pause(page, 700);

  // --- 2. Board colour (auto-derived accent colours) + lists ---
  await page.locator(".board-color-btn").click();
  await pause(page, 400);
  await page.locator(".board-color-input").fill("#4f46e5");
  await pause(page, 650);
  await page.locator(".board-page").click({ position: { x: 5, y: 5 } });
  await pause(page, 450);

  for (const title of ["To Do", "In Progress", "Done"]) {
    await page.locator(".add-list-wrapper .add-trigger").click();
    await slowFill(page.locator(".add-list-wrapper .add-form input"), title);
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await expect(page.locator(".list", { hasText: title })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await pause(page, 450);

  // --- 3. Label Drawer (G): create & reorder labels ---
  await page.keyboard.press("g");
  await expect(page.locator(".label-drawer--open")).toBeVisible();
  for (const name of ["Design", "Priority"]) {
    await slowFill(page.locator(".label-drawer-input"), name);
    await page.locator(".label-drawer-form .btn-primary").click();
    await expect(page.locator(".label-drawer-item", { hasText: name })).toBeVisible();
  }
  await pause(page, 450);
  await page.locator(".label-drawer-item", { hasText: "Priority" }).focus();
  await pause(page, 350);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.locator(".label-drawer-name").first()).toHaveText("Priority");
  await pause(page, 750);
  await page.locator(".label-drawer-close").click();
  await expect(page.locator(".label-drawer--open")).toHaveCount(0);
  await pause(page, 450);

  // --- 4. Quick-add (#label, due:, markdown **title**) ---
  const todo = page.locator(".list", { hasText: "To Do" });
  const quickInput = todo.locator(".add-form input");

  await todo.locator(".add-trigger").click();
  await slowFill(quickInput, "Design **landing page** #design #priority due:fri");
  await expect(todo.locator(".quick-add-preview")).toBeVisible();
  await pause(page, 900);
  await quickInput.press("Enter");
  await expect(todo.locator(".card", { hasText: "Design landing page" })).toBeVisible();

  await todo.locator(".add-trigger").click();
  await slowFill(quickInput, "Set up CI pipeline #devops due:+3d");
  await expect(todo.locator(".quick-add-preview")).toBeVisible();
  await pause(page, 700);
  await quickInput.press("Enter");
  await expect(todo.locator(".card", { hasText: "Set up CI pipeline" })).toBeVisible();

  await todo.locator(".add-trigger").click();
  await slowFill(quickInput, "Write API docs");
  await quickInput.press("Enter");
  await expect(todo.locator(".card", { hasText: "Write API docs" })).toBeVisible();
  await pause(page, 600);

  // --- 5. Card Modal: Editor Menu (Cmd/Ctrl+K), inline image, Matrix + Transpose, Due Picker, Checklist ---
  await page.locator(".card", { hasText: "Design landing page" }).click();
  await expect(page.locator(".modal-title-input")).toBeVisible();
  await pause(page, 500);

  await page.locator(".editor-wrapper .ProseMirror").click();
  await page.keyboard.type("Hero section with ", { delay: TYPE_DELAY });
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type("live preview", { delay: TYPE_DELAY });
  await page.keyboard.press("ControlOrMeta+b");
  await page.keyboard.type(".", { delay: TYPE_DELAY });
  await page.keyboard.press("Enter");

  // Editor Menu -> Image Picker -> upload inline image
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await pause(page, 900);
  await page.keyboard.press("m");
  await expect(page.locator(".image-menu")).toBeVisible();
  await pause(page, 450);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("u");
  await (await chooserPromise).setFiles({
    name: "hero-wireframe.png",
    mimeType: "image/png",
    buffer: wireframePng,
  });
  await expect(page.locator(".editor-wrapper .ProseMirror img.editor-image")).toBeVisible();
  await pause(page, 700);

  // Move below inline image -> insert Matrix -> fill -> Transpose via Editor Menu
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.keyboard.press("x");
  const matrix = page.locator(".editor-wrapper .ProseMirror table[data-matrix]");
  await expect(matrix).toBeVisible();

  const matrixCells = ["Web", "App", "Sync", "Files", "Files", "Offline", "PWA", "Native"];
  for (let i = 0; i < matrixCells.length; i++) {
    await page.keyboard.type(matrixCells[i], { delay: TYPE_DELAY });
    if (i < matrixCells.length - 1) await page.keyboard.press("Tab");
  }
  await pause(page, 550);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await pause(page, 850);
  await page.keyboard.press("x");
  await expect(matrix.locator("th").first()).toHaveText("Sync");
  await pause(page, 850);

  // Embedded Lua block calculation below the matrix
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.keyboard.press("p");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.locator(".table-menu")).toBeVisible();
  await page.keyboard.press("e");
  const luaBlock = page.locator(".editor-wrapper .ProseMirror .lua-block");
  await expect(luaBlock).toBeVisible();
  await luaBlock.scrollIntoViewIfNeeded();
  await page.keyboard.type("local seats = 8 * 19\nreturn seats * 3", { delay: TYPE_DELAY });
  await pause(page, 350);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(luaBlock.locator(".lua-block-output")).toHaveText("=> 456");
  await pause(page, 1000);

  // Keyboard-first Due Date Picker
  const dueChip = page.locator(".modal-content .due-chip");
  await dueChip.scrollIntoViewIfNeeded();
  await dueChip.click();
  await expect(page.locator(".due-picker")).toBeVisible();
  await pause(page, 550);
  const dueInput = page.locator(".due-picker-input");
  await dueInput.fill("");
  await dueInput.pressSequentially("today", { delay: TYPE_DELAY });
  await pause(page, 650);
  await dueInput.press("Enter");
  await expect(page.locator(".due-picker")).toHaveCount(0);
  await expect(dueChip).toContainText(/today/i);
  await pause(page, 450);

  // Checklist + Save (Cmd/Ctrl+S)
  const addChecklistBtn = page.locator(".detail-add-checklist");
  await addChecklistBtn.scrollIntoViewIfNeeded();
  await addChecklistBtn.click();
  const checkInput = page.locator(".checklist-add-input");
  await checkInput.scrollIntoViewIfNeeded();
  for (const item of ["Wireframe", "Responsive layout"]) {
    await slowFill(checkInput, item);
    await checkInput.press("Enter");
  }
  await page
    .locator(".checklist-item", { hasText: "Wireframe" })
    .locator(".checklist-checkbox")
    .click();
  await pause(page, 450);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await pause(page, 550);

  // --- 6. Card History (Cmd/Ctrl+J): make a second save, then inspect diff ---
  await page.locator(".card", { hasText: "Design landing page" }).click();
  await expect(page.locator(".modal-title-input")).toBeVisible();
  await checkInput.scrollIntoViewIfNeeded();
  await slowFill(checkInput, "Launch");
  await checkInput.press("Enter");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await pause(page, 450);

  await page.locator(".card", { hasText: "Design landing page" }).click();
  await expect(page.locator(".modal-title-input")).toBeVisible();
  await page.locator(".modal-footer").getByRole("button", { name: "History" }).click();
  await expect(page.locator(".history-dialog")).toBeVisible();
  await expect(page.locator(".history-item").first()).toBeVisible();
  await pause(page, 950);
  await page.keyboard.press("ArrowDown");
  await pause(page, 950);
  await page.keyboard.press("Escape");
  await expect(page.locator(".history-dialog")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  await pause(page, 550);

  // --- 7. Kanban moves: keyboard Shift+ArrowRight, mouse drag, and collapse list (C) ---
  const designCard = page.locator(".card", { hasText: "Design landing page" });
  await designCard.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(
    page.locator(".list", { hasText: "In Progress" }).locator(".card", { hasText: "Design landing page" }),
  ).toBeVisible();
  await pause(page, 500);

  const ciCard = page.locator(".card", { hasText: "Set up CI pipeline" });
  const doneList = page.locator(".list", { hasText: "Done" });
  const from = (await ciCard.boundingBox())!;
  const to = (await doneList.boundingBox())!;
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  const endX = to.x + to.width / 2;
  const endY = to.y + 60;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      startX + ((endX - startX) * i) / 12,
      startY + ((endY - startY) * i) / 12,
    );
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
  await expect(doneList.locator(".card", { hasText: "Set up CI pipeline" })).toBeVisible();
  await pause(page, 450);

  await doneList.locator(".card", { hasText: "Set up CI pipeline" }).focus();
  await page.keyboard.press("c");
  await expect(doneList).toHaveClass(/list--collapsed/);
  await pause(page, 850);

  // --- 8. Filter Bar: This week + Priority ---
  await page.keyboard.press("f");
  await expect(page.locator(".filter-bar")).toBeVisible();
  await page.locator(".filter-due-chip", { hasText: "This week" }).click();
  await pause(page, 450);
  await page.locator(".filter-label-chip", { hasText: "Priority" }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await pause(page, 850);
  await page.locator(".filter-input-clear").click();
  await page.locator(".board-filter-btn").click();
  await expect(page.locator(".filter-bar")).toHaveCount(0);
  await pause(page, 450);

  // --- 9. Notes Mode (V) + Contextual Shortcut Help (?) ---
  await page.locator(".card", { hasText: "Design landing page" }).focus();
  await page.keyboard.press("v");
  await expect(page.locator(".notes-view")).toBeVisible();
  await page.locator(".notes-tab", { hasText: "In Progress" }).click();
  await expect(page.locator(".notes-detail .ProseMirror img.editor-image")).toBeVisible();
  await pause(page, 1150);

  await page.locator(".notes-tab", { hasText: "To Do" }).click();
  await pause(page, 600);
  await page.locator(".notes-tab", { hasText: "In Progress" }).click();
  await pause(page, 500);

  await page.locator(".notes-master .card--selected").focus();
  await page.keyboard.press("?");
  await expect(page.locator(".shortcut-help-modal")).toBeVisible();
  await pause(page, 900);
  await page.keyboard.press("Escape");
  await expect(page.locator(".shortcut-help-overlay")).toHaveCount(0);
  await pause(page, 450);

  // --- 10. Board Dock switching + Dark Mode + Board Overview stats ---
  await page.locator(".board-dock-dot:not(.board-dock-dot--active)").first().click();
  await expect(page).toHaveURL(/\/board\/.+/);
  await expect(page.getByRole("banner").getByRole("button", { name: "Architecture Notes" })).toBeVisible();
  await pause(page, 650);
  await page.keyboard.press(",");
  await expect(page.getByRole("banner").getByRole("button", { name: "Product Launch" })).toBeVisible();
  await pause(page, 650);

  await page.locator(".btn-header-settings").click();
  await expect(page.locator(".settings-dialog")).toBeVisible();
  await pause(page, 450);
  await page.getByRole("radio", { name: /Dark/ }).check();
  await pause(page, 850);
  await page.locator(".settings-dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".settings-overlay")).toHaveCount(0);
  await pause(page, 1100);

  await page.locator(".app-logo-home").click();
  await expect(page.locator(".home")).toBeVisible();
  await pause(page, 1100);
});
