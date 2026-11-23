/// The editor menu (Accel+K or right-click anywhere in the editor — the same
/// menu, anchored at the pointer).
///
/// One mechanism for keyboard and touch: the menu is a small popup beside the
/// caret whose items are clickable *and* carry single-key shortcuts that are
/// shown on screen — so no modifier chord has to be found for every operation,
/// and the only global chord is the one that opens the menu.
///
/// Keyboard focus never leaves the editor (items swallow `mousedown`), which
/// keeps the selection and the touch keyboard intact. While the menu is open it
/// owns the keyboard via `dialogKeys`, so typed letters can't leak into the
/// document. Every action closes the menu once it has run; an action that is
/// not possible right now (shown disabled) is ignored and the menu stays open.
/// Related actions are grouped, separated by a divider. The menu adapts to the
/// context: link · inline code · text style (not in table cells, where the
/// block type is fixed) · then either "insert table" or the table actions.
/// Keys:
///
///   always            l link (add/edit) · u remove link · i inline code · h highlight · g highlight color · m image · f footnote
///                     ↑ ↓ Home End move a highlight, Enter runs it
///   outside a table   0 plain · b code block · e lua block · 1/2/3 heading · t table · x matrix · a alert
///   inside a list     c … convert between bullet and ordered list
///   in a block/table  Shift+P / P … insert paragraph above / below
///   inside a table    w s / a d … move the row up, down / column left, right
///                     x … transpose (matrix only)
///                     Shift+arrow … insert a row / column in that direction
///                     1 / 2 / 3 … align column (matrix: cell) left / center / right
///                     r / c / t … delete row / column / table (or matrix)
///   always            Esc / Accel+K … close

import type { EditorView } from "prosemirror-view";
import type { Command, EditorState } from "prosemirror-state";
import { toggleMark } from "prosemirror-commands";
import { linkTarget, markActive, openLinkEditor, removeLink } from "./links";
import { TEXT_STYLES, schema } from "./schema";
import { openFloatingPopup, type FloatingPopupHandle } from "./floatingPopup";
import { accel, hasAccel, isMac, tip } from "./platform";
import { ICONS, MATRIX_ICON, TABLE_ICON, svg } from "./tableIcons";
import { menuNav, navKey } from "./menuNav";
import { canInsertImage, hooksOf, openImagePicker } from "./imagePicker";
import { canHighlight, hasAnyHighlight, openHighlightPicker, toggleDefaultHighlight } from "./highlights";
import { alertAt, canInsertAlert, openAlertPicker } from "./alerts";
import { inEscapableBlock, insertParagraphAbove, insertParagraphBelow } from "./blockEscape";
import { convertListLabel, enclosingList, toggleListType } from "./lists";
import {
  deleteCurrentFootnote,
  footnoteDefAt,
  footnoteMenuCommand,
  footnoteMenuLabel,
} from "./footnotes";

import {
  cellContext,
  insertColumnLeft,
  insertColumnRight,
  insertMatrix,
  insertRowAbove,
  insertRowBelow,
  isMatrix,
  alignCenter,
  alignLeft,
  alignRight,
  insertTable,
  moveColumnLeft,
  moveColumnRight,
  moveRowDown,
  moveRowUp,
  removeColumn,
  removeRow,
  removeTable,
  transposeMatrix,
} from "./tables";

const SHIFT = isMac ? "⇧" : "Shift+";

interface Item {
  label: string | ((state: EditorState) => string);
  /// Shown with a highlight (current style, mark in effect).
  active?: (state: EditorState) => boolean;
  danger?: boolean;
  /// Inner markup of a 24×24 stroke icon (see tableIcons.ts).
  icon: string | ((state: EditorState) => string);
  /// Items of one group sit together; a divider separates groups.
  group: number;
  /// Text shown in the key hint, e.g. "⇧↑".
  hint: string;
  /// Matches a keydown (menu open) — null when the item is mouse-only.
  match: (e: KeyboardEvent) => boolean;
  command: Command;
}

const arrow = (key: string, shift: boolean) => (e: KeyboardEvent) =>
  e.key === key && e.shiftKey === shift;
const letter = (ch: string, shift = false) => (e: KeyboardEvent) =>
  e.shiftKey === shift && e.key.toLowerCase() === ch;

const digit = (d: string) => (e: KeyboardEvent) => !e.shiftKey && e.key === d;

const linkType = schema.marks.link;
const codeMark = schema.marks.code;

const LINK_ITEMS: Item[] = [
  {
    label: (s) => (linkTarget(s, linkType)?.mark ? "Edit link…" : "Add link…"),
    icon: ICONS.link,
    group: 0,
    hint: "L",
    active: (s) => markActive(s, linkType),
    match: letter("l"),
    command: (s, d, v) => {
      if (!linkTarget(s, linkType)) return false;
      if (d && v) openLinkEditor(v, linkType);
      return true;
    },
  },
  {
    label: "Remove link",
    icon: ICONS.unlink,
    group: 0,
    hint: "U",
    match: letter("u"),
    command: (s, d, v) => {
      if (!linkTarget(s, linkType)?.mark) return false;
      if (d && v) removeLink(v, linkType);
      return true;
    },
  },
];

const CODE_ITEM: Item = {
  label: "Inline code",
  icon: ICONS.code,
  group: 1,
  hint: "I",
  active: (s) => markActive(s, codeMark),
  match: letter("i"),
  command: toggleMark(codeMark),
};

const HIGHLIGHT_ITEM: Item = {
  label: (s) => (hasAnyHighlight(s) ? "Remove highlight" : "Highlight"),
  icon: ICONS.highlight,
  group: 1,
  hint: "H",
  active: (s) => hasAnyHighlight(s),
  match: letter("h"),
  command: toggleDefaultHighlight,
};

const HIGHLIGHT_COLOR_ITEM: Item = {
  label: "Highlight color…",
  icon: ICONS.highlight,
  group: 1,
  hint: "G",
  match: letter("g"),
  command: (s, d, v) => {
    if (!canHighlight(s)) return false;
    if (d && v) setTimeout(() => openHighlightPicker(v), 0);
    return true;
  },
};

const IMAGE_ITEM: Item = {
  label: "Insert image…",
  icon: ICONS.image,
  group: 1,
  hint: "M",
  match: letter("m"),
  command: (s, d, v) => {
    if (!v || !hooksOf(v) || !canInsertImage(s)) return false;
    // After this menu has closed (it re-focuses the editor on close).
    if (d) setTimeout(() => openImagePicker(v), 0);
    return true;
  },
};

const FOOTNOTE_ITEM: Item = {
  label: footnoteMenuLabel,
  icon: ICONS.footnote,
  group: 1,
  hint: "F",
  match: letter("f"),
  command: footnoteMenuCommand,
};

const DELETE_FOOTNOTE_ITEM: Item = {
  label: "Delete footnote",
  icon: ICONS.deleteTable,
  group: 7,
  danger: true,
  hint: "D",
  match: letter("d"),
  command: deleteCurrentFootnote,
};

const STYLE_ICONS = [ICONS.paragraph, ICONS.codeBlock, ICONS.luaBlock, ICONS.heading1, ICONS.heading2, ICONS.heading3];
const STYLE_ITEMS: Item[] = TEXT_STYLES.map((t, i) => ({
  label: t.label,
  icon: STYLE_ICONS[i],
  group: 2,
  hint: t.key.toUpperCase(),
  active: t.active,
  match: letter(t.key),
  // The current style is a no-op choice, not a disabled one.
  command: (s, d, v) => t.command(s, d, v) || t.active(s),
}));

const inMatrix = (s: EditorState) => {
  const c = cellContext(s);
  return !!c && isMatrix(c.table);
};

const MOVE_ITEMS: Item[] = [
  { label: "Move row up", icon: ICONS.moveUp, group: 3, hint: "W", match: letter("w"), command: moveRowUp },
  { label: "Move row down", icon: ICONS.moveDown, group: 3, hint: "S", match: letter("s"), command: moveRowDown },
  { label: "Move column left", icon: ICONS.moveLeft, group: 3, hint: "A", match: letter("a"), command: moveColumnLeft },
  { label: "Move column right", icon: ICONS.moveRight, group: 3, hint: "D", match: letter("d"), command: moveColumnRight },
];

const TRANSPOSE_ITEM: Item = {
  label: "Transpose",
  icon: ICONS.transpose,
  group: 3,
  hint: "X",
  match: letter("x"),
  command: transposeMatrix,
};

const TABLE_REST_ITEMS: Item[] = [
  // Insert
  { label: "Insert row above", icon: ICONS.rowAbove, group: 4, hint: `${SHIFT}↑`, match: arrow("ArrowUp", true), command: insertRowAbove },
  { label: "Insert row below", icon: ICONS.rowBelow, group: 4, hint: `${SHIFT}↓`, match: arrow("ArrowDown", true), command: insertRowBelow },
  { label: "Insert column left", icon: ICONS.colLeft, group: 4, hint: `${SHIFT}←`, match: arrow("ArrowLeft", true), command: insertColumnLeft },
  { label: "Insert column right", icon: ICONS.colRight, group: 4, hint: `${SHIFT}→`, match: arrow("ArrowRight", true), command: insertColumnRight },
  // Align
  { label: (s) => (inMatrix(s) ? "Align cell left" : "Align column left"), icon: ICONS.alignLeft, group: 5, hint: "1", match: digit("1"), command: alignLeft },
  { label: (s) => (inMatrix(s) ? "Align cell center" : "Align column center"), icon: ICONS.alignCenter, group: 5, hint: "2", match: digit("2"), command: alignCenter },
  { label: (s) => (inMatrix(s) ? "Align cell right" : "Align column right"), icon: ICONS.alignRight, group: 5, hint: "3", match: digit("3"), command: alignRight },
];

const CONVERT_LIST_ITEM: Item = {
  label: convertListLabel,
  icon: (s) => (enclosingList(s)?.node.type === schema.nodes.ordered_list ? ICONS.bulletList : ICONS.orderedList),
  group: 5,
  hint: "C",
  match: letter("c"),
  command: toggleListType,
};

const PARAGRAPH_ITEMS: Item[] = [
  { label: "Insert paragraph above", icon: ICONS.paraAbove, group: 6, hint: `${SHIFT}P`, match: letter("p", true), command: insertParagraphAbove },
  { label: "Insert paragraph below", icon: ICONS.paraBelow, group: 6, hint: "P", match: letter("p"), command: insertParagraphBelow },
];

const TABLE_DELETE_ITEMS: Item[] = [
  // Delete
  { label: "Delete row", icon: ICONS.deleteRow, group: 7, danger: true, hint: "R", match: letter("r"), command: removeRow },
  { label: "Delete column", icon: ICONS.deleteColumn, group: 7, danger: true, hint: "C", match: letter("c"), command: removeColumn },
  { label: (s) => (inMatrix(s) ? "Delete matrix" : "Delete table"), icon: ICONS.deleteTable, group: 7, danger: true, hint: "T", match: letter("t"), command: removeTable },
];

const INSERT_ITEMS: Item[] = [
  { label: "Insert table (3×3)", icon: TABLE_ICON, group: 3, hint: "T", match: letter("t"), command: insertTable },
  { label: "Insert matrix (3×3)", icon: MATRIX_ICON, group: 3, hint: "X", match: letter("x"), command: insertMatrix },
  {
    label: (s) => (alertAt(s) ? "Change alert…" : "Insert alert…"),
    icon: ICONS.alert,
    group: 3,
    hint: "A",
    active: (s) => alertAt(s) !== null,
    match: letter("a"),
    command: (s, d, v) => {
      if (!canInsertAlert(s)) return false;
      if (d && v) setTimeout(() => openAlertPicker(v), 0);
      return true;
    },
  },
];

let close: (() => void) | null = null;

/// Opens the menu for `view`, or closes it if it is already open.
export interface MenuOptions {
  /// Anchor at this viewport point instead of the caret.
  at?: { x: number; y: number };
}

export function openEditorMenu(view: EditorView, opts: MenuOptions = {}): void {
  if (close) {
    close();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "table-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Editor");

  const items = (): Item[] => {
    const ctx = cellContext(view.state);
    if (!ctx) {
      return [
        ...LINK_ITEMS,
        CODE_ITEM,
        HIGHLIGHT_ITEM,
        HIGHLIGHT_COLOR_ITEM,
        IMAGE_ITEM,
        FOOTNOTE_ITEM,
        ...STYLE_ITEMS,
        ...INSERT_ITEMS,
        ...(enclosingList(view.state) ? [CONVERT_LIST_ITEM] : []),
        ...(inEscapableBlock(view.state) ? PARAGRAPH_ITEMS : []),
        ...(footnoteDefAt(view.state) ? [DELETE_FOOTNOTE_ITEM] : []),
      ];
    }
    const tableItems = isMatrix(ctx.table)
      ? [...MOVE_ITEMS, TRANSPOSE_ITEM, ...TABLE_REST_ITEMS]
      : [...MOVE_ITEMS, ...TABLE_REST_ITEMS];
    return [...LINK_ITEMS, CODE_ITEM, HIGHLIGHT_ITEM, HIGHLIGHT_COLOR_ITEM, IMAGE_ITEM, FOOTNOTE_ITEM, ...tableItems, ...PARAGRAPH_ITEMS, ...TABLE_DELETE_ITEMS];
  };

  const nav = menuNav(menu);

  const run = (item: Item) => {
    // Not possible right now (the item is shown disabled): ignore, stay open.
    if (!item.command(view.state, view.dispatch, view)) return;
    dispose();
  };

  const refresh = () => {
    menu.textContent = "";
    let lastGroup = -1;
    for (const item of items()) {
      if (lastGroup !== -1 && item.group !== lastGroup) {
        const sep = document.createElement("div");
        sep.className = "table-menu-sep";
        sep.setAttribute("role", "separator");
        menu.appendChild(sep);
      }
      lastGroup = item.group;
      const enabled = item.command(view.state, undefined, view);
      const label = typeof item.label === "function" ? item.label(view.state) : item.label;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "table-menu-item";
      if (item.danger) btn.classList.add("table-menu-item--danger");
      if (item.active) {
        const on = item.active(view.state);
        btn.setAttribute("role", "menuitemcheckbox");
        btn.setAttribute("aria-checked", String(on));
        btn.classList.toggle("table-menu-item--active", on);
      } else {
        btn.setAttribute("role", "menuitem");
      }
      btn.title = tip(label, item.hint);
      btn.disabled = !enabled;
      // Keep the caret in the editor (also on touch, where it would dismiss
      // the on-screen keyboard).
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => run(item));
      const icon = document.createElement("span");
      icon.className = "table-menu-icon";
      icon.setAttribute("aria-hidden", "true");
      const iconMarkup = typeof item.icon === "function" ? item.icon(view.state) : item.icon;
      icon.innerHTML = svg(iconMarkup); // static markup from tableIcons.ts
      const text = document.createElement("span");
      text.className = "table-menu-label";
      text.textContent = label;
      const kbd = document.createElement("kbd");
      kbd.textContent = item.hint;
      btn.append(icon, text, kbd);
      menu.appendChild(btn);
    }

    const foot = document.createElement("div");
    foot.className = "table-menu-foot";
    foot.textContent = `↑↓ Enter · Esc / ${accel("K")} to close`;
    menu.appendChild(foot);
    popup?.reposition();
    nav.apply();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!view.dom.isConnected) {
      dispose();
      return;
    }
    // Accel+K toggles; other chords (save, …) pass through untouched.
    if (hasAccel(e) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      e.stopPropagation();
      dispose();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Bare modifier presses (the Shift of Shift+arrow) are not commands.
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;

    // Everything else is ours: it must not reach the document.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      dispose();
      return;
    }
    // Enter runs the highlighted item (↑↓ Home End move it), else closes.
    if (e.key === "Enter") {
      if (!nav.activate()) dispose();
      return;
    }
    if (navKey(nav, e) || (!e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"))) return;
    const item = items().find((i) => i.match(e) && i.command(view.state, undefined, view));
    if (item) run(item);
  };

  let popup: FloatingPopupHandle | null = null;
  function dispose() {
    popup?.dispose();
  }
  close = dispose;

  popup = openFloatingPopup({
    el: menu,
    container: view.dom.parentElement ?? document.body,
    anchor: () =>
      opts.at
        ? { left: opts.at.x, top: opts.at.y, bottom: opts.at.y }
        : view.coordsAtPos(view.state.selection.head),
    onKey,
    onClose() {
      popup = null;
      if (close === dispose) close = null;
      view.focus();
    },
  });
  refresh();
}
