import { describe, expect, it } from "vitest";
import { checklistOf, contentOf, draftCard, labelsOf, sameContent } from "./cardContent";
import type { Card, Draft } from "./types";

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  list_id: "l",
  title: id,
  description: "",
  description_text: "",
  position: 1,
  created_at: "",
  label_ids: [],
  archived: false,
  attachments: [],
  checklist: [],
  ...over,
});
const draft = (c: Card, saved_at: number, board_id = "b"): Draft => ({
  card_id: c.id,
  board_id,
  base: contentOf(c),
  draft: { ...contentOf(c), title: `${c.title} (edited)` },
  saved_at,
});

describe("contentOf", () => {
  it("normalises label order, empty docs and checklists", () => {
    const a = contentOf(card("a", { label_ids: ["y", "x"], checklist: [{ id: "1", text: "t", done: false }] }));
    const b = contentOf(card("a", { label_ids: ["x", "y"], description: '{"type":"doc","content":[{"type":"paragraph"}]}', checklist: [{ id: "1", text: "t", done: false }] }));
    expect(sameContent(a, b)).toBe(true);
    expect(labelsOf(a)).toEqual(["x", "y"]);
    expect(labelsOf(contentOf(card("n")))).toEqual([]);
    expect(checklistOf(a)).toEqual([{ id: "1", text: "t", done: false }]);
    expect(checklistOf({ ...a, checklist: "{bad" })).toEqual([]);
  });
});

describe("draftCard", () => {
  it("reopens the card when it is unchanged; not when changed or gone", () => {
    const c = card("c");
    expect(draftCard(draft(c, 1), [card("x"), c])?.id).toBe("c");
    expect(draftCard(draft(c, 1), [{ ...c, title: "changed elsewhere" }])).toBeNull();
    expect(draftCard(draft(c, 1), [card("x")])).toBeNull();
  });

  it("any content change invalidates: labels, due date, checklist, description", () => {
    const c = card("c");
    for (const over of [
      { label_ids: ["x"] },
      { due_date: "2026-11-20" },
      { checklist: [{ id: "1", text: "t", done: false }] },
      { description: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x"}]}]}' },
    ])
      expect(draftCard(draft(c, 1), [{ ...c, ...over }])).toBeNull();
    // Position, list, attachments are not content.
    expect(draftCard(draft(c, 1), [{ ...c, position: 9, list_id: "l2" }])?.id).toBe("c");
  });

  it("drops malformed drafts", () => {
    const bad = { card_id: "c", board_id: "b", saved_at: 1 } as unknown as Draft;
    expect(draftCard(bad, [card("c")])).toBeNull();
  });
});
