/// Simple-table support for the card description editor: schema nodes,
/// commands, the keyboard map and the "first row is the header" invariant.
///
/// Deliberately simple tables: cells hold paragraphs only (no lists, so Tab
/// keeps one meaning inside a table), the first row is always the header row,
/// and there is no merging or column resizing. The menu that exposes these
/// commands lives in `editorMenu.ts`.

import type { Node as PmNode, Schema } from "prosemirror-model";
import {
  type Command,
  EditorState,
  Plugin,
  Selection,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import {
  CellSelection,
  TableMap,
  type TableRect,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  isInTable,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  selectionCell,
  tableEditing,
  tableNodeTypes,
  tableNodes,
} from "prosemirror-tables";

/// Node specs to append to the editor schema. `paragraph+` cells keep pasted
/// multi-paragraph content valid; Enter never creates a second paragraph in a
/// cell (see `enterInTable`), Shift+Enter inserts a line break instead.
export type Align = "left" | "center" | "right";

/// Column alignment lives on every cell (so it renders and survives moves) but
/// the header cell of the column is the source of truth: `headerRowPlugin`
/// copies it to the body cells after every edit, which is how rows added later
/// pick it up. Header cells always *render* centred (CSS), whatever they store.
export const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph+",
  cellAttributes: {
    align: {
      default: null,
      getFromDOM(dom) {
        const a = (dom as HTMLElement).style.textAlign;
        return a === "left" || a === "center" || a === "right" ? a : null;
      },
      setDOMAttr(value, attrs) {
        if (value) attrs.style = `${attrs.style ? attrs.style + ";" : ""}text-align: ${value}`;
      },
    },
  },
});

export const DEFAULT_ROWS = 3;
export const DEFAULT_COLS = 3;

export function createTable(schema: Schema, rows = DEFAULT_ROWS, cols = DEFAULT_COLS): PmNode {
  const t = tableNodeTypes(schema);
  const row = (header: boolean) =>
    t.row.create(
      null,
      Array.from({ length: cols }, () => (header ? t.header_cell : t.cell).createAndFill()!),
    );
  return t.table.create(null, [row(true), ...Array.from({ length: rows - 1 }, () => row(false))]);
}

/// Position context of the cell the selection is in, or null outside a table.
interface CellContext {
  tablePos: number;
  table: PmNode;
  map: TableMap;
  row: number;
  col: number;
}

export function cellContext(state: EditorState): CellContext | null {
  if (!isInTable(state)) return null;
  const $cell = selectionCell(state);
  if (!$cell) return null;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const rect = map.findCell($cell.pos - $cell.start(-1));
  return { tablePos: $cell.before(-1), table, map, row: rect.top, col: rect.left };
}

/// Selects the whole content of the cell starting at `cellPos` (spreadsheet-
/// style: typing replaces it).
function selectCell(tr: Transaction, cellPos: number): Transaction {
  const cell = tr.doc.nodeAt(cellPos)!;
  return tr.setSelection(
    TextSelection.between(tr.doc.resolve(cellPos + 1), tr.doc.resolve(cellPos + cell.nodeSize - 1)),
  );
}

// ── Insert / delete ──────────────────────────────────────────────────────

/// Inserts a table at the cursor: replaces an empty top-level paragraph,
/// otherwise goes after the current block. Always leaves a paragraph after it
/// so the cursor can get out, and selects the first (header) cell.
export const insertTable: Command = (state, dispatch) => {
  if (isInTable(state)) return false;
  const { $from } = state.selection;
  const table = createTable(state.schema);
  const replaceEmpty = $from.depth === 1 && $from.parent.isTextblock && $from.parent.content.size === 0;
  const tablePos = replaceEmpty ? $from.before() : $from.parent.isTextblock ? $from.after() : $from.pos;
  if (dispatch) {
    const tr = state.tr;
    if (replaceEmpty) tr.replaceWith(tablePos, $from.after(), table);
    else tr.insert(tablePos, table);
    const end = tablePos + table.nodeSize;
    const $end = tr.doc.resolve(end);
    if (!$end.nodeAfter) tr.insert(end, state.schema.nodes.paragraph.create());
    selectCell(tr, tablePos + 2);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/// No inserting above the header row — it would displace the header.
export const insertRowAbove: Command = (state, dispatch) =>
  isInTable(state) && selectedRect(state).top > 0 && addRowBefore(state, dispatch);
export const insertRowBelow: Command = addRowAfter;
export const insertColumnLeft: Command = addColumnBefore;
export const insertColumnRight: Command = addColumnAfter;
export const removeRow: Command = deleteRow;
export const removeColumn: Command = deleteColumn;
export const removeTable: Command = deleteTable;

// ── Alignment ────────────────────────────────────────────────────────────

/// Aligns every column in the selection. Only the header cells are written; the
/// header plugin propagates them down each column in the same transaction round.
function alignColumn(align: Align): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    if (dispatch) {
      const rect = selectedRect(state);
      const tr = state.tr;
      for (let col = rect.left; col < rect.right; col++) {
        const pos = rect.tableStart + rect.map.map[col];
        const cell = state.doc.nodeAt(pos)!;
        tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
      }
      dispatch(tr);
    }
    return true;
  };
}
export const alignLeft = alignColumn("left");
export const alignCenter = alignColumn("center");
export const alignRight = alignColumn("right");

// ── Move (swap with the neighbour) ───────────────────────────────────────

/// Dispatch wrapper that keeps the moved selection intact: a cell selection
/// stays over the moved rectangle, a caret lands at the end of its moved cell.
/// The library's own selection options either select the whole row/column
/// (`select`) or leave the mapped selection wherever the replaced table
/// collapsed it (`!select`); following the selection lets the move be repeated
/// and typing continue.
function followMove(
  rect: TableRect,
  dRow: number,
  dCol: number,
  isCellSel: boolean,
  dispatch: (tr: Transaction) => void,
): (tr: Transaction) => void {
  return (tr) => {
    const table = tr.doc.nodeAt(rect.tableStart - 1)!;
    const map = TableMap.get(table);
    const cellPos = (r: number, c: number) => rect.tableStart + map.map[r * map.width + c];
    if (isCellSel) {
      tr.setSelection(
        CellSelection.create(
          tr.doc,
          cellPos(rect.top + dRow, rect.left + dCol),
          cellPos(rect.bottom - 1 + dRow, rect.right - 1 + dCol),
        ),
      );
    } else {
      const pos = cellPos(rect.top + dRow, rect.left + dCol);
      const cell = tr.doc.nodeAt(pos)!;
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + cell.nodeSize - 1), -1));
    }
    dispatch(tr.scrollIntoView());
  };
}

function moveRow(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1) {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  // The header row stays first: it can't move, and no row may swap into it.
  if (rect.top < 1 || (dir === -1 ? rect.top < 2 : rect.bottom >= rect.map.height)) return false;
  const [from, to] = dir === -1 ? [rect.top - 1, rect.bottom - 1] : [rect.bottom, rect.top];
  return moveTableRow({ from, to, select: false })(
    state,
    dispatch && followMove(rect, dir, 0, state.selection instanceof CellSelection, dispatch),
  );
}

function moveColumn(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1) {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (dir === -1 ? rect.left < 1 : rect.right >= rect.map.width) return false;
  const [from, to] = dir === -1 ? [rect.left - 1, rect.right - 1] : [rect.right, rect.left];
  return moveTableColumn({ from, to, select: false })(
    state,
    dispatch && followMove(rect, 0, dir, state.selection instanceof CellSelection, dispatch),
  );
}

export const moveRowUp: Command = (state, dispatch) => moveRow(state, dispatch, -1);
export const moveRowDown: Command = (state, dispatch) => moveRow(state, dispatch, 1);
export const moveColumnLeft: Command = (state, dispatch) => moveColumn(state, dispatch, -1);
export const moveColumnRight: Command = (state, dispatch) => moveColumn(state, dispatch, 1);

// ── Keyboard ─────────────────────────────────────────────────────────────

/// Tab → next cell; on the last cell, append a row and go to its first cell.
export const tabForward: Command = (state, dispatch, view) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  if (!dispatch || !view) return addRowAfter(state);
  if (!addRowAfter(state, dispatch)) return false;
  return goToNextCell(1)(view.state, dispatch);
};

/// Enter → same column in the next row; on the last row, leave the table
/// (creating a paragraph after it if there is none). Shift+Enter is a different
/// key combination and still inserts a line break inside the cell.
export const enterInTable: Command = (state, dispatch) => {
  const ctx = cellContext(state);
  if (!ctx) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  if (ctx.row < ctx.map.height - 1) {
    const offset = ctx.map.map[(ctx.row + 1) * ctx.map.width + ctx.col];
    selectCell(tr, ctx.tablePos + 1 + offset);
  } else {
    const end = ctx.tablePos + ctx.table.nodeSize;
    if (!tr.doc.resolve(end).nodeAfter) tr.insert(end, state.schema.nodes.paragraph.create());
    tr.setSelection(Selection.near(tr.doc.resolve(end), 1));
  }
  dispatch(tr.scrollIntoView());
  return true;
};

export const tableKeymap = keymap({
  Tab: tabForward,
  "Shift-Tab": goToNextCell(-1),
  Enter: enterInTable,
});

// ── Header invariant ─────────────────────────────────────────────────────

/// Keeps two invariants true after any edit (row deleted, row moved, paste…) so
/// the commands above never have to think about them: first row = header cells
/// and every other row = plain cells, and every body cell is aligned like the
/// header cell of its column.
export const headerRowPlugin = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null;
    const t = tableNodeTypes(state.schema);
    const tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type !== t.table) return true;
      const aligns: (Align | null)[] = [];
      node.firstChild?.forEach((cell) => aligns.push(cell.attrs.align ?? null));
      node.forEach((row, rowOffset, rowIndex) => {
        row.forEach((cell, cellOffset, colIndex) => {
          const want = rowIndex === 0 ? t.header_cell : t.cell;
          const align = aligns[colIndex] ?? null;
          if (cell.type !== want || (cell.attrs.align ?? null) !== align) {
            tr.setNodeMarkup(
              pos + 1 + rowOffset + 1 + cellOffset,
              want,
              { ...cell.attrs, align },
              cell.marks,
            );
            changed = true;
          }
        });
      });
      return false;
    });
    return changed ? tr : null;
  },
});

/// Plugins in the order the editor needs them: keymap first (so Enter/Tab in a
/// cell beat the list and base keymaps), then the library's cell-selection
/// handling and the header invariant.
export const tablePlugins = (): Plugin[] => [tableKeymap, tableEditing(), headerRowPlugin];
