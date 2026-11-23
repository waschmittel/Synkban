import { focusTrap } from "./focusTrap";

/// Wires a native `<dialog>` as a top-layer modal:
/// - Opens via `showModal()` once connected (browser top layer + native inertness).
/// - Suppresses native `cancel` so Escape routes through `dialogKeys` /
///   `guardedClose` instead of silently dismissing the dialog.
/// - Attaches `focusTrap` (MutationObserver focus recovery, Tab wrapping, and
///   `overlayLayers` registration so any open floating popovers dismiss).
/// Returns a dispose function for `onCleanup`.
export function modalDialog(el: HTMLDialogElement): () => void {
  if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
  let disposed = false;
  const open = () => {
    if (disposed || !el.isConnected || el.open) return;
    if (typeof el.showModal === "function") el.showModal();
    // Keep focus on the dialog container until its own rAF focuses the
    // intended default control — avoids focusing a destructive button or
    // letting a triggering Enter keypress click a button inside the dialog.
    el.focus();
  };
  if (el.isConnected) open();
  else queueMicrotask(open);

  const onCancel = (e: Event) => e.preventDefault();
  el.addEventListener("cancel", onCancel);
  const releaseTrap = focusTrap(el);

  return () => {
    disposed = true;
    releaseTrap();
    el.removeEventListener("cancel", onCancel);
    if (el.open && typeof el.close === "function") el.close();
  };
}
