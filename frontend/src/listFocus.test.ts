// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  focusAdjacentList,
  isHorizontalNavigation,
  resetPreferredRow,
} from "./listFocus";

function makeList(cardNames: string[], collapsed = false): HTMLElement {
  const list = document.createElement("div");
  list.className = collapsed ? "list list--collapsed" : "list";
  if (collapsed) {
    const expand = document.createElement("button");
    expand.className = "list-expand";
    expand.textContent = "expand";
    list.appendChild(expand);
    return list;
  }
  for (const name of cardNames) {
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;
    card.dataset.name = name;
    list.appendChild(card);
  }
  const trigger = document.createElement("button");
  trigger.className = "add-trigger";
  list.appendChild(trigger);
  return list;
}

const activeName = () =>
  (document.activeElement as HTMLElement | null)?.dataset.name ??
  (document.activeElement as HTMLElement | null)?.className ??
  null;

describe("focusAdjacentList", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resetPreferredRow();
  });

  it("remembers the starting row across a shorter list onto a longer list", () => {
    const listA = makeList(["A0", "A1", "A2", "A3", "A4"]);
    const listB = makeList(["B0", "B1"]);
    const listC = makeList(["C0", "C1", "C2", "C3", "C4"]);
    document.body.append(listA, listB, listC);

    expect(focusAdjacentList(listB, 3)).toBe(true);
    expect(activeName()).toBe("B1");

    expect(focusAdjacentList(listC, 1)).toBe(true);
    expect(activeName()).toBe("C3");
  });

  it("preserves the remembered row across empty and collapsed lists", () => {
    const listA = makeList(["A0", "A1", "A2", "A3"]);
    const listEmpty = makeList([]);
    const listCollapsed = makeList([], true);
    const listD = makeList(["D0", "D1", "D2", "D3"]);
    document.body.append(listA, listEmpty, listCollapsed, listD);

    expect(focusAdjacentList(listEmpty, 2)).toBe(true);
    expect(activeName()).toBe("add-trigger");

    expect(focusAdjacentList(listCollapsed, null)).toBe(true);
    expect(activeName()).toBe("list-expand");

    expect(focusAdjacentList(listD, null)).toBe(true);
    expect(activeName()).toBe("D2");
  });

  it("falls back to first/last card when no preferred row is active", () => {
    const listA = makeList(["A0", "A1", "A2"]);
    document.body.append(listA);

    expect(focusAdjacentList(listA, null, false)).toBe(true);
    expect(activeName()).toBe("A0");

    resetPreferredRow();
    expect(focusAdjacentList(listA, null, true)).toBe(true);
    expect(activeName()).toBe("A2");
  });

  it("clears the remembered row on resetPreferredRow and flags horizontal focus", () => {
    const listA = makeList(["A0", "A1", "A2"]);
    const listB = makeList(["B0", "B1", "B2"]);
    document.body.append(listA, listB);

    let sawHorizontal = false;
    listB.addEventListener("focusin", () => {
      sawHorizontal = isHorizontalNavigation();
    });

    focusAdjacentList(listB, 2);
    expect(sawHorizontal).toBe(true);
    expect(isHorizontalNavigation()).toBe(false);
    expect(activeName()).toBe("B2");

    resetPreferredRow();
    focusAdjacentList(listA, 0);
    expect(activeName()).toBe("A0");
  });
});
