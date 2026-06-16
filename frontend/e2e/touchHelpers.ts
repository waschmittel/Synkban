import { type Page } from "@playwright/test";

// Drive the touch-drag bridge (src/touchDrag.ts): long-press `srcSel`, then drag
// to a point (fx, fy) inside `dstSel` and release. Shared by touch.spec.ts and
// reorder.spec.ts (the board touch test lives there so it runs serially with the
// mouse board-reorder tests — PUT /api/boards/order renumbers all boards, so two
// board reorders racing on the shared backend would clobber each other).
//
// - Scroll the source into view and keep targets mid-viewport: the shim's edge
//   auto-scroll fires near a viewport edge and would shift the drop.
// - After touchstart, wait for the drag ghost (created when the long-press arms)
//   instead of a fixed delay: the arm timer runs in page context and can be
//   delayed under load, and a move dispatched before it arms is treated as a
//   scroll and cancels the drag. No move is dispatched during the wait.
export async function touchDrag(
  page: Page,
  srcSel: string,
  dstSel: string,
  fx: number,
  fy: number
) {
  await page.locator(srcSel).scrollIntoViewIfNeeded();
  const src = (await page.locator(srcSel).boundingBox())!;
  const dst = (await page.locator(dstSel).boundingBox())!;
  await page.evaluate(
    ({ sel, sx, sy }) => {
      const el = document.querySelector(sel)!;
      (window as unknown as { __td: Element }).__td = el;
      const t = new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy });
      el.dispatchEvent(
        new TouchEvent("touchstart", { touches: [t], changedTouches: [t], bubbles: true, cancelable: true })
      );
    },
    { sel: srcSel, sx: src.x + src.width / 2, sy: src.y + src.height / 2 }
  );
  await page.locator(".touch-drag-ghost").waitFor({ state: "attached", timeout: 2000 });
  await page.evaluate(
    ({ x, y }) => {
      const el = (window as unknown as { __td: Element }).__td;
      const fire = (type: string, touches: boolean) => {
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        document.dispatchEvent(
          new TouchEvent(type, {
            touches: touches ? [t] : [],
            changedTouches: [t],
            bubbles: true,
            cancelable: true,
          })
        );
      };
      fire("touchmove", true);
      fire("touchmove", true);
      fire("touchend", false);
    },
    { x: dst.x + dst.width * fx, y: dst.y + dst.height * fy }
  );
}
