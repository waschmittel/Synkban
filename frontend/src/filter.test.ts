import { describe, it, expect } from "vitest";
import { cardMatchesFilter } from "./filter";
import type { Card } from "./types";

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    list_id: "l1",
    title: "",
    description: "",
    description_text: "",
    position: 1,
    created_at: "2024-01-01 00:00:00",
    label_ids: [],
    archived: false,
    attachments: [],
    checklist: [],
    ...over,
  };
}

describe("cardMatchesFilter", () => {
  it("no filter → matches anything", () => {
    expect(cardMatchesFilter(makeCard(), "", [])).toBe(true);
  });

  it("title text match (case-insensitive)", () => {
    expect(cardMatchesFilter(makeCard({ title: "Buy Milk" }), "milk", [])).toBe(true);
    expect(cardMatchesFilter(makeCard({ title: "Buy Milk" }), "MILK", [])).toBe(true);
    expect(cardMatchesFilter(makeCard({ title: "Buy Bread" }), "milk", [])).toBe(false);
  });

  it("description text match", () => {
    expect(
      cardMatchesFilter(makeCard({ title: "X", description_text: "do the laundry" }), "laundry", [])
    ).toBe(true);
  });

  it("matches if either title or description matches", () => {
    expect(
      cardMatchesFilter(makeCard({ title: "Foo", description_text: "bar baz" }), "bar", [])
    ).toBe(true);
  });

  it("text mismatch → false", () => {
    expect(
      cardMatchesFilter(makeCard({ title: "Foo", description_text: "bar" }), "xyz", [])
    ).toBe(false);
  });

  it("label match: card has selected label", () => {
    expect(
      cardMatchesFilter(makeCard({ label_ids: ["a", "b"] }), "", ["b"])
    ).toBe(true);
  });

  it("label match: any-of (OR within labels)", () => {
    expect(
      cardMatchesFilter(makeCard({ label_ids: ["x"] }), "", ["a", "x", "b"])
    ).toBe(true);
  });

  it("label mismatch → false", () => {
    expect(
      cardMatchesFilter(makeCard({ label_ids: ["x"] }), "", ["a", "b"])
    ).toBe(false);
  });

  it("card with no labels and label filter → false", () => {
    expect(cardMatchesFilter(makeCard({ label_ids: [] }), "", ["a"])).toBe(false);
  });

  it("text AND labels: both must match", () => {
    const card = makeCard({ title: "Bug fix", label_ids: ["bug"] });
    expect(cardMatchesFilter(card, "bug", ["bug"])).toBe(true);
    expect(cardMatchesFilter(card, "bug", ["feature"])).toBe(false);
    expect(cardMatchesFilter(card, "feature", ["bug"])).toBe(false);
  });

  it("missing label_ids treated as empty", () => {
    const card = { ...makeCard(), label_ids: undefined as any };
    expect(cardMatchesFilter(card, "", [])).toBe(true);
    expect(cardMatchesFilter(card, "", ["x"])).toBe(false);
  });

  it("empty text + empty labels always matches", () => {
    expect(cardMatchesFilter(makeCard({ title: "anything" }), "", [])).toBe(true);
  });

  it("does not match ProseMirror node type names in the raw description JSON", () => {
    // Raw description contains "paragraph" as a node type; description_text only
    // holds the actual prose. The filter must use description_text.
    const card = makeCard({
      title: "X",
      description: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}',
      description_text: "hello",
    });
    expect(cardMatchesFilter(card, "paragraph", [])).toBe(false);
    expect(cardMatchesFilter(card, "hello", [])).toBe(true);
  });

  it("checklist item text match (case-insensitive)", () => {
    const card = makeCard({
      title: "X",
      checklist: [
        { id: "i1", text: "Wash the Car", done: false },
        { id: "i2", text: "other", done: true },
      ],
    });
    expect(cardMatchesFilter(card, "car", [])).toBe(true);
    expect(cardMatchesFilter(card, "CAR", [])).toBe(true);
    expect(cardMatchesFilter(card, "bike", [])).toBe(false);
  });

  it("checklist match combines with label filter (AND)", () => {
    const card = makeCard({
      checklist: [{ id: "i1", text: "deploy", done: false }],
      label_ids: ["ops"],
    });
    expect(cardMatchesFilter(card, "deploy", ["ops"])).toBe(true);
    expect(cardMatchesFilter(card, "deploy", ["bug"])).toBe(false);
  });

  it("missing checklist treated as empty", () => {
    const card = { ...makeCard({ title: "X" }), checklist: undefined as any };
    expect(cardMatchesFilter(card, "anything", [])).toBe(false);
  });

  it("missing description_text is treated as empty", () => {
    const card = { ...makeCard({ title: "X" }), description_text: undefined as any };
    expect(cardMatchesFilter(card, "missing", [])).toBe(false);
  });
});
