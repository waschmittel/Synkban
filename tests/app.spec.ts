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
    await expect(page.locator(".board-title-bar h2")).toHaveText("My Board");
  });
});

test.describe("Lists", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByText("Create your first board").click();
    await page.locator(".add-board-form input").fill("Board");
    await page.locator(".add-board-form input").press("Enter");
    await page.locator(".board-card-link").click();
    await expect(page.locator(".board-title-bar h2")).toHaveText("Board");
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

  test("delete a card", async ({ page }) => {
    await page.locator(".list .add-trigger").click();
    await page.locator(".list .add-form input").fill("Temp Card");
    await page.locator(".list .add-form input").press("Enter");
    await expect(page.locator(".card-title")).toHaveCount(1);

    await page.locator(".card").hover();
    await page.locator(".card-delete").click();
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
