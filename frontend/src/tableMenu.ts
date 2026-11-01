/// The table menu (Accel+K, or the editor toolbar's "Table" button).
///
/// One mechanism for keyboard and touch: the menu is a small popup beside the
/// caret whose items are clickable *and* carry single-key shortcuts that are
/// shown on screen — so no modifier chord has to be found for every table
/// operation, and the only global chord is the one that opens the menu.
///
/// Keyboard focus never leaves the editor (items swallow `mousedown`), which
/// keeps the selection and the touch keyboard intact. While the menu is open it
/// owns the keyboard via `dialogKeys`, so typed letters can't leak into the
/// document. Every action closes the menu once it has run; an action that is
/// not possible right now (shown disabled) is ignored and the menu stays open.
/// Related actions are grouped, separated by a divider. Keys:
///
///   outside a table   t / Enter … insert a table
///   inside a table    ↑ ↓ ← →  … move the row / column
///                     Shift+arrow … insert a row / column in that direction
///                     1 / 2 / 3 … align column left / center / right
///                     r / c / t … delete row / column / table
///   always            Esc / Accel+K … close

import type { EditorView } from "prosemirror-view";
import type { Command } from "prosemirror-state";
import { dialogKeys } from "./dialogKeys";
import { accel, hasAccel, isMac, tip } from "./platform";
import { ICONS, TABLE_ICON, svg } from "./tableIcons";

import {
  cellContext,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
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
} from "./tables";

const SHIFT = isMac ? "⇧" : "Shift+";

interface Item {
  label: string;
  /// Inner markup of a 24×24 stroke icon (see tableIcons.ts).
  icon: string;
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
const letter = (ch: string) => (e: KeyboardEvent) => !e.shiftKey && e.key.toLowerCase() === ch;

const digit = (d: string) => (e: KeyboardEvent) => !e.shiftKey && e.key === d;

const TABLE_ITEMS: Item[] = [
  // Move
  { label: "Move row up", icon: ICONS.moveUp, group: 0, hint: "↑", match: arrow("ArrowUp", false), command: moveRowUp },
  { label: "Move row down", icon: ICONS.moveDown, group: 0, hint: "↓", match: arrow("ArrowDown", false), command: moveRowDown },
  { label: "Move column left", icon: ICONS.moveLeft, group: 0, hint: "←", match: arrow("ArrowLeft", false), command: moveColumnLeft },
  { label: "Move column right", icon: ICONS.moveRight, group: 0, hint: "→", match: arrow("ArrowRight", false), command: moveColumnRight },
  // Insert
  { label: "Insert row above", icon: ICONS.rowAbove, group: 1, hint: `${SHIFT}↑`, match: arrow("ArrowUp", true), command: insertRowAbove },
  { label: "Insert row below", icon: ICONS.rowBelow, group: 1, hint: `${SHIFT}↓`, match: arrow("ArrowDown", true), command: insertRowBelow },
  { label: "Insert column left", icon: ICONS.colLeft, group: 1, hint: `${SHIFT}←`, match: arrow("ArrowLeft", true), command: insertColumnLeft },
  { label: "Insert column right", icon: ICONS.colRight, group: 1, hint: `${SHIFT}→`, match: arrow("ArrowRight", true), command: insertColumnRight },
  // Align
  { label: "Align column left", icon: ICONS.alignLeft, group: 2, hint: "1", match: digit("1"), command: alignLeft },
  { label: "Align column center", icon: ICONS.alignCenter, group: 2, hint: "2", match: digit("2"), command: alignCenter },
  { label: "Align column right", icon: ICONS.alignRight, group: 2, hint: "3", match: digit("3"), command: alignRight },
  // Delete
  { label: "Delete row", icon: ICONS.deleteRow, group: 3, hint: "R", match: letter("r"), command: removeRow },
  { label: "Delete column", icon: ICONS.deleteColumn, group: 3, hint: "C", match: letter("c"), command: removeColumn },
  { label: "Delete table", icon: ICONS.deleteTable, group: 3, hint: "T", match: letter("t"), command: removeTable },
];

const INSERT_ITEMS: Item[] = [
  { label: "Insert table (3×3)", icon: TABLE_ICON, group: 0, hint: "T", match: letter("t"), command: insertTable },
];

let close: (() => void) | null = null;

/// Opens the menu for `view`, or closes it if it is already open.
export function openTableMenu(view: EditorView): void {
  if (close) {
    close();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "table-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Table");
  document.body.appendChild(menu);

  const items = (): Item[] => (cellContext(view.state) ? TABLE_ITEMS : INSERT_ITEMS);

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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "table-menu-item";
      if (item.group === 3 && cellContext(view.state)) btn.classList.add("table-menu-item--danger");
      btn.setAttribute("role", "menuitem");
      btn.title = tip(item.label, item.hint);
      btn.disabled = !enabled;
      // Keep the caret in the editor (also on touch, where it would dismiss
      // the on-screen keyboard).
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => run(item));
      const icon = document.createElement("span");
      icon.className = "table-menu-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = svg(item.icon); // static markup from tableIcons.ts
      const text = document.createElement("span");
      text.className = "table-menu-label";
      text.textContent = item.label;
      const kbd = document.createElement("kbd");
      kbd.textContent = item.hint;
      btn.append(icon, text, kbd);
      menu.appendChild(btn);
    }

    const foot = document.createElement("div");
    foot.className = "table-menu-foot";
    foot.textContent = `Esc / ${accel("K")} to close`;
    menu.appendChild(foot);
    position();
  };

  // Below the caret, kept inside the viewport.
  const position = () => {
    const { head } = view.state.selection;
    const c = view.coordsAtPos(head);
    const r = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(c.left, window.innerWidth - r.width - 8));
    const below = c.bottom + 6;
    const top = below + r.height > window.innerHeight - 8 ? Math.max(8, c.top - r.height - 6) : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
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
    if (e.key === "Escape" || e.key === "Enter") {
      // Enter in the insert menu inserts; elsewhere it just closes.
      if (e.key === "Enter" && !cellContext(view.state)) run(INSERT_ITEMS[0]);
      else dispose();
      return;
    }
    const item = items().find((i) => i.match(e));
    if (item) run(item);
  };

  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    // The toolbar button toggles the menu itself.
    if (target?.closest(".table-menu, .table-menu-trigger")) return;
    dispose();
  };

  const releaseKeys = dialogKeys(onKey);
  document.addEventListener("pointerdown", onPointerDown, true);

  function dispose() {
    releaseKeys();
    document.removeEventListener("pointerdown", onPointerDown, true);
    menu.remove();
    close = null;
    view.focus();
  }
  close = dispose;
  refresh();
}
