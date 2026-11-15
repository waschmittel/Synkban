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
