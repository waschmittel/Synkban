import { test, expect, type Page } from "@playwright/test";

/// Measures the WCAG 2.1 contrast ratio of `selector`'s computed text `color`
/// against its effective composited background (walking ancestors and also
/// accounting for `.app-header` / `.board-card` CSS custom properties when a
/// gradient covers `background-color`).
async function measureContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const toRgba = (cssColor: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0, 0, 0, 0)";
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };

    const blend = (
      fg: [number, number, number, number],
      bg: [number, number, number, number],
    ): [number, number, number, number] => {
      const a = fg[3] + bg[3] * (1 - fg[3]);
      if (a === 0) return [255, 255, 255, 1];
      return [
        (fg[0] * fg[3] + bg[0] * bg[3] * (1 - fg[3])) / a,
        (fg[1] * fg[3] + bg[1] * bg[3] * (1 - fg[3])) / a,
        (fg[2] * fg[3] + bg[2] * bg[3] * (1 - fg[3])) / a,
        a,
      ];
    };

    // Walk ancestors from root down to `el`, compositing translucent layers.
    const chain: Element[] = [];
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      chain.push(cur);
    }
    chain.reverse();

    let bg: [number, number, number, number] = [255, 255, 255, 1];
    for (const node of chain) {
      const cs = getComputedStyle(node);
      let layer = toRgba(cs.backgroundColor);
      // `.app-header` layers a dark vertical gradient over `background-color`
      // (`var(--board-color)`). Composite the gradient's midpoint black alpha
      // over `background-color` to approximate the painted surface.
      if (node.classList.contains("app-header")) {
        const base = toRgba(cs.backgroundColor);
        if (base[3] > 0) {
          bg = blend(base, bg);
          const dark = document.documentElement.classList.contains("theme-dark");
          bg = blend([0, 0, 0, dark ? 0.44 : 0.16], bg);
          continue;
        }
      }
      if (layer[3] === 0 && node.classList.contains("board-card")) {
        const m = cs.backgroundImage.match(/(?:oklch|rgb|rgba|color)\([^)]+\)/);
        if (m) layer = toRgba(m[0]);
      }
      if (layer[3] > 0) bg = blend(layer, bg);
    }

    const fgRaw = toRgba(getComputedStyle(el).color);
    const fg = blend(fgRaw, bg);

    const lum = ([r, g, b]: [number, number, number, number]) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };

    const l1 = lum(fg);
    const l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  });
}

test.describe("board color contrast and manual label colors", () => {
  test("extreme board colors keep header, add-list, tabs, and home tiles readable in light and dark mode", async ({
    page,
    request,
  }) => {
    const board = await (
      await request.post("/api/boards", { data: { title: "Contrast Board" } })
    ).json();
    const list = await (
      await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Notes" } })
    ).json();
    await request.post(`/api/lists/${list.id}/cards`, { data: { title: "Sample card" } });

    const extremeColors = ["#ffffff", "#fff59d", "#000000"];

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });

      for (const color of extremeColors) {
        await request.put(`/api/boards/${board.id}`, { data: { color, mode: "notes" } });
        await page.goto(`/board/${board.id}`);
        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/theme-dark/);
        } else {
          await expect(page.locator("html")).not.toHaveClass(/theme-dark/);
        }
        await expect(page.locator(".notes-tabs .add-list-wrapper .add-trigger")).toBeVisible();

        // Header title & buttons: always white ink, still >= 4.5:1 even on #ffffff / #fff59d.
        await expect(page.locator(".app-logo--board")).toHaveCSS("color", "rgba(255, 255, 255, 0.9)");
        await expect.poll(() => measureContrast(page, ".app-logo--board")).toBeGreaterThanOrEqual(4.5);
        await expect.poll(() => measureContrast(page, ".btn-header-shortcuts")).toBeGreaterThanOrEqual(4.5);

        // Notes mode: "Add list" button and active tab
        await expect
          .poll(() => measureContrast(page, ".notes-tabs .add-list-wrapper .add-trigger"))
          .toBeGreaterThanOrEqual(4.5);
        await expect
          .poll(() => measureContrast(page, ".notes-tab--active .notes-tab-btn"))
          .toBeGreaterThanOrEqual(4.5);

        // Kanban mode: "Add another list" button
        await request.put(`/api/boards/${board.id}`, { data: { mode: "kanban" } });
        await page.goto(`/board/${board.id}`);
        await expect(page.locator(".lists-container > .add-list-wrapper .add-trigger")).toBeVisible();
        await expect
          .poll(() => measureContrast(page, ".lists-container > .add-list-wrapper .add-trigger"))
          .toBeGreaterThanOrEqual(4.5);

        // Home page board tile
        await page.goto("/");
        const tile = `.board-card[data-board-id="${board.id}"]`;
        await expect(page.locator(tile)).toBeVisible();
        await expect.poll(() => measureContrast(page, `${tile} .board-card-link`)).toBeGreaterThanOrEqual(4.5);
        await expect.poll(() => measureContrast(page, `${tile} .board-card-meta`)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("label colors can be changed via presets or custom color picker with automatic chip text contrast", async ({
    page,
    request,
  }) => {
    const board = await (
      await request.post("/api/boards", { data: { title: "Label Color Board" } })
    ).json();
    const list = await (
      await request.post(`/api/boards/${board.id}/lists`, { data: { title: "Todo" } })
    ).json();
    const label = await (
      await request.post(`/api/boards/${board.id}/labels`, { data: { name: "Priority" } })
    ).json();
    await request.post(`/api/lists/${list.id}/cards`, {
      data: { title: "Colored card", label_ids: [label.id] },
    });

    await page.goto(`/board/${board.id}`);
    const chip = page.locator(".card .card-label-chip", { hasText: "Priority" });
    await expect(chip).toBeVisible();

    // Open Label Drawer and open the swatch color picker.
    await page.keyboard.press("g");
    const drawer = page.locator(".label-drawer--open");
    await expect(drawer).toBeVisible();

    const swatch = drawer.locator(`.label-drawer-item[data-label-id="${label.id}"] .label-drawer-swatch`);
    await swatch.click();
    const picker = drawer.locator(".label-color-picker");
    await expect(picker).toBeVisible();
    await expect(picker.locator(".label-color-preset")).toHaveCount(12);

    // Escape closes the color picker without closing the Label Drawer.
    await picker.locator(".label-color-preset").first().focus();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(drawer).toBeVisible();

    // Pick a preset swatch ("Sky" = #9bf6ff).
    await swatch.click();
    await expect(picker).toBeVisible();
    await picker.locator('.label-color-preset[title="Sky"]').click();
    await expect(picker).toHaveCount(0);
    await expect(chip).toHaveCSS("background-color", "rgb(155, 246, 255)");
    await expect(chip).toHaveCSS("color", "rgb(0, 0, 0)");

    // Pick a custom dark color (#1d4ed8) -> chip text automatically flips to white.
    await swatch.click();
    const colorInput = picker.locator(".label-color-input");
    await colorInput.fill("#1d4ed8");
    await expect(chip).toHaveCSS("background-color", "rgb(29, 78, 216)");
    await expect(chip).toHaveCSS("color", "rgb(255, 255, 255)");
    expect(await measureContrast(page, ".card .card-label-chip")).toBeGreaterThanOrEqual(4.5);

    // Persists across reload.
    await page.reload();
    await expect(chip).toHaveCSS("background-color", "rgb(29, 78, 216)");
    await expect(chip).toHaveCSS("color", "rgb(255, 255, 255)");
  });
});
