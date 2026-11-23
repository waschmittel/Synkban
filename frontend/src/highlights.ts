/// Text highlighting in the description editor (ADR-0031): 8 semantic colors
/// that adapt across Light, Dark, and PDF themes, a last-used-color default
/// toggle (split button left / Accel+K → H), a compact visual swatch popover
/// (split button right, no labels or key hints), and a keyboard-driven color
/// picker (Accel+K → G).

import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { openFloatingPopup, type AnchorTarget, type FloatingPopupHandle } from "./floatingPopup";
import { menuNav, navKey } from "./menuNav";
import { tip } from "./platform";
import { schema, type HighlightColor } from "./schema";
import { ICONS, svg } from "./tableIcons";

export interface HighlightDef {
  id: HighlightColor;
  label: string;
  key: string;
}

export const HIGHLIGHT_COLORS: readonly HighlightDef[] = [
  { id: "yellow", label: "Yellow", key: "1" },
  { id: "orange", label: "Orange", key: "2" },
  { id: "red", label: "Red", key: "3" },
  { id: "pink", label: "Pink", key: "4" },
  { id: "purple", label: "Purple", key: "5" },
  { id: "blue", label: "Blue", key: "6" },
  { id: "green", label: "Green", key: "7" },
  { id: "gray", label: "Gray", key: "8" },
];

const highlightMark = schema.marks.highlight;

let lastHighlightColor: HighlightColor = "yellow";

export function getLastHighlightColor(): HighlightColor {
  return lastHighlightColor;
}

export function setLastHighlightColor(color: HighlightColor): void {
  lastHighlightColor = color;
}

export function highlightLabel(color: HighlightColor): string {
  return HIGHLIGHT_COLORS.find((h) => h.id === color)?.label ?? color;
}

/// Finds the contiguous highlighted range surrounding `pos` in its parent
/// textblock, or null when `pos` is not inside a highlighted text run.
export function highlightRangeAt(
  state: EditorState,
  pos: number,
): { color: HighlightColor; from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const mark = highlightMark.isInSet($pos.marks());
  if (!mark) return null;

  let startIndex = $pos.index();
  let endIndex = $pos.indexAfter();
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) startIndex--;
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) endIndex++;

  let from = $pos.start();
  let to = from;
  for (let i = 0; i < endIndex; i++) {
    const size = parent.child(i).nodeSize;
    if (i < startIndex) from += size;
    to += size;
  }
  return from < to ? { color: mark.attrs.color as HighlightColor, from, to } : null;
}

/// True when the selection can receive a highlight mark (false inside code/Lua blocks).
export function canHighlight(state: EditorState): boolean {
  const { selection, doc } = state;
  if (selection.empty) {
    return selection.$from.parent.type.allowsMarkType(highlightMark);
  }
  for (const { $from, $to } of selection.ranges) {
    let applies = $from.depth === 0 ? doc.type.allowsMarkType(highlightMark) : false;
    doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (applies) return false;
      applies = node.inlineContent && node.type.allowsMarkType(highlightMark);
    });
    if (applies) return true;
  }
  return false;
}

/// Returns the highlight color if the entire selection (or caret) has that single color.
export function activeHighlight(state: EditorState): HighlightColor | null {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    const marks = state.storedMarks || $from.marks();
    const m = highlightMark.isInSet(marks);
    return m ? (m.attrs.color as HighlightColor) : null;
  }
  let color: HighlightColor | null = null;
  let sawText = false;
  let uniform = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (!uniform) return false;
    if (!node.isText) return true;
    sawText = true;
    const m = highlightMark.isInSet(node.marks);
    const c = m ? (m.attrs.color as HighlightColor) : null;
    if (!c) {
      uniform = false;
    } else if (color === null) {
      color = c;
    } else if (color !== c) {
      uniform = false;
    }
    return false;
  });
  return sawText && uniform ? color : null;
}

/// True when the caret or any part of the selection carries a highlight mark.
export function hasAnyHighlight(state: EditorState): boolean {
  const { from, to, empty, $from } = state.selection;
  if (empty) {
    return !!highlightMark.isInSet(state.storedMarks || $from.marks());
  }
  return state.doc.rangeHasMark(from, to, highlightMark);
}

/// Applies `color` to the selection (or to the surrounding highlighted run when
/// the caret is inside one) and remembers `color` as the last used highlight.
/// If the selection is already uniformly `color`, toggles it off.
export function setHighlight(color: HighlightColor): Command {
  return (state, dispatch) => {
    if (!canHighlight(state)) return false;
    if (dispatch) {
      setLastHighlightColor(color);
      if (activeHighlight(state) === color) {
        return clearHighlight(state, dispatch);
      }
      const mark = highlightMark.create({ color });
      const tr = state.tr;
      if (state.selection.empty) {
        const range = highlightRangeAt(state, state.selection.from);
        if (range) {
          tr.addMark(range.from, range.to, mark);
        } else {
          tr.addStoredMark(mark);
        }
      } else {
        for (const { $from, $to } of state.selection.ranges) {
          tr.addMark($from.pos, $to.pos, mark);
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/// Removes any highlight mark from the selection, from the highlighted run
/// under a collapsed caret, or from stored marks.
export const clearHighlight: Command = (state, dispatch) => {
  if (!hasAnyHighlight(state)) return false;
  if (dispatch) {
    const tr = state.tr;
    if (state.selection.empty) {
      const range = highlightRangeAt(state, state.selection.from);
      if (range) tr.removeMark(range.from, range.to, highlightMark);
      tr.removeStoredMark(highlightMark);
    } else {
      for (const { $from, $to } of state.selection.ranges) {
        tr.removeMark($from.pos, $to.pos, highlightMark);
      }
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/// Default highlight action (split button left / Accel+K → H): removes the
/// highlight when highlighted text is selected or the caret sits inside a
/// highlighted run; otherwise applies the last used highlight color.
export const toggleDefaultHighlight: Command = (state, dispatch, view) => {
  if (!canHighlight(state)) return false;
  if (hasAnyHighlight(state)) return clearHighlight(state, dispatch, view);
  return setHighlight(lastHighlightColor)(state, dispatch, view);
};

let close: (() => void) | null = null;

export interface PickerOptions {
  at?: { x: number; y: number };
}

function popupAnchor(view: EditorView, opts: PickerOptions): AnchorTarget {
  return () =>
    opts.at
      ? { left: opts.at.x, top: opts.at.y, bottom: opts.at.y }
      : view.coordsAtPos(view.state.selection.head);
}

/// Compact visual swatch popover opened from the right half of the toolbar
/// split button: pure color swatches (no color names, no keyboard hints) plus
/// a compact clear button.
export function openHighlightSwatchPopover(view: EditorView, opts: PickerOptions = {}): void {
  if (close) {
    close();
    return;
  }
  if (!canHighlight(view.state)) return;

  const menu = document.createElement("div");
  menu.className = "highlight-swatch-popover";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Highlight color");

  const current = activeHighlight(view.state);
  const anyOn = hasAnyHighlight(view.state);

  const run = (cmd: Command) => {
    if (!cmd(view.state, view.dispatch, view)) return;
    dispose();
  };

  const grid = document.createElement("div");
  grid.className = "highlight-swatch-grid";
  for (const h of HIGHLIGHT_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "highlight-swatch-btn";
    const on = current === h.id;
    btn.setAttribute("role", "menuitemcheckbox");
    btn.setAttribute("aria-checked", String(on));
    btn.setAttribute("aria-label", h.label);
    btn.classList.toggle("highlight-swatch-btn--active", on);
    btn.dataset.highlight = h.id;
    btn.dataset.highlightColor = h.id;
    btn.title = h.label;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => run(setHighlight(h.id)));
    grid.appendChild(btn);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "highlight-swatch-btn highlight-swatch-clear";
  clearBtn.setAttribute("role", "menuitem");
  clearBtn.setAttribute("aria-label", "Clear highlight");
  clearBtn.dataset.highlightClear = "";
  clearBtn.title = "Clear highlight";
  clearBtn.disabled = !anyOn;
  clearBtn.innerHTML = svg(ICONS.clearHighlight, 13);
  clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
  clearBtn.addEventListener("click", () => run(clearHighlight));
  grid.appendChild(clearBtn);

  menu.appendChild(grid);

  let popup: FloatingPopupHandle | null = null;
  function dispose() {
    popup?.dispose();
  }
  close = dispose;

  popup = openFloatingPopup({
    el: menu,
    container: view.dom.parentElement ?? document.body,
    anchor: popupAnchor(view, opts),
    ignoreOutside: (t) => !!t?.closest(".highlight-split-chevron"),
    onKey(e) {
      if (!view.dom.isConnected) return dispose();
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dispose();
      }
    },
    onClose() {
      popup = null;
      if (close === dispose) close = null;
      view.focus();
    },
  });
}

/// Full keyboard-driven highlight color picker opened from Accel+K → G:
/// shows color names and single-key hints (1–8 color, 0 clear).
export function openHighlightPicker(view: EditorView, opts: PickerOptions = {}): void {
  if (close) {
    close();
    return;
  }
  if (!canHighlight(view.state)) return;

  const menu = document.createElement("div");
  menu.className = "table-menu highlight-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Highlight color");
  const nav = menuNav(menu);

  const current = activeHighlight(view.state);
  const anyOn = hasAnyHighlight(view.state);

  const run = (cmd: Command) => {
    if (!cmd(view.state, view.dispatch, view)) return;
    dispose();
  };

  for (const h of HIGHLIGHT_COLORS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "table-menu-item";
    const on = current === h.id;
    btn.setAttribute("role", "menuitemcheckbox");
    btn.setAttribute("aria-checked", String(on));
    btn.classList.toggle("table-menu-item--active", on);
    btn.dataset.highlightColor = h.id;
    btn.title = tip(h.label, h.key);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => run(setHighlight(h.id)));

    const swatch = document.createElement("span");
    swatch.className = "highlight-menu-swatch";
    swatch.dataset.highlight = h.id;
    swatch.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "table-menu-label";
    text.textContent = h.label;

    const kbd = document.createElement("kbd");
    kbd.textContent = h.key;

    btn.append(swatch, text, kbd);
    menu.appendChild(btn);
  }

  const sep = document.createElement("div");
  sep.className = "table-menu-sep";
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "table-menu-item";
  clearBtn.setAttribute("role", "menuitem");
  clearBtn.dataset.highlightClear = "";
  clearBtn.title = tip("Clear highlight", "0");
  clearBtn.disabled = !anyOn;
  clearBtn.addEventListener("mousedown", (e) => e.preventDefault());
  clearBtn.addEventListener("click", () => run(clearHighlight));

  const clearIcon = document.createElement("span");
  clearIcon.className = "table-menu-icon";
  clearIcon.setAttribute("aria-hidden", "true");
  clearIcon.innerHTML = svg(ICONS.clearHighlight);

  const clearLabel = document.createElement("span");
  clearLabel.className = "table-menu-label";
  clearLabel.textContent = "Clear highlight";

  const clearKbd = document.createElement("kbd");
  clearKbd.textContent = "0";

  clearBtn.append(clearIcon, clearLabel, clearKbd);
  menu.appendChild(clearBtn);

  const foot = document.createElement("div");
  foot.className = "table-menu-foot";
  foot.textContent = "1–8 color · 0 clear · Esc to close";
  menu.appendChild(foot);

  let popup: FloatingPopupHandle | null = null;
  function dispose() {
    popup?.dispose();
  }
  close = dispose;

  popup = openFloatingPopup({
    el: menu,
    container: view.dom.parentElement ?? document.body,
    anchor: popupAnchor(view, opts),
    onKey(e) {
      if (!view.dom.isConnected) return dispose();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return dispose();
      if (e.key === "Enter") return void (nav.activate() || dispose());
      if (navKey(nav, e)) return;
      if (e.key === "0") return run(clearHighlight);
      const hit = HIGHLIGHT_COLORS.find((h) => h.key === e.key);
      if (hit) run(setHighlight(hit.id));
    },
    onClose() {
      popup = null;
      if (close === dispose) close = null;
      view.focus();
    },
  });
  nav.edge(false);
}
