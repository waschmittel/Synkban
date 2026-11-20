// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { GapCursor } from "prosemirror-gapcursor";
import type { Node as PmNode } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { schema } from "./proseEditor";
import { createMatrix, createTable } from "./tables";
import {
  clampGapCursor,
  clearEmptyCodeBlock,
  exitCodeOnTripleEnter,
  inEscapableBlock,
  insertParagraphAbove,
  insertParagraphBelow,
  isValidGapCursor,
} from "./blockEscape";

const p = (text = "") => schema.node("paragraph", null, text ? [schema.text(text)] : []);
const code = (text = "") => schema.node("code_block", null, text ? [schema.text(text)] : []);
const quote = (text = "q") => schema.node("blockquote", null, [p(text)]);
const list = (ordered: boolean, text = "item") =>
  schema.node(ordered ? "ordered_list" : "bullet_list", null, [schema.node("list_item", null, [p(text)])]);

const stateWith = (...blocks: PmNode[]) =>
  EditorState.create({ doc: schema.node("doc", null, blocks) });

function run(state: EditorState, cmd: Command): { ok: boolean; state: EditorState } {
  let next = state;
  const ok = cmd(state, (tr) => (next = state.apply(tr)));
  return { ok, state: next };
}

function caretAtText(state: EditorState, needle: string, offsetFromEnd = 0): EditorState {
  let pos = -1;
  state.doc.descendants((n, p) => {
    if (n.isText && n.text === needle) pos = p + needle.length - offsetFromEnd;
    return true;
  });
  if (pos < 0) throw new Error(`text "${needle}" not found`);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

describe("GapCursor rules on schema blocks", () => {
  it("allows gap cursors before and after code_block, blockquote, lists, and table", () => {
    for (const node of [
      code("x"),
      quote("x"),
      list(false, "x"),
      list(true, "x"),
      createTable(schema, 2, 2),
    ]) {
      const s = stateWith(node);
      expect(isValidGapCursor(s.doc.resolve(0)), `${node.type.name} start`).toBe(true);
      expect(isValidGapCursor(s.doc.resolve(s.doc.content.size)), `${node.type.name} end`).toBe(true);
    }
  });

  it("allows gap cursor between adjacent closed blocks, but not next to a paragraph", () => {
    const table = createTable(schema, 2, 2);
    const adj = stateWith(table, code("x"));
    expect(isValidGapCursor(adj.doc.resolve(table.nodeSize))).toBe(true);

    const withPara = stateWith(p("hi"), code("x"));
    expect(isValidGapCursor(withPara.doc.resolve(0))).toBe(false);
    expect(isValidGapCursor(withPara.doc.resolve(withPara.doc.child(0).nodeSize))).toBe(false);
    expect(isValidGapCursor(withPara.doc.resolve(withPara.doc.content.size))).toBe(true);
  });

  it("disallows gap cursor inside list_item after a nested list", () => {
    const nested = list(false, "inner");
    const outerItem = schema.node("list_item", null, [p("outer"), nested]);
    const doc = schema.node("doc", null, [schema.node("bullet_list", null, [outerItem])]);
    // Position inside outer list_item right after the nested list: 1 (bullet_list) + 1 (list_item) + p.nodeSize + nested.nodeSize
    const afterNested = 2 + p("outer").nodeSize + nested.nodeSize;
    expect(doc.resolve(afterNested).parent.type.name).toBe("list_item");
    expect(isValidGapCursor(doc.resolve(afterNested))).toBe(false);
  });
});

describe("insertParagraphAbove / insertParagraphBelow", () => {
  it("works on code_block, blockquote, bullet_list, ordered_list, table, and matrix", () => {
    for (const node of [
      code("abc"),
      quote("abc"),
      list(false, "abc"),
      list(true, "abc"),
      createTable(schema, 2, 2),
      createMatrix(schema, 2, 2),
    ]) {
      let s = stateWith(node);
      s = s.apply(s.tr.setSelection(TextSelection.near(s.doc.resolve(1), 1)));
      if (node.type === schema.nodes.table && isFirstCellCorner(node)) {
        // Select (0, 1) for matrix.
        s = s.apply(s.tr.setSelection(TextSelection.near(s.doc.resolve(s.doc.child(0).child(0).child(0).nodeSize + 2), 1)));
      }
      expect(inEscapableBlock(s), node.type.name).toBe(true);

      const above = run(s, insertParagraphAbove);
      expect(above.ok).toBe(true);
      expect(above.state.doc.childCount).toBe(2);
      expect(above.state.doc.child(0).type.name).toBe("paragraph");
      expect(above.state.selection.$from.before(1)).toBe(0);

      const below = run(s, insertParagraphBelow);
      expect(below.ok).toBe(true);
      expect(below.state.doc.childCount).toBe(2);
      expect(below.state.doc.child(1).type.name).toBe("paragraph");
      expect(below.state.selection.$from.before(1)).toBe(node.nodeSize);
    }
  });

  it("works with a CellSelection inside a table", () => {
    const table = createTable(schema, 2, 2);
    const s0 = stateWith(table);
    const firstCell = s0.doc.resolve(2); // inside table (1) -> row (2) -> before first cell
    const s = s0.apply(s0.tr.setSelection(new CellSelection(firstCell, firstCell)));
    expect(inEscapableBlock(s)).toBe(true);

    const above = run(s, insertParagraphAbove);
    expect(above.ok).toBe(true);
    expect(above.state.doc.child(0).type.name).toBe("paragraph");

    const below = run(s, insertParagraphBelow);
    expect(below.ok).toBe(true);
    expect(below.state.doc.child(1).type.name).toBe("paragraph");
  });

  it("returns false for paragraph, heading, and GapCursor", () => {
    for (const node of [p("text"), schema.node("heading", { level: 1 }, [schema.text("h")])]) {
      let s = stateWith(node);
      s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1)));
      expect(inEscapableBlock(s)).toBe(false);
      expect(insertParagraphAbove(s)).toBe(false);
      expect(insertParagraphBelow(s)).toBe(false);
    }

    const gapState = stateWith(code("x"));
    const withGap = gapState.apply(gapState.tr.setSelection(new GapCursor(gapState.doc.resolve(0))));
    expect(inEscapableBlock(withGap)).toBe(false);
    expect(insertParagraphAbove(withGap)).toBe(false);
    expect(insertParagraphBelow(withGap)).toBe(false);
  });
});

function isFirstCellCorner(node: PmNode): boolean {
  return !!node.attrs.matrix;
}

describe("code block Enter / Backspace ergonomics", () => {
  it("exits a code block on a blank trailing line (2 trailing newlines + Enter)", () => {
    // 0 or 1 trailing newline stays inside the code block (allows blank lines inside code).
    expect(exitCodeOnTripleEnter(caretAtText(stateWith(code("let x = 1;")), "let x = 1;"))).toBe(false);
    expect(exitCodeOnTripleEnter(caretAtText(stateWith(code("let x = 1;\n")), "let x = 1;\n"))).toBe(false);

    // \n\n not at the cursor/end returns false.
    const mid = caretAtText(stateWith(code("a\n\nb")), "a\n\nb", 1);
    expect(exitCodeOnTripleEnter(mid)).toBe(false);

    // Cursor at end with trailing \n\n exits into a new paragraph below and strips \n\n.
    const ready = caretAtText(stateWith(code("let x = 1;\n\n")), "let x = 1;\n\n");
    const res = run(ready, exitCodeOnTripleEnter);
    expect(res.ok).toBe(true);
    expect(res.state.doc.childCount).toBe(2);
    expect(res.state.doc.child(0).textContent).toBe("let x = 1;");
    expect(res.state.doc.child(1).type.name).toBe("paragraph");
    expect(res.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(res.state.selection.$from.before(1)).toBe(res.state.doc.child(0).nodeSize);
  });

  it("converts an empty code block to a paragraph on Backspace, and ignores non-empty ones", () => {
    const empty = stateWith(code());
    const sEmpty = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, 1)));
    const res = run(sEmpty, clearEmptyCodeBlock);
    expect(res.ok).toBe(true);
    expect(res.state.doc.child(0).type.name).toBe("paragraph");

    const nonEmpty = stateWith(code("x"));
    const sStart = nonEmpty.apply(nonEmpty.tr.setSelection(TextSelection.create(nonEmpty.doc, 1)));
    expect(clearEmptyCodeBlock(sStart)).toBe(false);
  });

  it("clamps boundary GapCursor arrows without blocking mid-document gaps or TextSelections", () => {
    const first = code("a");
    const second = code("b");
    const s = stateWith(first, second);
    const atStart = s.apply(s.tr.setSelection(new GapCursor(s.doc.resolve(0))));
    const atMid = s.apply(s.tr.setSelection(new GapCursor(s.doc.resolve(first.nodeSize))));
    const atEnd = s.apply(s.tr.setSelection(new GapCursor(s.doc.resolve(s.doc.content.size))));
    const textSel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1)));

    expect(clampGapCursor(-1)(atStart)).toBe(true);
    expect(clampGapCursor(1)(atStart)).toBe(false);
    expect(clampGapCursor(-1)(atEnd)).toBe(false);
    expect(clampGapCursor(1)(atEnd)).toBe(true);
    expect(clampGapCursor(-1)(atMid)).toBe(false);
    expect(clampGapCursor(1)(atMid)).toBe(false);
    expect(clampGapCursor(-1)(textSel)).toBe(false);
    expect(clampGapCursor(1)(textSel)).toBe(false);
  });
});
