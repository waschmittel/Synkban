import type { Card } from "./types";

/// Returns true if `card` matches the active text + label filter.
/// Text filter (case-insensitive): matches title, description_text, or any
/// checklist item text substring.
/// The description_text field is the plain-text view of the ProseMirror doc,
/// computed server-side; searching against the raw description JSON would
/// false-match on node type names ("paragraph", "text").
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
    const descMatch = (card.description_text ?? "").toLowerCase().includes(t);
    const checklistMatch = (card.checklist ?? []).some((item) =>
      item.text.toLowerCase().includes(t)
    );
    if (!titleMatch && !descMatch && !checklistMatch) return false;
  }
  if (labelIds.length > 0) {
    if (!card.label_ids?.some((id) => labelIds.includes(id))) return false;
  }
  return true;
}
