import { test, expect } from "@playwright/test";
import { rm } from "fs/promises";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "test-data");

test.beforeEach(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
});

test.afterAll(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
});

test.describe("Home / Boards", () => {
  test("shows empty state when no boards exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".empty-state")).toBeVisible();
    await expect(page.getByText("No boards yet")).toBeVisible();
  });

  test("create a board from empty state", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    const input = page.locator(".add-board-form input");
    await expect(input).toBeFocused();
    await input.fill("Test Board");
    await input.press("Enter");
    await expect(page.locator(".board-card-link")).toHaveText("Test Board");
  });

  test("create a board from grid button", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board A");
    await page.locator(".add-board-form input").press("Enter");
    await expect(page.locator(".board-card-link")).toHaveCount(1);

    await page.getByText("Create new board").click();
    await page.locator(".add-board-form input").fill("Board B");
    await page.locator(".add-board-form input").press("Enter");
    await expect(page.locator(".board-card-link")).toHaveCount(2);
  });

  test("delete a board", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Doomed Board");
    await page.locator(".add-board-form input").press("Enter");
    await expect(page.locator(".board-card-link")).toHaveCount(1);

    const card = page.locator(".board-card").filter({ has: page.locator(".board-card-link") });
    await card.hover();
    await card.locator(".board-card-delete").click();
    // Archive confirmation dialog
    await expect(page.locator(".unsaved-dialog")).toBeVisible();
    await page.locator(".unsaved-dialog .btn-primary").click();
    await expect(page.locator(".board-card-link")).toHaveCount(0);
  });

  test("cancel board creation with Escape", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await expect(page.locator(".add-board-form input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".empty-state")).toBeVisible();
  });

  test("navigate to board page", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("My Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await expect(page.locator(".app-logo--board")).toHaveText("My Board");
  });
});

test.describe("Lists", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await expect(page.locator(".app-logo--board")).toHaveText("Board");
  });

  test("add a list", async ({ page }) => {
    await page.getByText("Add list").click();
    const input = page.locator(".add-list-wrapper .add-form input");
    await expect(input).toBeFocused();
    await input.fill("To Do");
    await input.press("Enter");
    await expect(page.locator(".list-title")).toHaveText("To Do");
  });

  test("add multiple lists", async ({ page }) => {
    for (const name of ["To Do", "In Progress", "Done"]) {
      await page.getByText("Add list").click();
      const input = page.locator(".add-list-wrapper .add-form input");
      await input.fill(name);
      await input.press("Enter");
    }
    const titles = page.locator(".list-title");
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(0)).toHaveText("To Do");
    await expect(titles.nth(1)).toHaveText("In Progress");
    await expect(titles.nth(2)).toHaveText("Done");
  });

  test("delete a list", async ({ page }) => {
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("Temp");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await expect(page.locator(".list-title")).toHaveCount(1);

    await page.locator(".list-header").hover();
    await page.locator(".list-delete").click();
    await expect(page.locator(".list-title")).toHaveCount(0);
  });
});

test.describe("Cards", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("To Do");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await expect(page.locator(".list-title")).toHaveText("To Do");
  });

  test("add a card", async ({ page }) => {
    await page.locator(".list .add-trigger").click();
    const input = page.locator(".list .add-form input");
    await expect(input).toBeFocused();
    await input.fill("My Task");
    await input.press("Enter");
    await expect(page.locator(".card-title")).toHaveText("My Task");
  });

  test("archive a card", async ({ page }) => {
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Temp Card");
    await page.locator(".list .add-form input").press("Enter");
    await expect(page.locator(".card-title")).toHaveCount(1);

    await page.locator(".card").hover();
    await page.locator(".card-archive").click();
    // Confirm the archive dialog
    await page.locator(".unsaved-dialog .btn-primary").click();
    await expect(page.locator(".card-title")).toHaveCount(0);
  });

  test("add multiple cards", async ({ page }) => {
    for (const title of ["Task 1", "Task 2", "Task 3"]) {
      await page.locator(".list .add-trigger").click();
      await page.locator(".list .add-form input").fill(title);
      await page.locator(".list .add-form input").press("Enter");
    }
    await expect(page.locator(".card-title")).toHaveCount(3);
  });
});

test.describe("Card Detail Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("List");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Card");
    await page.locator(".list .add-form input").press("Enter");
    await expect(page.locator(".card-title")).toHaveText("Card");
  });

  test("open and close modal by clicking card", async ({ page }) => {
    await page.locator(".card").click();
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await expect(page.locator(".modal-title-input")).toHaveValue("Card");
    await page.locator(".modal-close").click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
  });

  test("close modal with Escape", async ({ page }) => {
    await page.locator(".card").click();
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
  });

  test("close modal by clicking overlay", async ({ page }) => {
    await page.locator(".card").click();
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await page.locator(".modal-overlay").click({ position: { x: 10, y: 10 } });
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
  });

  test("edit card title in modal", async ({ page }) => {
    await page.locator(".card").click();
    const titleInput = page.locator(".modal-title-input");
    await titleInput.clear();
    await titleInput.fill("Updated Card");
    await expect(page.locator(".unsaved-indicator")).toBeVisible();
    await page.locator(".btn-primary", { hasText: "Save" }).click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    await expect(page.locator(".card-title")).toHaveText("Updated Card");
  });

  test("ProseMirror editor is present and editable", async ({ page }) => {
    await page.locator(".card").click();
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("Hello world");
    await expect(editor).toContainText("Hello world");
  });

  test("rich text description persists after save", async ({ page }) => {
    await page.locator(".card").click();
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.type("Description text");
    await page.locator(".btn-primary", { hasText: "Save" }).click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();

    await expect(page.locator(".card-badge")).toBeVisible();

    await page.locator(".card").click();
    await expect(page.locator(".ProseMirror")).toContainText("Description text");
  });

  test("Ctrl+Enter saves from modal", async ({ page }) => {
    await page.locator(".card").click();
    const titleInput = page.locator(".modal-title-input");
    await titleInput.clear();
    await titleInput.fill("Ctrl Save Test");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    await expect(page.locator(".card-title")).toHaveText("Ctrl Save Test");
  });

  test("ProseMirror toolbar is visible", async ({ page }) => {
    await page.locator(".card").click();
    await expect(page.locator(".ProseMirror-menubar")).toBeVisible();
  });
});

// --- Keyboard Navigation ---

async function setupBoardWithCards(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByText("Create your first board").click();
  await page.locator(".add-board-form input").fill("Board");
  await page.locator(".add-board-form input").press("Enter");
  await page.locator(".board-card-link").click();
  await expect(page.locator(".app-logo--board")).toHaveText("Board");

  // List A with 3 cards
  await page.getByText("Add list").click();
  await page.locator(".add-list-wrapper .add-form input").fill("List A");
  await page.locator(".add-list-wrapper .add-form input").press("Enter");
  for (const title of ["Card 1", "Card 2", "Card 3"]) {
    await page.locator(".list").nth(0).locator(".add-trigger").click();
    await page.locator(".list").nth(0).locator(".add-form input").fill(title);
    await page.locator(".list").nth(0).locator(".add-form input").press("Enter");
  }

  // List B with 1 card
  await page.getByText("Add list").click();
  await page.locator(".add-list-wrapper .add-form input").fill("List B");
  await page.locator(".add-list-wrapper .add-form input").press("Enter");
  await page.locator(".list").nth(1).locator(".add-trigger").click();
  await page.locator(".list").nth(1).locator(".add-form input").fill("Card B1");
  await page.locator(".list").nth(1).locator(".add-form input").press("Enter");

  await expect(page.locator(".card")).toHaveCount(4);
}

test.describe("Keyboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupBoardWithCards(page);
  });

  test("ArrowDown moves focus to next card", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await expect(page.locator(".list").nth(0).locator(".card").nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".list").nth(0).locator(".card").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".list").nth(0).locator(".card").nth(2)).toBeFocused();
  });

  test("ArrowUp moves focus to previous card", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(2).focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".list").nth(0).locator(".card").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".list").nth(0).locator(".card").nth(0)).toBeFocused();
  });

  test("ArrowDown does not leave list at last card", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(2).focus();
    await page.keyboard.press("ArrowDown");
    // Still on last card in List A (no card below)
    await expect(page.locator(".list").nth(0).locator(".card").nth(2)).toBeFocused();
  });

  test("Enter opens card detail modal", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await expect(page.locator(".modal-title-input")).toHaveValue("Card 1");
  });

  test("Space opens card detail modal", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await page.keyboard.press(" ");
    await expect(page.locator(".modal-overlay")).toBeVisible();
  });

  test("Escape closes modal and restores card focus", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    await expect(page.locator(".list").nth(0).locator(".card").nth(0)).toBeFocused();
  });

  test("Delete archives focused card after confirmation", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await expect(page.locator(".list").nth(0).locator(".card-title").nth(0)).toHaveText("Card 1");
    await page.keyboard.press("Delete");
    // Confirm the archive dialog
    await page.locator(".unsaved-dialog .btn-primary").click();
    await expect(page.locator(".card")).toHaveCount(3);
    await expect(page.locator(".list").nth(0).locator(".card-title").nth(0)).not.toHaveText("Card 1");
  });

  test("ArrowRight jumps to first card in next list", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".list").nth(1).locator(".card").nth(0)).toBeFocused();
  });

  test("ArrowLeft jumps to first card in previous list", async ({ page }) => {
    await page.locator(".list").nth(1).locator(".card").nth(0).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator(".list").nth(0).locator(".card").nth(0)).toBeFocused();
  });

  test("n shortcut adds card to focused card's list", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(0).focus();
    await page.keyboard.press("n");
    await expect(page.locator(".list").nth(0).locator(".add-form input")).toBeVisible();
  });

  test("n shortcut falls back to first list when no card focused", async ({ page }) => {
    // Blur any focused element
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("n");
    await expect(page.locator(".list").nth(0).locator(".add-form input")).toBeVisible();
  });

  test("l shortcut focuses add list form", async ({ page }) => {
    await page.keyboard.press("l");
    await expect(page.locator(".add-list-wrapper .add-form input")).toBeVisible();
    await expect(page.locator(".add-list-wrapper .add-form input")).toBeFocused();
  });

  test("e shortcut opens focused card", async ({ page }) => {
    await page.locator(".list").nth(0).locator(".card").nth(1).focus();
    await page.keyboard.press("e");
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await expect(page.locator(".modal-title-input")).toHaveValue("Card 2");
  });

  test("? shortcut shows shortcut help", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(page.locator(".shortcut-help-overlay")).toBeVisible();
    await expect(page.locator(".shortcut-help-modal")).toBeVisible();
  });

  test("Escape closes shortcut help", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(page.locator(".shortcut-help-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".shortcut-help-overlay")).not.toBeVisible();
  });

  test("header ? button shows shortcut help", async ({ page }) => {
    await page.locator(".btn-header-shortcuts").click();
    await expect(page.locator(".shortcut-help-overlay")).toBeVisible();
  });
});

test.describe("Labels", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("List");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("My Task");
    await page.locator(".list .add-form input").press("Enter");
  });

  test("Labels button appears in header on board page", async ({ page }) => {
    await expect(page.locator(".btn-header-labels")).toBeVisible();
  });

  test("Labels button not visible on home page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".btn-header-labels")).not.toBeVisible();
  });

  test("Labels button opens drawer", async ({ page }) => {
    await page.locator(".btn-header-labels").click();
    await expect(page.locator(".label-drawer")).toHaveClass(/label-drawer--open/);
  });

  test("create a label", async ({ page }) => {
    await page.locator(".btn-header-labels").click();
    await page.locator(".label-drawer-input").fill("Bug");
    await page.locator(".label-drawer-form .btn-primary").click();
    await expect(page.locator(".label-drawer-item")).toBeVisible();
    await expect(page.locator(".label-drawer-name")).toHaveText("Bug");
  });

  test("assign label to card and see chip", async ({ page }) => {
    // Create label
    await page.locator(".btn-header-labels").click();
    await page.locator(".label-drawer-input").fill("Feature");
    await page.locator(".label-drawer-form .btn-primary").click();
    await page.locator(".btn-header-labels").click(); // close drawer

    // Open card detail and assign label
    await page.locator(".card").click();
    await page.locator(".label-add-btn").click();
    await expect(page.locator(".label-picker")).toBeVisible();
    await page.locator(".label-picker-item").click();
    await expect(page.locator(".label-picker-item")).toHaveClass(/label-picker-item--selected/);
    await page.locator(".btn-primary", { hasText: "Save" }).click();

    // Label chip visible on card
    await expect(page.locator(".card-label-chip")).toBeVisible();
    await expect(page.locator(".card-label-chip")).toHaveText("Feature");
  });

  test("delete a label", async ({ page }) => {
    await page.locator(".btn-header-labels").click();
    await page.locator(".label-drawer-input").fill("Temp");
    await page.locator(".label-drawer-form .btn-primary").click();
    await expect(page.locator(".label-drawer-item")).toHaveCount(1);

    await page.locator(".label-drawer-item").hover();
    await page.locator(".label-drawer-delete").click();
    await expect(page.locator(".label-drawer-item")).toHaveCount(0);
  });

  test("rename a label inline", async ({ page }) => {
    await page.locator(".btn-header-labels").click();
    await page.locator(".label-drawer-input").fill("Old Name");
    await page.locator(".label-drawer-form .btn-primary").click();

    await page.locator(".label-drawer-name").click();
    const editInput = page.locator(".label-drawer-edit-input");
    await expect(editInput).toBeFocused();
    await editInput.clear();
    await editInput.fill("New Name");
    await editInput.press("Enter");
    await expect(page.locator(".label-drawer-name")).toHaveText("New Name");
  });
});

test.describe("Home Keyboard", () => {
  test("n shortcut creates new board form", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("A Board");
    await page.locator(".add-board-form input").press("Enter");
    // Now on home with a board — focus outside inputs
    await page.locator(".board-card-link").first().focus();
    await page.keyboard.press("Escape"); // blur
    await page.keyboard.press("n");
    await expect(page.locator(".add-board-form input")).toBeVisible();
  });
});

// --- Drag and drop ---

test.describe("Drag and drop", () => {
  test.beforeEach(async ({ page }) => {
    await setupBoardWithCards(page);
  });

  test("Shift+ArrowDown reorders card within list", async ({ page }) => {
    const firstList = page.locator(".list").nth(0);
    // Initial order: Card 1, Card 2, Card 3
    await expect(firstList.locator(".card-title").nth(0)).toHaveText("Card 1");
    await firstList.locator(".card").nth(0).focus();
    await page.keyboard.press("Shift+ArrowDown");
    // After Shift+ArrowDown on Card 1: order should become Card 2, Card 1, Card 3
    await expect(firstList.locator(".card-title").nth(0)).toHaveText("Card 2");
    await expect(firstList.locator(".card-title").nth(1)).toHaveText("Card 1");
  });

  test("Shift+ArrowRight moves card to next list at same index", async ({ page }) => {
    const listA = page.locator(".list").nth(0);
    const listB = page.locator(".list").nth(1);
    await expect(listA.locator(".card")).toHaveCount(3);
    await expect(listB.locator(".card")).toHaveCount(1);

    await listA.locator(".card").nth(0).focus(); // Card 1 in List A
    await page.keyboard.press("Shift+ArrowRight");

    await expect(listA.locator(".card")).toHaveCount(2);
    await expect(listB.locator(".card")).toHaveCount(2);
    // Card 1 now in List B
    await expect(listB.locator(".card-title").filter({ hasText: "Card 1" })).toHaveCount(1);
  });

  test("drag and drop card reorders within list", async ({ page }) => {
    const firstList = page.locator(".list").nth(0);
    await firstList.locator(".card").nth(0).dragTo(firstList.locator(".card").nth(2));
    // Verify a reorder occurred (Card 1 is no longer first OR a known order results)
    const titles = await firstList.locator(".card-title").allTextContents();
    expect(titles[0]).not.toBe("Card 1");
  });
});

// --- Due date in CardDetail ---

test.describe("Due date", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("List");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Task");
    await page.locator(".list .add-form input").press("Enter");
  });

  test("set due date via text input and save", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".due-date-input").fill("2026-12-31");
    await page.locator(".btn-primary", { hasText: "Save" }).click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    // Badge should appear on card
    await expect(page.locator(".due-badge")).toBeVisible();
    // Reopen, verify persisted
    await page.locator(".card").click();
    await expect(page.locator(".due-date-input")).toHaveValue("2026-12-31");
  });

  test("clear due date with X button", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".due-date-input").fill("2026-06-15");
    await page.locator(".btn-primary", { hasText: "Save" }).click();
    await expect(page.locator(".due-badge")).toBeVisible();

    // Reopen and clear
    await page.locator(".card").click();
    await expect(page.locator(".due-date-clear")).toBeVisible();
    await page.locator(".due-date-clear").click();
    await expect(page.locator(".due-date-input")).toHaveValue("");
    await page.locator(".btn-primary", { hasText: "Save" }).click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    await expect(page.locator(".due-badge")).not.toBeVisible();
  });

  test("d shortcut focuses due date input", async ({ page }) => {
    await page.locator(".card").click();
    // Move focus off any input/contenteditable — Save button is a safe focusable target inside the modal
    await page.locator(".modal-footer .btn-primary").focus();
    await page.keyboard.press("d");
    await expect(page.locator(".due-date-input")).toBeFocused();
  });
});

// --- Attachment upload ---

test.describe("Attachments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("List");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Task");
    await page.locator(".list .add-form input").press("Enter");
  });

  test("upload a file via file input", async ({ page }) => {
    await page.locator(".card").click();
    // Set file on the hidden input nested in .attachment-upload
    const fileInput = page.locator(".attachment-upload input[type=file]");
    await fileInput.setInputFiles({
      name: "hello.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello world"),
    });
    await expect(page.locator(".attachment-item")).toBeVisible();
    await expect(page.locator(".attachment-filename")).toHaveText("hello.txt");
    await expect(page.locator(".attachment-size")).toContainText("B");
  });

  test("delete an uploaded attachment", async ({ page }) => {
    await page.locator(".card").click();
    const fileInput = page.locator(".attachment-upload input[type=file]");
    await fileInput.setInputFiles({
      name: "doomed.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await expect(page.locator(".attachment-item")).toHaveCount(1);
    await page.locator(".attachment-delete").click();
    await expect(page.locator(".attachment-item")).toHaveCount(0);
  });
});

// --- Unsaved changes dialog ---

test.describe("Unsaved changes dialog", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("List");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Card");
    await page.locator(".list .add-form input").press("Enter");
  });

  test("Escape with dirty state shows unsaved dialog", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".modal-title-input").fill("Edited Title");
    await expect(page.locator(".unsaved-indicator")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".unsaved-dialog")).toBeVisible();
    await expect(page.locator(".unsaved-dialog .btn-primary")).toHaveText("Save");
    await expect(page.locator(".unsaved-dialog .btn-danger")).toHaveText("Discard");
  });

  test("Save button in unsaved dialog persists changes", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".modal-title-input").fill("Saved Edit");
    await page.keyboard.press("Escape");
    await page.locator(".unsaved-dialog .btn-primary").click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    await expect(page.locator(".card-title")).toHaveText("Saved Edit");
  });

  test("Discard button drops changes", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".modal-title-input").fill("Discarded Edit");
    await page.keyboard.press("Escape");
    await page.locator(".unsaved-dialog .btn-danger").click();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
    await expect(page.locator(".card-title")).toHaveText("Card");
  });

  test("Cancel button keeps modal open with dirty state", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".modal-title-input").fill("Still Editing");
    await page.keyboard.press("Escape");
    await page.locator(".unsaved-dialog .btn-cancel").click();
    await expect(page.locator(".unsaved-dialog")).not.toBeVisible();
    await expect(page.locator(".modal-overlay")).toBeVisible();
    await expect(page.locator(".modal-title-input")).toHaveValue("Still Editing");
    await expect(page.locator(".unsaved-indicator")).toBeVisible();
  });

  test("close X with clean state does not show dialog", async ({ page }) => {
    await page.locator(".card").click();
    await page.locator(".modal-close").click();
    await expect(page.locator(".unsaved-dialog")).not.toBeVisible();
    await expect(page.locator(".modal-overlay")).not.toBeVisible();
  });
});

// --- List delete with cards confirmation ---

test.describe("List delete with cards", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await page.getByText("Add list").click();
    await page.locator(".add-list-wrapper .add-form input").fill("To Do");
    await page.locator(".add-list-wrapper .add-form input").press("Enter");
  });

  test("empty list deletes without confirmation", async ({ page }) => {
    await page.locator(".list-header").hover();
    await page.locator(".list-delete").click();
    await expect(page.locator(".unsaved-dialog")).not.toBeVisible();
    await expect(page.locator(".list-title")).toHaveCount(0);
  });

  test("list with cards shows confirmation dialog", async ({ page }) => {
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Task 1");
    await page.locator(".list .add-form input").press("Enter");

    await page.locator(".list-header").hover();
    await page.locator(".list-delete").click();
    await expect(page.locator(".unsaved-dialog")).toBeVisible();
    await expect(page.locator(".unsaved-dialog p")).toContainText("archived");
  });

  test("confirming archives cards and removes list", async ({ page }) => {
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Task 1");
    await page.locator(".list .add-form input").press("Enter");

    await page.locator(".list-header").hover();
    await page.locator(".list-delete").click();
    await page.locator(".unsaved-dialog .btn-primary").click();
    await expect(page.locator(".list-title")).toHaveCount(0);

    // Verify the card was archived: open archive panel
    await page.locator(".board-archive-btn").click();
    await expect(page.locator(".archive-card-item")).toHaveCount(1);
    await expect(page.locator(".archive-card-title")).toHaveText("Task 1");
  });

  test("cancel keeps the list intact", async ({ page }) => {
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Task 1");
    await page.locator(".list .add-form input").press("Enter");

    await page.locator(".list-header").hover();
    await page.locator(".list-delete").click();
    await page.locator(".unsaved-dialog .btn-cancel").click();
    await expect(page.locator(".unsaved-dialog")).not.toBeVisible();
    await expect(page.locator(".list-title")).toHaveText("To Do");
    await expect(page.locator(".card-title")).toHaveText("Task 1");
  });
});
