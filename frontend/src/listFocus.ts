/// Keyboard entry into a board list: its first/last card, else its add
/// trigger, else (collapsed) its expand strip.
export function focusListEntry(list: Element | null | undefined, last = false): boolean {
  if (!list) return false;
  const cards = list.querySelectorAll<HTMLElement>(".card");
  const target =
    cards[last ? cards.length - 1 : 0] ??
    list.querySelector<HTMLElement>(".add-trigger") ??
    list.querySelector<HTMLElement>(".list-expand");
  target?.focus();
  return !!target;
}

// Sticky vertical row index across horizontal (←/→) list hops, analogous to
// a text editor's goal column: preserved across shorter, empty, or collapsed
// lists and cleared by vertical moves or non-horizontal focus changes.
let preferredRow: number | null = null;
let navigatingHorizontally = false;

export function resetPreferredRow(): void {
  preferredRow = null;
}

export function isHorizontalNavigation(): boolean {
  return navigatingHorizontally;
}

/// Horizontal focus hop into an adjacent list. Records `fromRow` as the
/// sticky target row if none is active yet, then focuses the card at
/// `min(preferredRow, cards.length - 1)` (or falls back to `focusListEntry`
/// when `preferredRow` is unset or the target list has no cards).
export function focusAdjacentList(
  adjList: Element | null | undefined,
  fromRow: number | null,
  toLastIfUnset = false,
): boolean {
  if (!adjList) return false;
  if (fromRow !== null && preferredRow === null) {
    preferredRow = fromRow;
  }
  const cards = adjList.querySelectorAll<HTMLElement>(".card");
  let target: HTMLElement | null = null;
  if (cards.length > 0) {
    const idx =
      preferredRow !== null
        ? Math.min(preferredRow, cards.length - 1)
        : toLastIfUnset
          ? cards.length - 1
          : 0;
    target = cards[idx] ?? null;
  } else {
    target =
      adjList.querySelector<HTMLElement>(".add-trigger") ??
      adjList.querySelector<HTMLElement>(".list-expand");
  }
  if (!target) return false;
  navigatingHorizontally = true;
  try {
    target.focus();
  } finally {
    navigatingHorizontally = false;
  }
  return true;
}
