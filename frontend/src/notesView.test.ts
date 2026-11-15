import { describe, it, expect } from "vitest";
import { adjacentList, listOfCard, pickCard, resolveSelection } from "./notesView";
import type { ListWithCards } from "./types";

const list = (id: string, cards: string[]): ListWithCards =>
  ({
    id,
    board_id: "b",
    title: id,
    position: 0,
    created_at: "",
    cards: cards.map((c, i) => ({ id: c, list_id: id, title: c, position: i + 1 })),
  }) as unknown as ListWithCards;

const lists = [list("a", ["a1", "a2", "a3"]), list("e", []), list("b", ["b1"])];

describe("pickCard", () => {
  it("takes the first preferred id in the list, else the first card", () => {
    expect(pickCard(lists[0], "zz", "a2", "a3")).toBe("a2");
    expect(pickCard(lists[0], null, undefined)).toBe("a1");
    expect(pickCard(lists[0], "b1")).toBe("a1");
  });
  it("is null for an empty or missing list", () => {
    expect(pickCard(lists[1], "a1")).toBeNull();
    expect(pickCard(undefined)).toBeNull();
  });
});

describe("listOfCard / adjacentList", () => {
  it("finds the holder of a card", () => {
    expect(listOfCard(lists, "b1")?.id).toBe("b");
    expect(listOfCard(lists, "nope")).toBeUndefined();
    expect(listOfCard(lists, null)).toBeUndefined();
  });
  it("steps to neighbours without wrapping", () => {
    expect(adjacentList(lists, "a", 1)?.id).toBe("e");
    expect(adjacentList(lists, "b", -1)?.id).toBe("e");
    expect(adjacentList(lists, "a", -1)).toBeUndefined();
    expect(adjacentList(lists, "b", 1)).toBeUndefined();
    expect(adjacentList(lists, "gone", 1)).toBeUndefined();
  });
});

describe("resolveSelection", () => {
  it("keeps an existing card and follows it to its new list", () => {
    expect(resolveSelection(lists, { listId: "a", cardId: "a2", index: 1 }, false)).toEqual({
      listId: "a",
      cardId: "a2",
      removed: false,
    });
    expect(resolveSelection(lists, { listId: "a", cardId: "b1", index: 0 }, false)).toEqual({
      listId: "b",
      cardId: "b1",
      removed: false,
    });
  });

  it("a vanished clean card is replaced by the one at its index (or the last)", () => {
    expect(resolveSelection(lists, { listId: "a", cardId: "x", index: 1 }, false).cardId).toBe("a2");
    expect(resolveSelection(lists, { listId: "a", cardId: "x", index: 9 }, false).cardId).toBe("a3");
    expect(resolveSelection(lists, { listId: "e", cardId: "x", index: 0 }, false)).toEqual({
      listId: "e",
      cardId: null,
      removed: false,
    });
  });

  it("a vanished dirty card stays selected as removed", () => {
    expect(resolveSelection(lists, { listId: "a", cardId: "x", index: 0 }, true)).toEqual({
      listId: "a",
      cardId: "x",
      removed: true,
    });
  });

  it("a vanished list falls back to the first list", () => {
    expect(resolveSelection(lists, { listId: "gone", cardId: null, index: 0 }, false)).toEqual({
      listId: "a",
      cardId: "a1",
      removed: false,
    });
    expect(resolveSelection([], { listId: "gone", cardId: null, index: 0 }, false)).toEqual({
      listId: null,
      cardId: null,
      removed: false,
    });
  });

  it("an empty list that gained a card selects it", () => {
    const grown = [list("e", ["new"])];
    expect(resolveSelection(grown, { listId: "e", cardId: null, index: 0 }, false).cardId).toBe("new");
  });
});
