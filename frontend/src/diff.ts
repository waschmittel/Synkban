export type DiffKind = "same" | "removed" | "added";
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/**
 * Line diff from `a` (the older text) to `b` (the newer one) via the longest
 * common subsequence. Removed lines are in `a` only, added lines in `b` only.
 */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  // Trim the common prefix/suffix first: edits are usually local, and it
  // shrinks the quadratic table to the part that actually changed.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      out.push({ kind: "same", text: midA[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: midA[i++] });
    } else {
      out.push({ kind: "added", text: midB[j++] });
    }
  }
  while (i < n) out.push({ kind: "removed", text: midA[i++] });
  while (j < m) out.push({ kind: "added", text: midB[j++] });
  for (const text of a.slice(endA)) out.push({ kind: "same", text });
  return out;
}

/** Same as `diffLines` for unordered values (labels, attachment names). */
export function diffSets(a: string[], b: string[]): DiffLine[] {
  const inA = new Set(a);
  const inB = new Set(b);
  return [
    ...a.map((text): DiffLine => ({ kind: inB.has(text) ? "same" : "removed", text })),
    ...b.filter((t) => !inA.has(t)).map((text): DiffLine => ({ kind: "added", text })),
  ];
}

export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.kind !== "same");
}

/**
 * Plain-text lines of a card description (ProseMirror doc JSON): one line per
 * block, list items prefixed with a bullet/number, indented per nesting level.
 */
export function descriptionLines(description: string): string[] {
  if (!description) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(description);
  } catch {
    return description.split("\n");
  }
  const lines: string[] = [];

  const inline = (node: any): string => {
    if (typeof node?.text === "string") return node.text;
    if (node?.type === "hard_break") return " ";
    return (node?.content ?? []).map(inline).join("");
  };

  const block = (node: any, indent: string, marker: string | null) => {
    switch (node?.type) {
      case "bullet_list":
      case "ordered_list": {
        const ordered = node.type === "ordered_list";
        (node.content ?? []).forEach((item: any, idx: number) =>
          block(item, indent, ordered ? `${(node.attrs?.order ?? 1) + idx}. ` : "• ")
        );
        return;
      }
      case "list_item": {
        // First child carries the marker; nested blocks indent beneath it.
        (node.content ?? []).forEach((child: any, idx: number) =>
          block(child, idx === 0 ? indent : indent + "  ", idx === 0 ? marker : null)
        );
        return;
      }
      case "code_block":
        lines.push(indent + (marker ?? "") + "```");
        for (const l of inline(node).split("\n")) lines.push(indent + l);
        lines.push(indent + "```");
        return;
      case "blockquote":
        (node.content ?? []).forEach((child: any) => block(child, indent + "> ", null));
        return;
      default: {
        if (node?.content?.some((c: any) => c?.content && !("text" in c) && c.type !== "hard_break")) {
          (node.content as any[]).forEach((child) => block(child, indent, marker));
          return;
        }
        const prefix = node?.type === "heading" ? "#".repeat(node.attrs?.level ?? 1) + " " : "";
        lines.push(indent + (marker ?? "") + prefix + inline(node));
      }
    }
  };

  for (const node of (doc as any)?.content ?? []) block(node, "", null);
  return lines;
}

export function checklistLines(items: { text: string; done: boolean }[]): string[] {
  return items.map((i) => `${i.done ? "☑" : "☐"} ${i.text}`);
}
