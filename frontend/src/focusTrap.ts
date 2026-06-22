import { registerOverlay, focusInHigherLayer } from "./overlayLayers";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/**
 * Keeps keyboard focus inside an open dialog/overlay:
 *
 * - When the focused element disappears (e.g. an inline confirmation closes)
 *   or focus otherwise escapes to <body>/outside, focus is pulled back to the
 *   most recently focused element inside the root that still exists — so the
 *   dialog's keydown handlers keep working.
 * - Tab/Shift+Tab wrap at the edges instead of escaping to the page behind
 *   the overlay.
 *
 * Nested traps compose: the inner dialog's Tab handler runs first (the event
 * target is inside it) and outer handlers skip already-handled events.
 *
 * Returns a dispose function — call it when the dialog closes.
 */
export function focusTrap(root: HTMLElement): () => void {
  const history: HTMLElement[] = [];

  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (!root.contains(t)) return;
    const i = history.indexOf(t);
    if (i !== -1) history.splice(i, 1);
    history.push(t);
    if (history.length > 20) history.shift();
  };

  const restore = () => {
    if (!root.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    // An overlay stacked above us (possibly portaled outside our subtree) owns
    // focus — don't yank it back.
    if (focusInHigherLayer(root, active)) return;
    for (let i = history.length - 1; i >= 0; i--) {
      const el = history[i];
      if (el.isConnected && root.contains(el)) {
        el.focus();
        return;
      }
    }
    const first = focusables(root)[0];
    if (first) first.focus();
    else root.focus();
  };

  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && root.contains(next)) return;
    // relatedTarget is null both when focus truly escapes (removed element)
    // and mid-frame during re-renders — check again after the DOM settles.
    requestAnimationFrame(restore);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const els = focusables(root);
    if (els.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? els.indexOf(active) : -1;
    if (!e.shiftKey && (idx === els.length - 1 || idx === -1)) {
      e.preventDefault();
      els[0].focus();
    } else if (e.shiftKey && idx <= 0) {
      e.preventDefault();
      els[els.length - 1].focus();
    }
  };

  // Removing the focused element does NOT reliably fire focusout — focus
  // silently jumps to <body>. Watch subtree removals as well (e.g. an inline
  // confirmation's buttons disappearing).
  const observer = new MutationObserver(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !root.contains(active)) {
      requestAnimationFrame(restore);
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  // restore() runs on the next frame so it can't race a higher overlay's own
  // close-time focus moves; aligns with the rAF used elsewhere here.
  const unregister = registerOverlay(root, () => requestAnimationFrame(restore));
  document.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);
  return () => {
    unregister();
    observer.disconnect();
    document.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    root.removeEventListener("keydown", onKeyDown);
  };
}
