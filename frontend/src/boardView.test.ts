// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  trackBoardView,
  restoreBoardView,
  restoreBoardScroll,
  resetBoardViews,
  recordBoardFilter,
  rememberedFilter,
  forgetBoardViews,
  reloadBoardViews,
  flushBoardViews,
  lastFocusedCard,
  rememberNotesCard,
  notesCardFor,
} from "./boardView";

function render(listIds: string[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `<div class="lists-container">${listIds
    .map(
      (l) =>
        `<div class="list" data-list-id="${l}"><div class="cards-container">
          <div class="card" tabindex="0" data-card-id="${l}-c1"></div>
          <div class="card" tabindex="0" data-card-id="${l}-c2"></div></div></div>`,
    )
    .join("")}</div>`;
  document.body.replaceChildren(root);
  return root;
}
const q = (root: HTMLElement, sel: string) => root.querySelector<HTMLElement>(sel)!;

describe("boardView", () => {
  let id = "a";
  let stop: () => void;
  beforeEach(() => {
    resetBoardViews();
    id = "a";
    vi.stubGlobal("requestAnimationFrame", (f: () => void) => (f(), 0));
  });
  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
  });

  it("restores card focus and scroll offsets per board", () => {
    let root = render(["l1", "l2"]);
    stop = trackBoardView(root, () => id);
    q(root, "[data-card-id=l2-c2]").focus();
    q(root, ".lists-container").scrollLeft = 120;
    q(root, ".lists-container").dispatchEvent(new Event("scroll"));
    const cards = root.querySelectorAll<HTMLElement>(".cards-container")[1];
    cards.scrollTop = 40;
    cards.dispatchEvent(new Event("scroll"));
    stop();

    // Switch to board b (fresh DOM), then back to a.
    id = "b";
    root = render(["l1", "l2"]);
    stop = trackBoardView(root, () => id);
    restoreBoardView(root, "b");
    expect(document.activeElement).toBe(document.body);

    id = "a";
    root = render(["l1", "l2"]);
    restoreBoardView(root, "a");
    expect(document.activeElement).toBe(q(root, "[data-card-id=l2-c2]"));
    expect(q(root, ".lists-container").scrollLeft).toBe(120);
    expect(root.querySelectorAll(".cards-container")[1].scrollTop).toBe(40);
    expect(root.querySelectorAll(".cards-container")[0].scrollTop).toBe(0);
  });

  it("keeps boards independent", () => {
    const root = render(["l1"]);
    stop = trackBoardView(root, () => id);
    q(root, "[data-card-id=l1-c1]").focus();
    id = "b";
    q(root, "[data-card-id=l1-c2]").focus();
    id = "a";
    restoreBoardView(root, "a");
    expect(document.activeElement).toBe(q(root, "[data-card-id=l1-c1]"));
    id = "b";
    restoreBoardView(root, "b");
    expect(document.activeElement).toBe(q(root, "[data-card-id=l1-c2]"));
  });

  it("skips deleted cards and lists", () => {
    let root = render(["l1", "l2"]);
    stop = trackBoardView(root, () => id);
    q(root, "[data-card-id=l2-c1]").focus();
    const cards = root.querySelectorAll<HTMLElement>(".cards-container")[1];
    cards.scrollTop = 30;
    cards.dispatchEvent(new Event("scroll"));
    root = render(["l1"]);
    expect(() => restoreBoardView(root, "a")).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not steal focus from a text field", () => {
    let root = render(["l1"]);
    stop = trackBoardView(root, () => id);
    q(root, "[data-card-id=l1-c1]").focus();
    root = render(["l1"]);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    restoreBoardView(root, "a");
    expect(document.activeElement).toBe(input);
  });

  it("ignores events while no board is shown", () => {
    const root = render(["l1"]);
    stop = trackBoardView(root, () => undefined);
    q(root, "[data-card-id=l1-c1]").focus();
    q(root, "[data-card-id=l1-c1]").blur();
    id = "a";
    restoreBoardView(root, "a");
    expect(document.activeElement).toBe(document.body);
  });

  it("remembers filters per board and drops deleted labels", () => {
    expect(rememberedFilter("a", [])).toBeNull();
    const f = { open: true, text: "milk", labelIds: ["l1", "gone"], due: "week" };
    recordBoardFilter("a", f);
    f.labelIds.push("mutated"); // stored copy is independent
    recordBoardFilter("b", { open: false, text: "", labelIds: [], due: null });
    expect(rememberedFilter("a", ["l1", "l2"])).toEqual({ open: true, text: "milk", labelIds: ["l1"], due: "week" });
    expect(rememberedFilter("b", [])).toEqual({ open: false, text: "", labelIds: [], due: null });
  });

  it("forgets boards that no longer exist", () => {
    recordBoardFilter("a", { open: true, text: "x", labelIds: [], due: null });
    recordBoardFilter("b", { open: true, text: "y", labelIds: [], due: null });
    forgetBoardViews(["b"]);
    expect(rememberedFilter("a", [])).toBeNull();
    expect(rememberedFilter("b", [])?.text).toBe("y");
    forgetBoardViews([]);
    expect(rememberedFilter("b", [])).toBeNull();
  });

  it("restoring an unvisited board is a no-op", () => {
    const root = render(["l1"]);
    expect(() => restoreBoardView(root, "never")).not.toThrow();
  });

  it("survives a reload via sessionStorage", () => {
    const root = render(["l1"]);
    stop = trackBoardView(root, () => id);
    q(root, "[data-card-id=l1-c2]").focus();
    const cards = q(root, ".cards-container");
    cards.scrollTop = 25;
    cards.dispatchEvent(new Event("scroll"));
    recordBoardFilter("a", { open: true, text: "x", labelIds: ["l"], due: "overdue" });
    flushBoardViews();
    stop();
    document.activeElement && (document.activeElement as HTMLElement).blur();

    reloadBoardViews();
    const fresh = render(["l1"]);
    restoreBoardView(fresh, "a");
    expect(document.activeElement).toBe(q(fresh, "[data-card-id=l1-c2]"));
    expect(q(fresh, ".cards-container").scrollTop).toBe(25);
    expect(rememberedFilter("a", ["l"])?.text).toBe("x");
  });

  it("remembers the Notes card per list and the focused card, across a reload", () => {
    const root = render(["l1"]);
    stop = trackBoardView(root, () => id);
    q(root, "[data-card-id=l1-c2]").focus();
    stop();
    rememberNotesCard("a", "l1", "l1-c2");
    rememberNotesCard("a", "l2", "x");
    rememberNotesCard("a", "l2", null); // cleared (empty list)
    flushBoardViews();
    reloadBoardViews();
    expect(lastFocusedCard("a")).toBe("l1-c2");
    expect(notesCardFor("a", "l1")).toBe("l1-c2");
    expect(notesCardFor("a", "l2")).toBeUndefined();
    expect(notesCardFor("unknown", "l1")).toBeUndefined();
    expect(lastFocusedCard("unknown")).toBeNull();
  });

  it("drops malformed Notes entries from storage", () => {
    sessionStorage.setItem("synkban.boardViews", '{"a":{"notes":{"l1":"c","l2":5,"l3":null}}}');
    reloadBoardViews();
    expect(notesCardFor("a", "l1")).toBe("c");
    expect(notesCardFor("a", "l2")).toBeUndefined();
    expect(notesCardFor("a", "l3")).toBeUndefined();
  });

  it("writes lazily after a debounce", () => {
    vi.useFakeTimers();
    try {
      sessionStorage.clear();
      recordBoardFilter("a", { open: true, text: "q", labelIds: [], due: null });
      expect(sessionStorage.getItem("synkban.boardViews")).toBeNull();
      vi.advanceTimersByTime(300);
      expect(sessionStorage.getItem("synkban.boardViews")).toContain('"q"');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["corrupt JSON", "{nope"],
    ["wrong top-level type", "[1,2]"],
    ["null", "null"],
    ["garbage entries", '{"a":5,"b":null,"c":{"card":3,"x":"no","lists":{"l":-4,"m":"z"},"filter":{"labelIds":[1,"k"],"due":7}}}'],
  ])("ignores malformed storage: %s", (_n, raw) => {
    sessionStorage.setItem("synkban.boardViews", raw);
    expect(() => reloadBoardViews()).not.toThrow();
    const f = rememberedFilter("c", ["k"]);
    if (f) expect(f).toEqual({ open: false, text: "", labelIds: ["k"], due: null });
    expect(() => restoreBoardView(render(["m"]), "c")).not.toThrow();
  });

  it("keeps working when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      recordBoardFilter("a", { open: true, text: "mem", labelIds: [], due: null });
      expect(() => flushBoardViews()).not.toThrow();
      expect(rememberedFilter("a", [])?.text).toBe("mem");
    } finally {
      spy.mockRestore();
    }
  });

  it("re-applies scroll after list nodes are recreated, keeping focus", () => {
    let root = render(["l1", "l2"]);
    stop = trackBoardView(root, () => id);
    const cards = root.querySelectorAll<HTMLElement>(".cards-container")[1];
    cards.scrollTop = 70;
    cards.dispatchEvent(new Event("scroll"));
    q(root, ".lists-container").scrollLeft = 15;
    q(root, ".lists-container").dispatchEvent(new Event("scroll"));
    stop();

    root = render(["l1", "l2"]); // refetch: fresh nodes at 0
    q(root, "[data-card-id=l1-c1]").focus();
    restoreBoardScroll(root, "a");
    expect(root.querySelectorAll(".cards-container")[1].scrollTop).toBe(70);
    expect(root.querySelectorAll(".cards-container")[0].scrollTop).toBe(0);
    expect(q(root, ".lists-container").scrollLeft).toBe(15);
    expect(document.activeElement).toBe(q(root, "[data-card-id=l1-c1]"));
  });
});
