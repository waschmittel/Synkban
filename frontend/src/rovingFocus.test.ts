// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { moveRovingFocus, handleRovingArrow } from "./rovingFocus";

function setup(count: number): HTMLElement {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "row";
    row.tabIndex = 0;
    row.dataset.idx = String(i);
    const btn = document.createElement("button");
    row.appendChild(btn);
    container.appendChild(row);
  }
  document.body.appendChild(container);
  return container;
}

const focusedIdx = () =>
  (document.activeElement?.closest(".row") as HTMLElement | null)?.dataset.idx ?? null;

describe("moveRovingFocus", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = setup(3);
  });

  it("enters at top on down, bottom on up, when nothing is focused", () => {
    moveRovingFocus(container, ".row", 1);
    expect(focusedIdx()).toBe("0");
    (document.activeElement as HTMLElement).blur();
    moveRovingFocus(container, ".row", -1);
    expect(focusedIdx()).toBe("2");
  });

  it("moves down/up and clamps at the edges", () => {
    moveRovingFocus(container, ".row", 1);
    moveRovingFocus(container, ".row", 1);
    expect(focusedIdx()).toBe("1");
    moveRovingFocus(container, ".row", 1);
    moveRovingFocus(container, ".row", 1);
    expect(focusedIdx()).toBe("2"); // clamped, no wrap
    moveRovingFocus(container, ".row", -1);
    expect(focusedIdx()).toBe("1");
  });

  it("treats focus inside a row (e.g. its button) as that row", () => {
    container.querySelectorAll<HTMLElement>(".row")[1].querySelector("button")!.focus();
    moveRovingFocus(container, ".row", 1);
    expect(focusedIdx()).toBe("2");
  });

  it("does nothing for an empty list", () => {
    const empty = setup(0);
    moveRovingFocus(empty, ".row", 1);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("handleRovingArrow", () => {
  it("handles only ArrowUp/ArrowDown and prevents default", () => {
    const container = setup(2);
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
    expect(handleRovingArrow(down, container, ".row")).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    expect(focusedIdx()).toBe("0");

    const other = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    expect(handleRovingArrow(other, container, ".row")).toBe(false);
    expect(other.defaultPrevented).toBe(false);
  });
});
