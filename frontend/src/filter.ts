import type { Card } from "./types";
import { addDays, firstDayOfWeek, parseIso, toIso } from "./dueDate";

/// Due-date filter: before today, in this calendar week (locale's first
/// day), or until a day (`YYYY-MM-DD`: on or before it, overdue included). Null: any.
export type DueFilter = "overdue" | "week" | string | null;

export function dueMatches(due: string | undefined, f: DueFilter, today = new Date(), firstDay = firstDayOfWeek()): boolean {
  if (!f) return true;
  if (!due) return false;
  const t = toIso(today);
  if (f === "overdue") return due < t;
  if (f === "week") {
    const start = addDays(today, -((today.getDay() - firstDay + 7) % 7));
    return due >= toIso(start) && due <= toIso(addDays(start, 6));
  }
  return parseIso(f) ? due <= f : true;
}

/// Returns true if `card` matches the active text + label filter.
/// Text filter (case-insensitive): matches title, description_text, or any
/// checklist item text substring.
/// The description_text field is the plain-text view of the ProseMirror doc,
/// computed server-side; searching against the raw description JSON would
/// false-match on node type names ("paragraph", "text").
/// Label filter: matches when the card has every selected label (AND).
/// Due filter: see `dueMatches`.
/// Filters combine with AND. Empty filter values are ignored.
export function cardMatchesFilter(
  card: Card,
  text: string,
  labelIds: string[],
  due: DueFilter = null,
  today = new Date(),
): boolean {
  if (!dueMatches(card.due_date, due, today)) return false;
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
    if (!labelIds.every((id) => card.label_ids?.includes(id))) return false;
  }
  return true;
}
