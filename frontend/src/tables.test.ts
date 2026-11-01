// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";
import { schema } from "./proseEditor";
import {
  createTable,
  tablePlugins,
  insertTable,
  insertRowAbove,
  insertRowBelow,
  moveRowUp,
  moveRowDown,
  moveColumnLeft,
  moveColumnRight,
  removeRow,
  cellContext,
  enterInTable,
  alignRight,
  alignCenter,
  tabForward,
} from "./tables";

const para = (text: string) => schema.node("paragraph", null, text ? [schema.text(text)] : []);

/// A table whose cells read "r<row>c<col>" (header cells where row 0).
function filled(rows: number, cols: number): PmNode {
  const t = createTable(schema, rows, cols);
  const rowNodes: PmNode[] = [];
  t.forEach((row, _o, r) => {
    const cells: PmNode[] = [];
    row.forEach((cell, _co, c) => cells.push(cell.type.create(cell.attrs, para(`r${r}c${c}`))));
    rowNodes.push(row.type.create(null, cells));
  });
  return t.type.create(null, rowNodes);
}

function stateWith(...blocks: PmNode[]): EditorState {
  return EditorState.create({ doc: schema.node("doc", null, blocks), plugins: tablePlugins() });
}

/// Puts the cursor in the cell whose text is `text`.
function inCell(state: EditorState, text: string): EditorState {
  let pos = -1;
  state.doc.descendants((n, p) => {
    if (n.isText && n.text === text) pos = p + 1;
    return true;
  });
  if (pos < 0) throw new Error(`no cell ${text}`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  const ok = cmd(state, (tr) => (next = state.apply(tr)));
  return ok ? next : state;
}

const rows = (state: EditorState): string[][] => {
  const out: string[][] = [];
  state.doc.descendants((n) => {
    if (n.type === schema.nodes.table_row) {
      const r: string[] = [];
      n.forEach((c) => r.push(c.textContent));
      out.push(r);
    }
    return true;
  });
  return out;
};

const headerKinds = (state: EditorState): string[] => {
  const kinds: string[] = [];
  state.doc.descendants((n) => {
    if (n.type === schema.nodes.table_row) {
      kinds.push([...Array(n.childCount)].map((_, i) => n.child(i).type.name).join(","));
    }
    return true;
  });
  return kinds;
};

describe("tables", () => {
  it("createTable makes a header row followed by plain rows", () => {
    const s = stateWith(createTable(schema, 3, 2));
    expect(headerKinds(s)).toEqual([
      "table_header,table_header",
      "table_cell,table_cell",
      "table_cell,table_cell",
    ]);
  });

  it("insertTable replaces an empty paragraph and keeps one after it", () => {
    const s = run(stateWith(para("")), insertTable);
    expect(s.doc.child(0).type.name).toBe("table");
    expect(s.doc.lastChild!.type.name).toBe("paragraph");
    expect(cellContext(s)).not.toBeNull();
  });

  it("insertTable is a no-op inside a table", () => {
    const s = inCell(stateWith(filled(3, 2), para("")), "r1c0");
    expect(insertTable(s)).toBe(false);
  });

  it("rows can be added below but not above the header", () => {
    let s = inCell(stateWith(filled(2, 2), para("")), "r0c0");
    expect(insertRowAbove(s)).toBe(false);
    s = run(s, insertRowBelow);
    expect(rows(s)).toHaveLength(3);
    expect(headerKinds(s)[1]).toBe("table_cell,table_cell");
  });

  it("moves a body row up and down, never into or out of the header", () => {
    let s = inCell(stateWith(filled(4, 2), para("")), "r2c1");
    s = run(s, moveRowUp);
    expect(rows(s).map((r) => r[0])).toEqual(["r0c0", "r2c0", "r1c0", "r3c0"]);
    // Now at row 1: can't go further up (row 0 is the header).
    expect(moveRowUp(s)).toBe(false);
    s = run(s, moveRowDown);
    s = run(s, moveRowDown);
    expect(rows(s).map((r) => r[0])).toEqual(["r0c0", "r1c0", "r3c0", "r2c0"]);
    expect(moveRowDown(s)).toBe(false);
    // The header on row 0 cannot move at all.
    expect(moveRowDown(inCell(s, "r0c0"))).toBe(false);
    expect(headerKinds(s)[0]).toBe("table_header,table_header");
  });

  it("moves a column left and right within the bounds", () => {
    let s = inCell(stateWith(filled(2, 3), para("")), "r1c0");
    expect(moveColumnLeft(s)).toBe(false);
    s = run(s, moveColumnRight);
    expect(rows(s)[0]).toEqual(["r0c1", "r0c0", "r0c2"]);
    s = run(s, moveColumnRight);
    expect(rows(s)[1]).toEqual(["r1c1", "r1c2", "r1c0"]);
    expect(moveColumnRight(s)).toBe(false);
  });

  it("deleting the header row promotes the next row to the header", () => {
    let s = inCell(stateWith(filled(3, 2), para("")), "r0c0");
    s = run(s, removeRow);
    expect(rows(s)[0]).toEqual(["r1c0", "r1c1"]);
    expect(headerKinds(s)[0]).toBe("table_header,table_header");
  });

  it("Enter moves to the same column of the next row, selecting the cell", () => {
    let s = inCell(stateWith(filled(3, 3), para("")), "r1c1");
    s = run(s, enterInTable);
    const ctx = cellContext(s)!;
    expect([ctx.row, ctx.col]).toEqual([2, 1]);
    expect(s.doc.textBetween(s.selection.from, s.selection.to)).toBe("r2c1");
  });

  it("Enter on the last row leaves the table", () => {
    let s = inCell(stateWith(filled(3, 3), para("after")), "r2c1");
    s = run(s, enterInTable);
    expect(cellContext(s)).toBeNull();
    expect(s.selection.$from.parent.textContent).toBe("after");
  });

  it("Enter on the last row creates a paragraph when the table ends the document", () => {
    let s = inCell(stateWith(filled(2, 2)), "r1c0");
    s = run(s, enterInTable);
    expect(s.doc.lastChild!.type.name).toBe("paragraph");
    expect(cellContext(s)).toBeNull();
  });

  it("Tab on the last cell appends a row and enters it", () => {
    const s0 = inCell(stateWith(filled(2, 2), para("")), "r1c1");
    // tabForward needs the view for its second step; emulate the dispatch loop.
    let cur = s0;
    const view = { get state() { return cur; } } as any;
    tabForward(cur, (tr) => (cur = cur.apply(tr)), view);
    expect(rows(cur)).toHaveLength(3);
    const ctx = cellContext(cur)!;
    expect([ctx.row, ctx.col]).toEqual([2, 0]);
  });

  const aligns = (state: EditorState): (string | null)[][] => {
    const out: (string | null)[][] = [];
    state.doc.descendants((n) => {
      if (n.type === schema.nodes.table_row) {
        const r: (string | null)[] = [];
        n.forEach((c) => r.push(c.attrs.align));
        out.push(r);
      }
      return true;
    });
    return out;
  };

  it("aligning a column applies to every body cell, and rows added later inherit it", () => {
    let s = inCell(stateWith(filled(3, 2), para("")), "r1c1");
    s = run(s, alignRight);
    expect(aligns(s)).toEqual([
      [null, "right"],
      [null, "right"],
      [null, "right"],
    ]);
    s = run(s, insertRowBelow);
    expect(aligns(s).map((r) => r[1])).toEqual(["right", "right", "right", "right"]);
    s = run(s, alignCenter);
    expect(aligns(s).map((r) => r[1])).toEqual(["center", "center", "center", "center"]);
  });

  it("alignment travels with a moved column", () => {
    let s = inCell(stateWith(filled(2, 3), para("")), "r1c0");
    s = run(s, alignRight);
    s = run(s, moveColumnRight);
    expect(aligns(s).map((r) => r[1])).toEqual(["right", "right"]);
    expect(aligns(s).map((r) => r[0])).toEqual([null, null]);
  });
});
