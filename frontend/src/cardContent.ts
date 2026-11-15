import type { Card, ChecklistItem, Draft, DraftContent } from "./types";
import { docFromDescription, isDocEmpty } from "./proseEditor";

/// Description as stored: "" for an empty doc, else the doc's JSON.
export const serializeDoc = (doc: ReturnType<typeof docFromDescription>) =>
  isDocEmpty(doc) ? "" : JSON.stringify(doc.toJSON());
export const normLabels = (ids: string[]) => [...ids].sort().join("\0");
export const serializeChecklist = (items: ChecklistItem[]) => JSON.stringify(items);

/// The persisted card content, normalised so two snapshots compare by value.
export const contentOf = (c: Card): DraftContent => ({
  title: c.title,
  description: serializeDoc(docFromDescription(c.description)),
  labels: normLabels(c.label_ids ?? []),
  due: c.due_date ?? "",
  checklist: serializeChecklist(c.checklist ?? []),
});

export const sameContent = (a: DraftContent, b: DraftContent) =>
  a.title === b.title && a.description === b.description && a.labels === b.labels &&
  a.due === b.due && a.checklist === b.checklist;

export const labelsOf = (c: DraftContent) => (c.labels ? c.labels.split("\0") : []);

export function checklistOf(c: DraftContent): ChecklistItem[] {
  try {
    const items = JSON.parse(c.checklist);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/// ADR-0024: the draft's card if it is on `cards` and unchanged since the
/// draft began (reopen it), else null (drop the draft).
export function draftCard(draft: Draft, cards: Card[]): Card | null {
  const card = cards.find((c) => c.id === draft.card_id);
  return card && draft.base && draft.draft && sameContent(contentOf(card), draft.base) ? card : null;
}
