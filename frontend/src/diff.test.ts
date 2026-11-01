import { describe, it, expect } from "vitest";
import { checklistLines, descriptionLines, diffLines, diffSets, hasChanges } from "./diff";

const kinds = (d: ReturnType<typeof diffLines>) => d.map((l) => `${l.kind[0]}:${l.text}`);

describe("diffLines", () => {
  it("marks identical input as unchanged", () => {
    const d = diffLines(["a", "b"], ["a", "b"]);
    expect(hasChanges(d)).toBe(false);
    expect(kinds(d)).toEqual(["s:a", "s:b"]);
  });

  it("reports removed, added and kept lines in order", () => {
    expect(kinds(diffLines(["a", "b", "c"], ["a", "x", "c", "d"]))).toEqual([
      "s:a", "r:b", "a:x", "s:c", "a:d",
    ]);
  });

  it("handles empty sides", () => {
    expect(kinds(diffLines([], ["a"]))).toEqual(["a:a"]);
    expect(kinds(diffLines(["a"], []))).toEqual(["r:a"]);
    expect(diffLines([], [])).toEqual([]);
  });

  it("handles repeated lines", () => {
    expect(kinds(diffLines(["a", "a", "b"], ["a", "b"]))).toEqual(["s:a", "r:a", "s:b"]);
  });
});

describe("diffSets", () => {
  it("ignores order, flags membership changes", () => {
    expect(kinds(diffSets(["x", "y"], ["y", "z"]))).toEqual(["r:x", "s:y", "a:z"]);
  });
});

describe("descriptionLines", () => {
  it("is empty for an empty description", () => {
    expect(descriptionLines("")).toEqual([]);
  });

  it("flattens paragraphs, headings and nested lists", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] },
        {
          type: "bullet_list",
          content: [
            {
              type: "list_item",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "one" }] },
                {
                  type: "ordered_list",
                  attrs: { order: 1 },
                  content: [
                    { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "deep" }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(descriptionLines(JSON.stringify(doc))).toEqual([
      "## Title", "Hello world", "• one", "  1. deep",
    ]);
  });

  it("falls back to raw lines for non-JSON text", () => {
    expect(descriptionLines("a\nb")).toEqual(["a", "b"]);
  });
});

describe("checklistLines", () => {
  it("shows done state", () => {
    expect(checklistLines([{ text: "x", done: true }, { text: "y", done: false }])).toEqual(["☑ x", "☐ y"]);
  });
});

describe("descriptionLines tables", () => {
  const cell = (type: string, text: string) => ({
    type,
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  });
  const table = (rows: string[][]) => ({
    type: "table",
    content: rows.map((r, i) => ({
      type: "table_row",
      content: r.map((t) => cell(i === 0 ? "table_header" : "table_cell", t)),
    })),
  });
  const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });

  it("renders one markdown-style line per row, with a header separator", () => {
    expect(
      descriptionLines(doc(table([["Name", "Qty"], ["Apple", "3"], ["Pear", ""]])))
    ).toEqual(["| Name | Qty |", "| --- | --- |", "| Apple | 3 |", "| Pear |  |"]);
  });

  it("a row swap shows up as changed rows, not a pile of cells", () => {
    const a = descriptionLines(doc(table([["H"], ["one"], ["two"]])));
    const b = descriptionLines(doc(table([["H"], ["two"], ["one"]])));
    expect(hasChanges(diffLines(a, b))).toBe(true);
    expect(a).toHaveLength(4);
  });

  it("the header separator carries the column alignment", () => {
    const hdr = (text: string, align: string | null) => ({
      type: "table_header",
      attrs: { align },
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const d = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "table_row", content: [hdr("L", "left"), hdr("C", "center"), hdr("R", "right"), hdr("N", null)] },
          ],
        },
      ],
    });
    expect(descriptionLines(d)).toEqual(["| L | C | R | N |", "| :--- | :---: | ---: | --- |"]);
  });
});

