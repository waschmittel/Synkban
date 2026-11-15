import type { Label } from "./types";
import { parseDueInput } from "./dueDate";

/// Labels are the same when their names differ only in case, whitespace and
/// dashes (as `label_key` in the backend, ADR-0014).
export function labelKey(name: string): string {
  return name.replace(/[\s-]/g, "").toLowerCase();
}

/// The board label matching `name`, if any (never for an empty key).
export function findLabel(labels: Label[], name: string): Label | undefined {
  const key = labelKey(name);
  return key ? labels.find((l) => labelKey(l.name) === key) : undefined;
}

export interface QuickAdd {
  title: string;
  /// Existing labels to set.
  labels: Label[];
  /// Names of labels to create first (no match on the board).
  newLabels: string[];
  due?: string;
}

/// `#label` starts with a letter (so `#42` stays text); `due:` takes anything
/// `parseDueInput` understands. Both only as whole words.
const TOKEN = /(^|\s)(?:#(\p{L}[\p{L}\p{N}_-]*)|due:(\S+))(?=\s|$)/gu;

/// Card title with quick-add tokens: "Pay invoice #finance due:fri".
/// Tokens that don't parse (`due:someday`) stay in the title.
export function parseQuickAdd(text: string, labels: Label[], today = new Date()): QuickAdd {
  const out: QuickAdd = { title: "", labels: [], newLabels: [] };
  const title = text.replace(TOKEN, (all, pre: string, label?: string, due?: string) => {
    if (label) {
      const found = findLabel(labels, label);
      if (found) {
        if (!out.labels.includes(found)) out.labels.push(found);
      } else if (!out.newLabels.some((n) => labelKey(n) === labelKey(label))) {
        out.newLabels.push(label);
      }
      return pre;
    }
    const iso = parseDueInput(due!, today);
    if (!iso) return all;
    out.due = iso;
    return pre;
  });
  out.title = title.replace(/\s+/g, " ").trim();
  return out;
}
