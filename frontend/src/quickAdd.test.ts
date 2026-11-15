import { describe, expect, it } from "vitest";
import { findLabel, labelKey, parseQuickAdd } from "./quickAdd";
import type { Label } from "./types";

const today = new Date(2026, 10, 17); // Tue
const L = (id: string, name: string): Label => ({ id, name, color: "#fff" });
const labels = [L("1", "In Progress"), L("2", "Bug"), L("3", "Größe")];

describe("labelKey / findLabel", () => {
  it("ignores case, whitespace and dashes", () => {
    expect(labelKey(" In - Pro gress ")).toBe("inprogress");
    expect(findLabel(labels, "in-progress")?.id).toBe("1");
    expect(findLabel(labels, "INPROGRESS")?.id).toBe("1");
    expect(findLabel(labels, "größe")?.id).toBe("3");
    expect(findLabel(labels, "progress")).toBeUndefined();
    expect(findLabel([L("x", "-")], "--")).toBeUndefined();
  });
});

describe("parseQuickAdd", () => {
  it("takes labels and the due date out of the title", () => {
    expect(parseQuickAdd("Pay invoice #bug due:fri", labels, today)).toEqual({
      title: "Pay invoice",
      labels: [labels[1]],
      newLabels: [],
      due: "2026-11-20",
    });
  });

  it("matches existing labels loosely and creates the rest once", () => {
    const q = parseQuickAdd("#in-progress Fix #BUG it #new-thing #NewThing #bug", labels, today);
    expect(q.title).toBe("Fix it");
    expect(q.labels.map((l) => l.id)).toEqual(["1", "2"]);
    expect(q.newLabels).toEqual(["new-thing"]);
    expect(q.due).toBeUndefined();
  });

  it("keeps what isn't a token", () => {
    for (const t of ["Fix issue #42", "C# rocks", "a#b", "mail me@due:fri", "due:someday later", "Done #"])
      expect(parseQuickAdd(t, labels, today)).toEqual({ title: t, labels: [], newLabels: [] });
  });

  it("the last due wins; ISO and offsets work", () => {
    expect(parseQuickAdd("X due:+3d due:2026-12-24", labels, today).due).toBe("2026-12-24");
    expect(parseQuickAdd("due:tomorrow X", labels, today)).toMatchObject({ title: "X", due: "2026-11-18" });
  });

  it("can leave an empty title", () => {
    expect(parseQuickAdd("#bug", labels, today).title).toBe("");
  });
});
