import type { Card } from "./types";

/// Returns true if `card` matches the active text + label filter.
/// Text filter (case-insensitive): matches title OR description substring.
/// Label filter: matches when the card has at least one of the selected labels.
/// Filters combine with AND. Empty filter values are ignored.
export function cardMatchesFilter(
  card: Card,
  text: string,
  labelIds: string[]
): boolean {
  if (text) {
    const t = text.toLowerCase();
    const titleMatch = card.title.toLowerCase().includes(t);
    const descMatch = card.description.toLowerCase().includes(t);
    if (!titleMatch && !descMatch) return false;
  }
  if (labelIds.length > 0) {
    if (!card.label_ids?.some((id) => labelIds.includes(id))) return false;
  }
  return true;
}
