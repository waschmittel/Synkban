// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { GapCursor } from "prosemirror-gapcursor";
import { CellSelection, selectedRect } from "prosemirror-tables";
import type { Node as PmNode } from "prosemirror-model";
import { schema } from "./proseEditor";
import {
  arrowOutOfTable,
  createMatrix,
  createTable,
  tablePlugins,
  insertMatrix,
  insertTable,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  isMatrix,
  moveRowUp,
  moveRowDown,
  moveColumnLeft,
  moveColumnRight,
  removeColumn,
  removeRow,
  cellContext,
  enterInTable,
  alignLeft,
  alignRight,
  alignCenter,
  tabBackward,
  tabForward,
  transposeMatrix,
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

/// A matrix whose non-corner cells read "r<row>c<col>".
function filledMatrix(rows: number, cols: number): PmNode {
  const m = createMatrix(schema, rows, cols);
  const rowNodes: PmNode[] = [];
  m.forEach((row, _o, r) => {
    const cells: PmNode[] = [];
    row.forEach((cell, _co, c) =>
      cells.push(cell.type.create(cell.attrs, para(r === 0 && c === 0 ? "" : `r${r}c${c}`))),
    );
    rowNodes.push(row.type.create(null, cells));
  });
  return m.type.create(m.attrs, rowNodes);
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

/// Selects a rectangular range of cells by their text labels.
function selectCells(state: EditorState, anchorText: string, headText: string): EditorState {
  const cellPos = (text: string) => {
    let pos = -1;
    state.doc.descendants((n, p) => {
      if (n.isText && n.text === text) pos = p;
      return true;
    });
    if (pos < 0) throw new Error(`no cell ${text}`);
    return state.doc.resolve(pos).before(-1);
  };
  return state.apply(
    state.tr.setSelection(CellSelection.create(state.doc, cellPos(anchorText), cellPos(headText))),
  );
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

  it("insertTable and insertMatrix are no-ops inside a table or matrix", () => {
    const inTable = inCell(stateWith(filled(3, 2), para("")), "r1c0");
    expect(insertTable(inTable)).toBe(false);
    expect(insertMatrix(inTable)).toBe(false);
    const inMat = inCell(stateWith(filledMatrix(3, 3), para("")), "r1c1");
    expect(insertTable(inMat)).toBe(false);
    expect(insertMatrix(inMat)).toBe(false);
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

  it("aligning a multi-cell selection applies to all selected columns", () => {
    let s = selectCells(stateWith(filled(3, 3), para("")), "r1c2", "r2c1");
    s = run(s, alignRight);
    expect(aligns(s)).toEqual([
      [null, "right", "right"],
      [null, "right", "right"],
      [null, "right", "right"],
    ]);
    s = run(s, alignLeft);
    expect(aligns(s)).toEqual([
      [null, "left", "left"],
      [null, "left", "left"],
      [null, "left", "left"],
    ]);
  });

  it("insertRowAbove is refused when a multi-cell selection includes the header row", () => {
    const s = selectCells(stateWith(filled(3, 2), para("")), "r2c0", "r0c1");
    expect(insertRowAbove(s)).toBe(false);
  });

  it("moving a multi-cell selection moves all selected rows or columns and keeps them selected", () => {
    let s = selectCells(stateWith(filled(4, 3), para("")), "r1c0", "r2c1");
    expect(moveRowUp(s)).toBe(false);
    s = run(s, moveRowDown);
    expect(rows(s).map((r) => r[0])).toEqual(["r0c0", "r3c0", "r1c0", "r2c0"]);
    expect(s.selection instanceof CellSelection).toBe(true);
    expect(selectedRect(s)).toMatchObject({ top: 2, bottom: 4, left: 0, right: 2 });

    s = run(s, moveColumnRight);
    expect(rows(s)[2]).toEqual(["r1c2", "r1c0", "r1c1"]);
    expect(selectedRect(s)).toMatchObject({ top: 2, bottom: 4, left: 1, right: 3 });

    s = run(s, moveRowUp);
    expect(rows(s).map((r) => r[1])).toEqual(["r0c0", "r1c0", "r2c0", "r3c0"]);
    expect(selectedRect(s)).toMatchObject({ top: 1, bottom: 3, left: 1, right: 3 });

    s = run(s, moveColumnLeft);
    expect(rows(s)[1]).toEqual(["r1c0", "r1c1", "r1c2"]);
    expect(selectedRect(s)).toMatchObject({ top: 1, bottom: 3, left: 0, right: 2 });
  });
});

describe("matrices", () => {
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

  it("createMatrix marks matrix=true, keeps (0,0) as table_cell, and makes row 0 / col 0 headers", () => {
    const m = createMatrix(schema, 3, 3);
    expect(isMatrix(m)).toBe(true);
    const s = stateWith(m);
    expect(headerKinds(s)).toEqual([
      "table_cell,table_header,table_header",
      "table_header,table_cell,table_cell",
      "table_header,table_cell,table_cell",
    ]);
  });

  it("insertMatrix inserts a matrix and selects (0, 1); Shift+Tab never enters (0, 0)", () => {
    let s = run(stateWith(para("")), insertMatrix);
    expect(isMatrix(s.doc.child(0))).toBe(true);
    expect(s.doc.lastChild!.type.name).toBe("paragraph");
    expect(cellContext(s)).toMatchObject({ row: 0, col: 1 });
    expect(tabBackward(s)).toBe(false);

    // Tab advances through (0, 2) -> (1, 0), and Shift+Tab returns to (0, 2).
    s = run(s, tabForward);
    expect(cellContext(s)).toMatchObject({ row: 0, col: 2 });
    s = run(s, tabForward);
    expect(cellContext(s)).toMatchObject({ row: 1, col: 0 });
    s = run(s, tabBackward);
    expect(cellContext(s)).toMatchObject({ row: 0, col: 2 });
  });

  it("header column cannot move or gain a column to its left", () => {
    let s = inCell(stateWith(filledMatrix(3, 3), para("")), "r1c0");
    expect(insertColumnLeft(s)).toBe(false);
    expect(moveColumnLeft(s)).toBe(false);
    expect(moveColumnRight(s)).toBe(false);

    s = inCell(s, "r1c1");
    expect(moveColumnLeft(s)).toBe(false);
    s = run(s, moveColumnRight);
    expect(rows(s)[0]).toEqual(["", "r0c2", "r0c1"]);
    expect(rows(s)[1]).toEqual(["r1c0", "r1c2", "r1c1"]);

    // Inserting right of column 0 adds a normal body column (with header at row 0).
    s = run(inCell(s, "r1c0"), insertColumnRight);
    expect(rows(s)[0]).toEqual(["", "", "r0c2", "r0c1"]);
    expect(headerKinds(s)[1]).toBe("table_header,table_cell,table_cell,table_cell");
  });

  it("deleting row 0 or col 0 promotes the next line and clears (0, 0); 2×2 refuses deletion", () => {
    let s = inCell(stateWith(filledMatrix(3, 3), para("")), "r0c1");
    s = run(s, removeRow);
    expect(rows(s)).toEqual([
      ["", "r1c1", "r1c2"],
      ["r2c0", "r2c1", "r2c2"],
    ]);
    expect(headerKinds(s)).toEqual([
      "table_cell,table_header,table_header",
      "table_header,table_cell,table_cell",
    ]);

    let s2 = inCell(stateWith(filledMatrix(3, 3), para("")), "r1c0");
    s2 = run(s2, removeColumn);
    expect(rows(s2)).toEqual([
      ["", "r0c2"],
      ["r1c1", "r1c2"],
      ["r2c1", "r2c2"],
    ]);
    expect(headerKinds(s2)).toEqual([
      "table_cell,table_header",
      "table_header,table_cell",
      "table_header,table_cell",
    ]);

    const min = inCell(stateWith(filledMatrix(2, 2), para("")), "r1c1");
    expect(removeRow(min)).toBe(false);
    expect(removeColumn(min)).toBe(false);
  });

  it("alignment is per-cell on body cells only; new rows/columns stay unaligned", () => {
    let s = inCell(stateWith(filledMatrix(3, 3), para("")), "r0c1");
    expect(alignRight(s)).toBe(false);
    s = inCell(s, "r1c0");
    expect(alignLeft(s)).toBe(false);

    s = run(inCell(s, "r1c1"), alignRight);
    expect(aligns(s)).toEqual([
      [null, null, null],
      [null, "right", null],
      [null, null, null],
    ]);

    s = run(s, insertRowBelow);
    s = run(inCell(s, "r1c1"), insertColumnRight);
    expect(aligns(s)[2]).toEqual([null, null, null, null]);
    expect(aligns(s)[1]).toEqual([null, "right", null, null]);

    // Multi-cell selection spanning header + body aligns only the body cells.
    s = selectCells(s, "r0c1", "r2c1");
    s = run(s, alignCenter);
    expect(aligns(s)).toEqual([
      [null, null, null, null],
      [null, "center", null, null],
      [null, "center", null, null],
      [null, "center", null, null],
    ]);
  });

  it("transpose swaps rows, columns, headers, per-cell alignments and follows the selection", () => {
    expect(transposeMatrix(inCell(stateWith(filled(2, 2)), "r1c0"))).toBe(false);

    let s = inCell(stateWith(filledMatrix(3, 4), para("")), "r1c2");
    s = run(s, alignRight);
    s = run(inCell(s, "r2c1"), alignCenter);
    // Put caret in "r1c2" (row 1, col 2) with selection inside text.
    let targetPos = -1;
    s.doc.descendants((n, p) => {
      if (n.isText && n.text === "r1c2") targetPos = p + 2;
      return true;
    });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, targetPos)));

    s = run(s, transposeMatrix);
    expect(isMatrix(s.doc.child(0))).toBe(true);
    expect(rows(s)).toEqual([
      ["", "r1c0", "r2c0"],
      ["r0c1", "r1c1", "r2c1"],
      ["r0c2", "r1c2", "r2c2"],
      ["r0c3", "r1c3", "r2c3"],
    ]);
    expect(headerKinds(s)).toEqual([
      "table_cell,table_header,table_header",
      "table_header,table_cell,table_cell",
      "table_header,table_cell,table_cell",
      "table_header,table_cell,table_cell",
    ]);
    expect(aligns(s)).toEqual([
      [null, null, null],
      [null, null, "center"],
      [null, "right", null],
      [null, null, null],
    ]);
    expect(cellContext(s)).toMatchObject({ row: 2, col: 1 });
    expect(s.selection.$from.parent.textContent).toBe("r1c2");

    // Multi-cell selection is transposed as well.
    let multi = selectCells(s, "r1c1", "r2c2");
    multi = run(multi, transposeMatrix);
    expect(multi.selection instanceof CellSelection).toBe(true);
    expect(selectedRect(multi)).toMatchObject({ top: 1, bottom: 3, left: 1, right: 3 });
  });

  it("keeps the top-left corner empty and unfocusable by caret", () => {
    let s = inCell(stateWith(filledMatrix(3, 3), para("")), "r0c1");
    const ctx = cellContext(s)!;
    const cornerPos = ctx.tablePos + 1 + ctx.map.map[0] + 2;
    // Moving caret into (0, 0) from another cell restores the prior selection.
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, cornerPos)));
    expect(cellContext(s)).toMatchObject({ row: 0, col: 1 });

    // Writing text into (0, 0) clears it back to an empty paragraph.
    s = s.apply(s.tr.insertText("oops", cornerPos));
    expect(rows(s)[0][0]).toBe("");
    expect(cellContext(s)).toMatchObject({ row: 0, col: 1 });
  });

  const atCellEdge = (state: EditorState, text: string, side: "start" | "end") => {
    let pos = -1;
    state.doc.descendants((n, p) => {
      if (n.isText && n.text === text) pos = side === "start" ? p : p + text.length;
      return true;
    });
    if (pos < 0) throw new Error(`no cell ${text}`);
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  };

  it("arrowOutOfTable lands on a GapCursor when no paragraph is adjacent, and yields when one is", () => {
    // Standalone table: ArrowUp from row 0 and ArrowLeft from (0, 0) reach pos 0.
    const tOnly = stateWith(filled(2, 2));
    const up = run(inCell(tOnly, "r0c1"), arrowOutOfTable("vert", -1));
    expect(up.selection instanceof GapCursor).toBe(true);
    expect(up.selection.head).toBe(0);

    const left = run(atCellEdge(tOnly, "r0c0", "start"), arrowOutOfTable("horiz", -1));
    expect(left.selection instanceof GapCursor).toBe(true);
    expect(left.selection.head).toBe(0);

    // ArrowDown from last row and ArrowRight from last cell reach end of doc.
    const down = run(inCell(tOnly, "r1c0"), arrowOutOfTable("vert", 1));
    expect(down.selection instanceof GapCursor).toBe(true);
    expect(down.selection.head).toBe(tOnly.doc.content.size);

    const right = run(atCellEdge(tOnly, "r1c1", "end"), arrowOutOfTable("horiz", 1));
    expect(right.selection instanceof GapCursor).toBe(true);
    expect(right.selection.head).toBe(tOnly.doc.content.size);

    // Mid-table cells or mid-text horizontal positions do not escape.
    expect(arrowOutOfTable("vert", -1)(inCell(tOnly, "r1c0"))).toBe(false);
    expect(arrowOutOfTable("vert", 1)(inCell(tOnly, "r0c0"))).toBe(false);
    expect(arrowOutOfTable("horiz", -1)(inCell(tOnly, "r0c0"))).toBe(false);
    expect(arrowOutOfTable("horiz", 1)(inCell(tOnly, "r1c1"))).toBe(false);

    // Standalone matrix: ArrowLeft from (0, 1) jumps to pos 0 instead of bouncing off (0, 0).
    const mOnly = stateWith(filledMatrix(2, 2));
    const mLeft = run(atCellEdge(mOnly, "r0c1", "start"), arrowOutOfTable("horiz", -1));
    expect(mLeft.selection instanceof GapCursor).toBe(true);
    expect(mLeft.selection.head).toBe(0);

    // Adjacent paragraphs: yields false so standard ProseMirror/table navigation applies,
    // except matrix ArrowLeft which steps into the preceding paragraph instead of (0, 0).
    const tWrapped = stateWith(para("before"), filled(2, 2), para("after"));
    expect(arrowOutOfTable("vert", -1)(inCell(tWrapped, "r0c0"))).toBe(false);
    expect(arrowOutOfTable("vert", 1)(inCell(tWrapped, "r1c1"))).toBe(false);
    expect(arrowOutOfTable("horiz", -1)(atCellEdge(tWrapped, "r0c0", "start"))).toBe(false);
    expect(arrowOutOfTable("horiz", 1)(atCellEdge(tWrapped, "r1c1", "end"))).toBe(false);

    const mWrapped = stateWith(para("before"), filledMatrix(2, 2), para("after"));
    const mLeftToPara = run(atCellEdge(mWrapped, "r0c1", "start"), arrowOutOfTable("horiz", -1));
    expect(mLeftToPara.selection instanceof GapCursor).toBe(false);
    expect(mLeftToPara.selection.$from.parent.textContent).toBe("before");
  });
});
