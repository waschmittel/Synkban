/// Roving ↑↓ focus between the rows of a vertical list (archive panels,
/// checklist items). One definition of the edge behaviour everywhere:
/// clamped at the ends (no wrap), and when nothing in the list is focused yet
/// ArrowDown enters at the top, ArrowUp at the bottom.

/// Move focus to the next/previous row matching `itemSelector` inside
/// `container`. Rows count as "focused" when focus is on them or anything
/// inside them (e.g. their buttons).
export function moveRovingFocus(
  container: HTMLElement,
  itemSelector: string,
  dir: 1 | -1
): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  if (items.length === 0) return;
  const idx = items.indexOf(
    (document.activeElement?.closest(itemSelector) ?? null) as HTMLElement
  );
  const next =
    dir === 1
      ? idx < 0
        ? 0
        : Math.min(idx + 1, items.length - 1)
      : idx < 0
        ? items.length - 1
        : Math.max(idx - 1, 0);
  items[next].focus();
}

/// Keydown adapter: handles ArrowDown/ArrowUp (without modifiers handled by
/// the caller) via `moveRovingFocus`. Returns true when the event was handled.
export function handleRovingArrow(
  e: KeyboardEvent,
  container: HTMLElement,
  itemSelector: string
): boolean {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
  e.preventDefault();
  moveRovingFocus(container, itemSelector, e.key === "ArrowDown" ? 1 : -1);
  return true;
}
