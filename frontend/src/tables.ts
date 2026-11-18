/// Simple-table and matrix support for the card description editor: schema
/// nodes, commands, the keyboard map and the header/corner invariants.
///
/// Deliberately simple tables: cells hold paragraphs only (no lists, so Tab
/// keeps one meaning inside a table), the first row is always the header row,
/// and there is no merging or column resizing. A matrix (`attrs.matrix`) also
/// keeps the top-left corner cell empty/uneditable, makes the first column a
/// header column, aligns body cells individually, and can be transposed. The
/// menu that exposes these commands lives in `editorMenu.ts`.

import type { Node as PmNode, NodeSpec, Schema } from "prosemirror-model";
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
const baseTableNodes = tableNodes({
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

export const tableNodeSpecs = {
  ...baseTableNodes,
  table: {
    ...baseTableNodes.table,
    attrs: { matrix: { default: false } },
    parseDOM: [
      {
        tag: "table",
        getAttrs: (dom) => ({
          matrix: typeof dom !== "string" && (dom as HTMLElement).hasAttribute("data-matrix"),
        }),
      },
    ],
    toDOM(node) {
      return ["table", node.attrs.matrix ? { "data-matrix": "" } : {}, ["tbody", 0]];
    },
  } as NodeSpec,
};

export const isMatrix = (table: PmNode): boolean => !!table.attrs.matrix;

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

export function createMatrix(schema: Schema, rows = DEFAULT_ROWS, cols = DEFAULT_COLS): PmNode {
  const t = tableNodeTypes(schema);
  const row0 = t.row.create(null, [
    t.cell.createAndFill()!,
    ...Array.from({ length: cols - 1 }, () => t.header_cell.createAndFill()!),
  ]);
  const bodyRow = () =>
    t.row.create(null, [
      t.header_cell.createAndFill()!,
      ...Array.from({ length: cols - 1 }, () => t.cell.createAndFill()!),
    ]);
  return t.table.create({ matrix: true }, [row0, ...Array.from({ length: rows - 1 }, bodyRow)]);
}

/// Position context of the cell the selection is in, or null outside a table.
interface CellContext {
  tablePos: number;
  table: PmNode;
  map: TableMap;
  row: number;
  col: number;
}

export function cellContext(state: Pick<EditorState, "selection">): CellContext | null {
  if (!isInTable(state as EditorState)) return null;
  const $cell = selectionCell(state as EditorState);
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

/// Inserts a table/matrix at the cursor: replaces an empty top-level paragraph,
/// otherwise goes after the current block. Always leaves a paragraph after it
/// so the cursor can get out, and selects the first editable header cell.
function insertTableNode(create: (schema: Schema) => PmNode, matrix: boolean): Command {
  return (state, dispatch) => {
    if (isInTable(state)) return false;
    const { $from } = state.selection;
    const replaceEmpty = $from.depth === 1 && $from.parent.isTextblock && $from.parent.content.size === 0;
    const tablePos = replaceEmpty ? $from.before() : $from.parent.isTextblock ? $from.after() : $from.pos;
    const $pos = state.doc.resolve(tablePos);
    const index = $pos.index();
    if (!$pos.parent.canReplaceWith(index, replaceEmpty ? index + 1 : index, state.schema.nodes.table)) {
      return false;
    }
    if (dispatch) {
      const table = create(state.schema);
      const tr = state.tr;
      if (replaceEmpty) tr.replaceWith(tablePos, $from.after(), table);
      else tr.insert(tablePos, table);
      const end = tablePos + table.nodeSize;
      const $end = tr.doc.resolve(end);
      if (!$end.nodeAfter) tr.insert(end, state.schema.nodes.paragraph.create());
      const firstCellOffset = matrix ? TableMap.get(table).map[1] : 1;
      selectCell(tr, tablePos + 1 + firstCellOffset);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const insertTable: Command = insertTableNode(createTable, false);
export const insertMatrix: Command = insertTableNode(createMatrix, true);

/// No inserting above the header row (or left of a matrix's header column).
export const insertRowAbove: Command = (state, dispatch) =>
  isInTable(state) && selectedRect(state).top > 0 && addRowBefore(state, dispatch);
export const insertRowBelow: Command = addRowAfter;
export const insertColumnLeft: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  return (!isMatrix(rect.table) || rect.left > 0) && addColumnBefore(state, dispatch);
};
export const insertColumnRight: Command = addColumnAfter;
export const removeRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (isMatrix(rect.table) && rect.bottom - rect.top >= rect.map.height - 1) return false;
  return deleteRow(state, dispatch);
};
export const removeColumn: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (isMatrix(rect.table) && rect.right - rect.left >= rect.map.width - 1) return false;
  return deleteColumn(state, dispatch);
};
export const removeTable: Command = deleteTable;

// ── Alignment ────────────────────────────────────────────────────────────

/// In a normal table, aligns every selected column (header cell is the source
/// of truth). In a matrix, headers stay centered and each body cell carries
/// its own alignment.
function alignCells(align: Align): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const matrix = isMatrix(rect.table);
    if (matrix && (rect.bottom <= 1 || rect.right <= 1)) return false;
    if (dispatch) {
      const tr = state.tr;
      if (matrix) {
        for (let r = Math.max(1, rect.top); r < rect.bottom; r++) {
          for (let c = Math.max(1, rect.left); c < rect.right; c++) {
            const pos = rect.tableStart + rect.map.map[r * rect.map.width + c];
            const cell = state.doc.nodeAt(pos)!;
            tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
          }
        }
      } else {
        for (let col = rect.left; col < rect.right; col++) {
          const pos = rect.tableStart + rect.map.map[col];
          const cell = state.doc.nodeAt(pos)!;
          tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
        }
      }
      dispatch(tr);
    }
    return true;
  };
}
export const alignLeft = alignCells("left");
export const alignCenter = alignCells("center");
export const alignRight = alignCells("right");

// ── Transpose ────────────────────────────────────────────────────────────

/// Swaps rows and columns of a matrix: top-left corner stays empty, row/column
/// headers trade places, body cells keep their per-cell alignment, and the
/// selection stays on the transposed cell(s).
export const transposeMatrix: Command = (state, dispatch) => {
  const ctx = cellContext(state);
  if (!ctx || !isMatrix(ctx.table)) return false;
  if (dispatch) {
    const t = tableNodeTypes(state.schema);
    const { table, tablePos, map } = ctx;
    const newRows: PmNode[] = [];
    for (let r = 0; r < map.width; r++) {
      const newCells: PmNode[] = [];
      for (let c = 0; c < map.height; c++) {
        const oldCell = table.nodeAt(map.map[c * map.width + r])!;
        const want = (r === 0) !== (c === 0) ? t.header_cell : t.cell;
        const align = r > 0 && c > 0 ? (oldCell.attrs.align ?? null) : null;
        newCells.push(want.create({ ...oldCell.attrs, align }, oldCell.content, oldCell.marks));
      }
      newRows.push(t.row.create(null, newCells));
    }
    const newTable = t.table.create(table.attrs, newRows, table.marks);
    const tr = state.tr.replaceWith(tablePos, tablePos + table.nodeSize, newTable);
    const newMap = TableMap.get(newTable);
    const cellPos = (r: number, c: number) => tablePos + 1 + newMap.map[r * newMap.width + c];
    if (state.selection instanceof CellSelection) {
      const rect = selectedRect(state);
      tr.setSelection(
        CellSelection.create(
          tr.doc,
          cellPos(rect.left, rect.top),
          cellPos(rect.right - 1, rect.bottom - 1),
        ),
      );
    } else {
      const oldCellPos = tablePos + 1 + map.map[ctx.row * map.width + ctx.col];
      const oldCell = table.nodeAt(map.map[ctx.row * map.width + ctx.col])!;
      const targetPos = cellPos(ctx.col, ctx.row);
      const off = (p: number) => Math.max(1, Math.min(oldCell.nodeSize - 1, p - oldCellPos));
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          targetPos + off(state.selection.anchor),
          targetPos + off(state.selection.head),
        ),
      );
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

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
  const min = isMatrix(rect.table) ? 1 : 0;
  if (rect.left < min || (dir === -1 ? rect.left < min + 1 : rect.right >= rect.map.width)) return false;
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

/// Shift+Tab → previous cell; in a matrix, never steps into the open corner.
export const tabBackward: Command = (state, dispatch) => {
  const ctx = cellContext(state);
  if (!ctx || (isMatrix(ctx.table) && ctx.row === 0 && ctx.col <= 1)) return false;
  return goToNextCell(-1)(state, dispatch);
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
  "Shift-Tab": tabBackward,
  Enter: enterInTable,
});

// ── Header invariant ─────────────────────────────────────────────────────

/// Keeps table/matrix invariants true after any edit (row deleted, row moved,
/// paste…): normal tables keep row 0 as headers and propagate column alignment;
/// matrices keep an empty top-left corner, row 0 (except corner) and col 0 as
/// header cells without alignment, and never leave a caret inside the corner.
export const headerRowPlugin = new Plugin({
  appendTransaction(trs, oldState, state) {
    const t = tableNodeTypes(state.schema);
    const tr = state.tr;
    let changed = false;
    if (trs.some((t) => t.docChanged)) {
      state.doc.descendants((node, pos) => {
        if (node.type !== t.table) return true;
        const matrix = isMatrix(node);
        const aligns: (Align | null)[] = [];
        if (!matrix) node.firstChild?.forEach((cell) => aligns.push(cell.attrs.align ?? null));
        node.forEach((row, rowOffset, rowIndex) => {
          row.forEach((cell, cellOffset, colIndex) => {
            const cellPos = tr.mapping.map(pos + 1 + rowOffset + 1 + cellOffset);
            if (matrix) {
              const corner = rowIndex === 0 && colIndex === 0;
              const header = (rowIndex === 0) !== (colIndex === 0);
              const want = header ? t.header_cell : t.cell;
              const align = corner || header ? null : (cell.attrs.align ?? null);
              if (corner && (cell.childCount > 1 || (cell.firstChild?.content.size ?? 0) > 0)) {
                tr.replaceWith(cellPos, cellPos + cell.nodeSize, want.createAndFill()!);
                changed = true;
              } else if (cell.type !== want || (cell.attrs.align ?? null) !== align) {
                tr.setNodeMarkup(cellPos, want, { ...cell.attrs, align }, cell.marks);
                changed = true;
              }
            } else {
              const want = rowIndex === 0 ? t.header_cell : t.cell;
              const align = aligns[colIndex] ?? null;
              if (cell.type !== want || (cell.attrs.align ?? null) !== align) {
                tr.setNodeMarkup(cellPos, want, { ...cell.attrs, align }, cell.marks);
                changed = true;
              }
            }
          });
        });
        return false;
      });
    }
    const curCtx = cellContext({ selection: tr.selection });
    if (
      curCtx &&
      isMatrix(curCtx.table) &&
      curCtx.row === 0 &&
      curCtx.col === 0 &&
      !(tr.selection instanceof CellSelection)
    ) {
      const oldCtx = cellContext(oldState);
      if (
        !changed &&
        !trs.some((t) => t.docChanged) &&
        oldCtx &&
        oldCtx.tablePos === curCtx.tablePos &&
        (oldCtx.row !== 0 || oldCtx.col !== 0)
      ) {
        tr.setSelection(TextSelection.create(tr.doc, oldState.selection.anchor, oldState.selection.head));
        changed = true;
      } else if (curCtx.map.width > 1 || curCtx.map.height > 1) {
        const nextOffset = curCtx.map.width > 1 ? curCtx.map.map[1] : curCtx.map.map[curCtx.map.width];
        selectCell(tr, curCtx.tablePos + 1 + nextOffset);
        changed = true;
      }
    }
    return changed ? tr : null;
  },
});

/// Plugins in the order the editor needs them: keymap first (so Enter/Tab in a
/// cell beat the list and base keymaps), then the library's cell-selection
/// handling and the header invariant.
export const tablePlugins = (): Plugin[] => [tableKeymap, tableEditing(), headerRowPlugin];
