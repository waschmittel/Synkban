// Touch → HTML5-drag bridge.
//
// Native HTML5 drag-and-drop never fires from touch input, so boards, lists and
// cards (which all use `dragstart`/`dragover`/`drop` + DataTransfer) can't be
// reordered on a phone/tablet. This shim synthesizes the same native drag events
// from touch gestures, reusing one shared DataTransfer across the sequence, so
// every existing drag handler works unchanged.
//
// Gesture: long-press (~220ms held still) arms a drag — taps and scrolling keep
// working. While dragging, the finger is tracked, a ghost follows it, the element
// under the finger receives synthetic dragenter/dragover, drop fires on release,
// and the viewport auto-scrolls near its edges.

const LONG_PRESS_MS = 220;
const MOVE_CANCEL_PX = 10; // finger movement before arming = scroll, not drag
const EDGE = 48; // auto-scroll trigger zone from each viewport edge
const SCROLL_STEP = 14; // px per frame

export function installTouchDrag(): () => void {
  let source: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let timer: number | null = null;
  let armed = false;
  let dt: DataTransfer | null = null;
  let ghost: HTMLElement | null = null;
  let ghostDX = 0;
  let ghostDY = 0;
  let lastOver: Element | null = null;
  let scrollRAF: number | null = null;
  let scrollVX = 0;
  let scrollVY = 0;
  let scrollVYTarget: HTMLElement | null = null;
  let justDragged = false;

  const fire = (el: Element, type: string, x: number, y: number) =>
    el.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt!, clientX: x, clientY: y })
    );

  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stopAutoScroll = () => {
    if (scrollRAF != null) {
      cancelAnimationFrame(scrollRAF);
      scrollRAF = null;
    }
    scrollVX = 0;
    scrollVY = 0;
    scrollVYTarget = null;
  };

  const reset = () => {
    clearTimer();
    stopAutoScroll();
    armed = false;
    source = null;
    dt = null;
    lastOver = null;
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  };

  const arm = () => {
    if (!source) return;
    armed = true;
    dt = new DataTransfer();
    const x = startX;
    const y = startY;
    // Existing dragstart handler fills `dt` and (on the next frame) hides the source.
    fire(source, "dragstart", x, y);

    const rect = source.getBoundingClientRect();
    ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.remove("dragging", "list-dragging", "board-dragging");
    ghost.classList.add("touch-drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghostDX = x - rect.left;
    ghostDY = y - rect.top;
    ghost.style.transform = `translate(${x - ghostDX}px, ${y - ghostDY}px)`;
    document.body.appendChild(ghost);
    navigator.vibrate?.(10);

    dispatchOver(x, y);
  };

  const dispatchOver = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    if (lastOver !== el) {
      if (lastOver) fire(lastOver, "dragleave", x, y);
      fire(el, "dragenter", x, y);
      lastOver = el;
    }
    fire(el, "dragover", x, y);
  };

  const nearestVScroll = (x: number, y: number): HTMLElement | null => {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  };

  const updateAutoScroll = (x: number, y: number) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    scrollVX = x < EDGE ? -SCROLL_STEP : x > vw - EDGE ? SCROLL_STEP : 0;
    scrollVY = y < EDGE ? -SCROLL_STEP : y > vh - EDGE ? SCROLL_STEP : 0;
    scrollVYTarget = scrollVY ? nearestVScroll(x, y) : null;

    if (!scrollVX && !scrollVY) {
      stopAutoScroll();
      return;
    }
    if (scrollRAF == null) {
      const step = () => {
        if (scrollVX) {
          const lc = document.querySelector(".lists-container") as HTMLElement | null;
          if (lc) lc.scrollLeft += scrollVX;
        }
        if (scrollVY) {
          if (scrollVYTarget) scrollVYTarget.scrollTop += scrollVY;
          else window.scrollBy(0, scrollVY);
        }
        scrollRAF = scrollVX || scrollVY ? requestAnimationFrame(step) : null;
      };
      scrollRAF = requestAnimationFrame(step);
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    if (armed) return;
    if (e.touches.length !== 1) {
      reset();
      return;
    }
    const t = e.touches[0];
    const target = t.target as HTMLElement | null;
    if (!target) return;
    // Leave interactive children to their own handlers (archive button, inputs…).
    if (target.closest("button, input, textarea, select, [contenteditable='true']")) return;
    const src = target.closest<HTMLElement>('[draggable="true"]');
    if (!src) return;
    source = src;
    startX = t.clientX;
    startY = t.clientY;
    clearTimer();
    timer = window.setTimeout(arm, LONG_PRESS_MS);
  };

  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    if (!armed) {
      if (source && timer != null) {
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
          // Moved before the long-press fired → this is a scroll, not a drag.
          clearTimer();
          source = null;
        }
      }
      return;
    }
    e.preventDefault(); // stop the page/list from scrolling under the drag
    const x = t.clientX;
    const y = t.clientY;
    if (ghost) ghost.style.transform = `translate(${x - ghostDX}px, ${y - ghostDY}px)`;
    dispatchOver(x, y);
    updateAutoScroll(x, y);
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!armed) {
      reset();
      return;
    }
    const t = e.changedTouches[0];
    const x = t ? t.clientX : startX;
    const y = t ? t.clientY : startY;
    const el = document.elementFromPoint(x, y);
    if (el) fire(el, "drop", x, y);
    if (source) fire(source, "dragend", x, y);
    justDragged = true;
    window.setTimeout(() => {
      justDragged = false;
    }, 400);
    reset();
  };

  // Swallow the synthetic click the browser fires after a touch drag so dropping
  // a card doesn't also open it (or a board card doesn't navigate).
  const onClickCapture = (e: MouseEvent) => {
    if (justDragged) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("touchcancel", onTouchEnd, { passive: true });
  document.addEventListener("click", onClickCapture, true);

  return () => {
    reset();
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("touchcancel", onTouchEnd);
    document.removeEventListener("click", onClickCapture, true);
  };
}
