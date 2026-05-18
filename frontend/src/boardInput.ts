/// Returns true if the event target is inside any editable surface
/// (input/textarea/contenteditable) or any open modal/drawer. Board-level
/// global keyboard handlers must skip events when this is true so shortcuts
/// don't fire while the user is typing or interacting with a dialog.
export function isInInput(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.contentEditable === "true" ||
    !!el.closest(".modal-overlay") ||
    !!el.closest(".label-drawer") ||
    !!el.closest(".shortcut-help-overlay") ||
    !!el.closest(".archive-overlay") ||
    !!el.closest(".filter-bar")
  );
}
