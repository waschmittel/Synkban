import { describe, it, expect } from "vitest";
import {
  withinListMoveDown,
  withinListMoveUp,
  crossListInsertPosition,
  listDropPosition,
} from "./positions";

describe("withinListMoveDown", () => {
  it("midpoint between next and after-next", () => {
    expect(withinListMoveDown(2, 3)).toBe(2.5);
  });

  it("moves past last card (no after-next) → next + 1", () => {
    expect(withinListMoveDown(5, undefined)).toBe(6);
  });

  it("works with fractional positions", () => {
    expect(withinListMoveDown(1.5, 2)).toBe(1.75);
  });

  it("works with fractional positions after-next", () => {
    expect(withinListMoveDown(1, 1.25)).toBe(1.125);
  });
});

describe("withinListMoveUp", () => {
  it("midpoint between before-prev and prev", () => {
    expect(withinListMoveUp(3, 2)).toBe(2.5);
  });

  it("moves to first slot (no before-prev) → prev / 2", () => {
    expect(withinListMoveUp(2, undefined)).toBe(1);
  });

  it("works with fractional positions", () => {
    expect(withinListMoveUp(2, 1.5)).toBe(1.75);
  });

  it("moves to start when prev is 1", () => {
    expect(withinListMoveUp(1, undefined)).toBe(0.5);
  });
});

describe("crossListInsertPosition", () => {
  it("empty target list → 1", () => {
    expect(crossListInsertPosition([], 0)).toBe(1);
    expect(crossListInsertPosition([], 5)).toBe(1);
  });

  it("currentIdx = 0 → half of first position", () => {
    expect(crossListInsertPosition([2, 3, 4], 0)).toBe(1);
    expect(crossListInsertPosition([10], 0)).toBe(5);
  });

  it("currentIdx beyond target length → last + 1", () => {
    expect(crossListInsertPosition([1, 2, 3], 5)).toBe(4);
    expect(crossListInsertPosition([1, 2, 3], 3)).toBe(4);
  });

  it("currentIdx in middle → midpoint", () => {
    expect(crossListInsertPosition([1, 2, 3, 4], 2)).toBe(2.5);
    expect(crossListInsertPosition([1, 2, 3, 4], 1)).toBe(1.5);
  });

  it("handles negative currentIdx as 0", () => {
    expect(crossListInsertPosition([4, 5], -1)).toBe(2);
  });

  it("preserves index parity at boundaries", () => {
    // currentIdx == adjPositions.length → append
    expect(crossListInsertPosition([1, 2], 2)).toBe(3);
  });
});

describe("listDropPosition", () => {
  it("empty positions → 1", () => {
    expect(listDropPosition([], 0)).toBe(1);
  });

  it("insertIndex 0 → half of first position", () => {
    expect(listDropPosition([2, 4, 6], 0)).toBe(1);
  });

  it("insertIndex at end → last + 1", () => {
    expect(listDropPosition([1, 2, 3], 3)).toBe(4);
    expect(listDropPosition([1, 2, 3], 10)).toBe(4);
  });

  it("insertIndex in middle → midpoint", () => {
    expect(listDropPosition([1, 2, 3, 4], 2)).toBe(2.5);
  });

  it("works with fractional list positions", () => {
    expect(listDropPosition([1, 1.5, 2], 1)).toBe(1.25);
  });
});
