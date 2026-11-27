/// Visual floating controls for tables and matrices:
/// 1. A persistent `popover="manual"` toolbar (`.table-bar`) anchored to the
///    visible portion of the active table, staying open across repeated clicks
///    (move, insert, align, transpose, delete) and clamping to the editor
///    scrollport on tall or wide tables.
/// 2. Bottom (`+` row) and right (`+` column) edge strips (`popover="manual"`).
/// 3. A `(0, 0)` corner transpose button inside matrices (`Decoration.widget`).

import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { selectionCell } from "prosemirror-tables";
import { hidePopoverSafe, showPopoverSafe } from "./floatingPopup";
import { onOverlayOpen } from "./overlayLayers";
import { ICONS, svg } from "./tableIcons";
import {
  type Align,
  alignCenter,
  alignLeft,
  alignRight,
  appendColumnRight,
  appendRowBottom,
  cellContext,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  isMatrix,
  moveColumnLeft,
  moveColumnRight,
  moveRowDown,
  moveRowUp,
  removeColumn,
  removeRow,
  removeTable,
  transposeMatrix,
} from "./tables";
import type { Command, EditorState } from "prosemirror-state";

interface BarItem {
  label: string;
  icon: string;
  group: number;
  danger?: boolean;
  active?: (state: EditorState) => boolean;
  command: Command;
}

function activeAlign(state: EditorState): Align | null {
  const ctx = cellContext(state);
  if (!ctx) return null;
  if (isMatrix(ctx.table)) {
    if (ctx.row === 0 || ctx.col === 0) return null;
    const cell = ctx.table.nodeAt(ctx.map.map[ctx.row * ctx.map.width + ctx.col]);
    return (cell?.attrs.align as Align | null) ?? "left";
  }
  const header = ctx.table.nodeAt(ctx.map.map[ctx.col]);
  return (header?.attrs.align as Align | null) ?? "left";
}

const alignActive = (target: Align) => (state: EditorState): boolean => {
  const ctx = cellContext(state);
  if (!ctx) return false;
  if (isMatrix(ctx.table) && (ctx.row === 0 || ctx.col === 0)) return false;
  return activeAlign(state) === target;
};

const BAR_ITEMS: BarItem[] = [
  { label: "Move row up", icon: ICONS.moveUp, group: 0, command: moveRowUp },
  { label: "Move row down", icon: ICONS.moveDown, group: 0, command: moveRowDown },
  { label: "Move column left", icon: ICONS.moveLeft, group: 0, command: moveColumnLeft },
  { label: "Move column right", icon: ICONS.moveRight, group: 0, command: moveColumnRight },

  { label: "Insert row above", icon: ICONS.rowAbove, group: 1, command: insertRowAbove },
  { label: "Insert row below", icon: ICONS.rowBelow, group: 1, command: insertRowBelow },
  { label: "Insert column left", icon: ICONS.colLeft, group: 1, command: insertColumnLeft },
  { label: "Insert column right", icon: ICONS.colRight, group: 1, command: insertColumnRight },

  { label: "Align left", icon: ICONS.alignLeft, group: 2, active: alignActive("left"), command: alignLeft },
  { label: "Align center", icon: ICONS.alignCenter, group: 2, active: alignActive("center"), command: alignCenter },
  { label: "Align right", icon: ICONS.alignRight, group: 2, active: alignActive("right"), command: alignRight },

  { label: "Transpose matrix", icon: ICONS.transpose, group: 3, command: transposeMatrix },

  { label: "Delete row", icon: ICONS.deleteRow, group: 4, danger: true, command: removeRow },
  { label: "Delete column", icon: ICONS.deleteColumn, group: 4, danger: true, command: removeColumn },
  { label: "Delete table", icon: ICONS.deleteTable, group: 4, danger: true, command: removeTable },
];

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  let cur = el.parentElement;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const ov = getComputedStyle(cur).overflowY;
    if (ov === "auto" || ov === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

interface Bounds {
  top: number;
  menubarBottom: number;
  bottom: number;
  left: number;
  right: number;
}

function visibleBounds(view: EditorView): Bounds {
  const margin = 8;
  let top = margin;
  let bottom = window.innerHeight - margin;
  let left = margin;
  let right = window.innerWidth - margin;

  const scroller = findScrollContainer(view.dom);
  if (scroller) {
    const sr = scroller.getBoundingClientRect();
    top = Math.max(top, sr.top + 4);
    bottom = Math.min(bottom, sr.bottom - 4);
    left = Math.max(left, sr.left + 4);
    right = Math.min(right, sr.right - 4);
  }

  let menubarBottom = top;
  const wrapper = view.dom.closest(".editor-wrapper");
  const menubar = wrapper?.querySelector(".ProseMirror-menubar");
  if (menubar) {
    const mr = menubar.getBoundingClientRect();
    if (mr.height > 0) menubarBottom = Math.max(top, mr.bottom + 2);
  }

  return { top, menubarBottom, bottom, left, right };
}

function activeTableElement(view: EditorView, tablePos: number): HTMLTableElement | null {
  const dom = view.nodeDOM(tablePos);
  if (dom instanceof HTMLTableElement) return dom;
  if (dom instanceof HTMLElement) return dom.querySelector("table");
  return null;
}

function activeCellElement(view: EditorView): HTMLElement | null {
  try {
    const $cell = selectionCell(view.state);
    if (!$cell) return null;
    const dom = view.nodeDOM($cell.pos);
    return dom instanceof HTMLElement ? dom : null;
  } catch {
    return null;
  }
}

function makeEdgeButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `table-edge-add ${className}`;
  btn.setAttribute("popover", "manual");
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = svg(ICONS.plus, 12);
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", onClick);
  return btn;
}

/// ProseMirror plugin providing the floating table toolbar, edge `+` strips,
/// and matrix `(0, 0)` corner transpose widget.
export function tableBarPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const ctx = cellContext(state);
        if (!ctx || !isMatrix(ctx.table)) return DecorationSet.empty;
        const firstRow = ctx.table.firstChild;
        const corner = firstRow?.firstChild;
        if (!corner) return DecorationSet.empty;
        // Inside `(0, 0)` cell's paragraph so `tr`/`td` structure stays intact;
        // positioned `position: absolute` in CSS so row 0 height never changes.
        const widgetPos = ctx.tablePos + 3;
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            widgetPos,
            (view) => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "matrix-transpose-btn";
              btn.tabIndex = -1;
              btn.contentEditable = "false";
              btn.title = "Transpose matrix";
              btn.setAttribute("aria-label", "Transpose matrix");
              btn.innerHTML = svg(ICONS.transpose, 14);
              btn.addEventListener("mousedown", (e) => e.preventDefault());
              btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                transposeMatrix(view.state, view.dispatch);
                view.focus();
              });
              return btn;
            },
            { side: -1, ignoreSelection: true },
          ),
        ]);
      },
    },

    view(editorView) {
      const container = editorView.dom.parentElement ?? document.body;

      const bar = document.createElement("div");
      bar.className = "table-bar";
      bar.setAttribute("popover", "manual");
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Table actions");

      const buttons: { item: BarItem; btn: HTMLButtonElement }[] = [];
      let lastGroup = -1;
      for (const item of BAR_ITEMS) {
        if (lastGroup !== -1 && item.group !== lastGroup) {
          const sep = document.createElement("span");
          sep.className = "table-bar-sep";
          sep.setAttribute("aria-hidden", "true");
          bar.appendChild(sep);
        }
        lastGroup = item.group;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "table-bar-btn";
        if (item.danger) btn.classList.add("table-bar-btn--danger");
        btn.title = item.label;
        btn.setAttribute("aria-label", item.label);
        btn.innerHTML = svg(item.icon, 15);
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", () => {
          item.command(editorView.state, editorView.dispatch, editorView);
          editorView.focus();
          sync();
        });
        bar.appendChild(btn);
        buttons.push({ item, btn });
      }

      const edgeRow = makeEdgeButton("table-edge-add--row", "Add row at bottom", () => {
        appendRowBottom(editorView.state, editorView.dispatch);
        editorView.focus();
        sync();
      });
      const edgeCol = makeEdgeButton("table-edge-add--col", "Add column at right", () => {
        appendColumnRight(editorView.state, editorView.dispatch);
        editorView.focus();
        sync();
      });

      const hideAll = () => {
        hidePopoverSafe(bar);
        hidePopoverSafe(edgeRow);
        hidePopoverSafe(edgeCol);
      };

      const sync = () => {
        if (!editorView.dom.isConnected) {
          hideAll();
          return;
        }
        const ctx = cellContext(editorView.state);
        if (!ctx || !editorView.hasFocus()) {
          hideAll();
          return;
        }

        const tableEl = activeTableElement(editorView, ctx.tablePos);
        const cellEl = activeCellElement(editorView);
        if (!tableEl || !cellEl) {
          hideAll();
          return;
        }

        const bounds = visibleBounds(editorView);
        const tableRect = tableEl.getBoundingClientRect();
        const cellRect = cellEl.getBoundingClientRect();

        if (
          tableRect.width === 0 ||
          tableRect.bottom <= bounds.top ||
          tableRect.top >= bounds.bottom
        ) {
          hideAll();
          return;
        }

        const matrix = isMatrix(ctx.table);
        for (const { item, btn } of buttons) {
          if (item.group === 3) {
            btn.hidden = !matrix;
          }
          const enabled = item.command(editorView.state, undefined, editorView);
          btn.disabled = !enabled;
          if (item.active) {
            const on = item.active(editorView.state);
            btn.classList.toggle("table-bar-btn--active", on);
            btn.setAttribute("aria-pressed", String(on));
          }
        }

        // Update separator visibility around the matrix-only Transpose group.
        const seps = bar.querySelectorAll<HTMLElement>(".table-bar-sep");
        if (seps[2]) seps[2].hidden = !matrix;

        if (bar.parentElement !== container) container.appendChild(bar);
        if (edgeRow.parentElement !== container) container.appendChild(edgeRow);
        if (edgeCol.parentElement !== container) container.appendChild(edgeCol);

        showPopoverSafe(bar);
        const barRect = bar.getBoundingClientRect();
        const gap = 6;

        // Position monotonically above the table, clamped to `[menubarBottom,
        // tableRect.bottom - barHeight]` so it never overlaps the menubar,
        // becomes sticky immediately at `menubarBottom` when scrolling down,
        // and never jumps to the bottom of the table or active cell.
        const desiredTop = tableRect.top - barRect.height - gap;
        const maxTop = tableRect.bottom - barRect.height;
        const top = Math.min(maxTop, Math.max(bounds.menubarBottom, desiredTop));

        const anchorCenter =
          tableRect.width <= bounds.right - bounds.left
            ? (tableRect.left + tableRect.right) / 2
            : (cellRect.left + cellRect.right) / 2;
        const left = Math.max(
          bounds.left,
          Math.min(anchorCenter - barRect.width / 2, bounds.right - barRect.width),
        );

        bar.style.top = `${Math.round(top)}px`;
        bar.style.left = `${Math.round(left)}px`;

        // Bottom `+` row tab (straddles the bottom border so it never covers the paragraph below)
        const rowCenterX = (Math.max(bounds.left, tableRect.left) + Math.min(bounds.right, tableRect.right)) / 2;
        const rowTabTop = tableRect.bottom - 7;
        if (
          rowTabTop >= bounds.top &&
          rowTabTop + 14 <= bounds.bottom &&
          tableRect.right - tableRect.left >= 40
        ) {
          showPopoverSafe(edgeRow);
          edgeRow.style.top = `${Math.round(rowTabTop)}px`;
          edgeRow.style.left = `${Math.round(rowCenterX - 18)}px`;
          edgeRow.style.width = "36px";
        } else {
          hidePopoverSafe(edgeRow);
        }

        // Right `+` column tab (straddles the right border)
        const colCenterY = (Math.max(bounds.top, tableRect.top) + Math.min(bounds.bottom, tableRect.bottom)) / 2;
        const colTabLeft = tableRect.right - 7;
        if (
          colTabLeft >= bounds.left &&
          colTabLeft + 14 <= bounds.right &&
          tableRect.bottom - tableRect.top >= 32
        ) {
          showPopoverSafe(edgeCol);
          edgeCol.style.top = `${Math.round(colCenterY - 16)}px`;
          edgeCol.style.left = `${Math.round(colTabLeft)}px`;
          edgeCol.style.height = "32px";
        } else {
          hidePopoverSafe(edgeCol);
        }
      };

      const onBlur = () => {
        requestAnimationFrame(() => {
          if (!editorView.hasFocus()) hideAll();
        });
      };

      const releaseOverlay = onOverlayOpen((overlayEl) => {
        if (overlayEl !== bar && overlayEl !== edgeRow && overlayEl !== edgeCol) {
          hideAll();
        }
      });

      let rafId = 0;
      const onScroll = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          sync();
        });
      };

      editorView.dom.addEventListener("focus", sync);
      editorView.dom.addEventListener("blur", onBlur);
      window.addEventListener("resize", onScroll);
      window.addEventListener("scroll", onScroll, true);

      return {
        update() {
          sync();
        },
        destroy() {
          if (rafId) cancelAnimationFrame(rafId);
          releaseOverlay();
          editorView.dom.removeEventListener("focus", sync);
          editorView.dom.removeEventListener("blur", onBlur);
          window.removeEventListener("resize", onScroll);
          window.removeEventListener("scroll", onScroll, true);
          hideAll();
          bar.remove();
          edgeRow.remove();
          edgeCol.remove();
        },
      };
    },
  });
}
