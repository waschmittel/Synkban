/// Returns true if the event target is an editable surface — `<input>`,
/// `<textarea>`, or any contenteditable element. Use this when the question
/// is specifically "is the user typing right now".
export function isTypingIn(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.contentEditable === "true"
  );
}

/// Returns true if the event target is inside any UI overlay (modal, drawer,
/// help/archive overlay, filter bar) — i.e. a layer that should swallow global
/// page shortcuts even when the user isn't actively typing.
export function isInUiOverlay(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  return (
    !!el.closest(".modal-overlay") ||
    !!el.closest(".label-drawer") ||
    !!el.closest(".shortcut-help-overlay") ||
    !!el.closest(".archive-overlay") ||
    !!el.closest(".filter-bar")
  );
}

/// Convenience for global shortcut handlers: skip when the user is typing OR
/// when an overlay is open. Composition of `isTypingIn` and `isInUiOverlay`.
export function isInInput(target: EventTarget | null): boolean {
  return isTypingIn(target) || isInUiOverlay(target);
}
