/// Semantic alert blocks in the description editor (ADR-0031), inspired by tct:
/// Note, Tip, Important, Warning, Caution. Each alert is a dedicated `alert`
/// ProseMirror block node with a non-editable header (icon + label) and editable
/// block content. No markdown input rules — created and edited via the Insert
/// menu, the Accel+K editor menu (A), or clicking the alert header.

import { wrapIn } from "prosemirror-commands";
import { GapCursor } from "prosemirror-gapcursor";
import type { Node as PmNode } from "prosemirror-model";
import { TextSelection, type Command, type EditorState } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { dialogKeys } from "./dialogKeys";
import { menuNav, navKey } from "./menuNav";
import { tip } from "./platform";
import { schema, type AlertKind } from "./schema";
import { ICONS, svg } from "./tableIcons";

export interface AlertDef {
  id: AlertKind;
  label: string;
  key: string;
  /// 16×16 Primer Octicon path data (MIT, aligned with ../tct).
  octicon: string;
}

export const ALERT_KINDS: readonly AlertDef[] = [
  {
    id: "note",
    label: "Note",
    key: "N",
    octicon:
      "M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  },
  {
    id: "tip",
    label: "Tip",
    key: "T",
    octicon:
      "M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z",
  },
  {
    id: "important",
    label: "Important",
    key: "I",
    octicon:
      "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  },
  {
    id: "warning",
    label: "Warning",
    key: "W",
    octicon:
      "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
  },
  {
    id: "caution",
    label: "Caution",
    key: "C",
    octicon:
      "M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
  },
];

const alertType = schema.nodes.alert;

export function alertDef(kind: string): AlertDef {
  return ALERT_KINDS.find((a) => a.id === kind) ?? ALERT_KINDS[0];
}

function octiconSvg(path: string, size = 15): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" ` +
    `style="width:${size}px;height:${size}px;flex-shrink:0" aria-hidden="true"><path d="${path}"/></svg>`
  );
}

/// Returns the enclosing `alert` node when the entire selection is inside it.
export function alertAt(state: EditorState): { node: PmNode; pos: number; depth: number } | null {
  const { $from, $to } = state.selection;
  const maxDepth = Math.min($from.depth, $to.depth);
  for (let d = maxDepth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === alertType && $from.before(d) === $to.before(d)) {
      return { node, pos: $from.before(d), depth: d };
    }
  }
  return null;
}

/// True when an alert can be inserted here or an existing alert can be modified.
export function canInsertAlert(state: EditorState): boolean {
  if (alertAt(state)) return true;
  if (state.selection instanceof GapCursor) {
    const { $from } = state.selection;
    return $from.parent.canReplaceWith($from.index(), $from.index(), alertType);
  }
  return wrapIn(alertType, { kind: "note" })(state);
}

/// Wraps the selection in an alert of `kind`, or updates the enclosing alert's `kind`.
export function setAlertKind(kind: AlertKind): Command {
  return (state, dispatch) => {
    const existing = alertAt(state);
    if (existing) {
      if (dispatch && existing.node.attrs.kind !== kind) {
        dispatch(state.tr.setNodeMarkup(existing.pos, undefined, { kind }).scrollIntoView());
      }
      return true;
    }
    if (state.selection instanceof GapCursor) {
      const { $from } = state.selection;
      if (!$from.parent.canReplaceWith($from.index(), $from.index(), alertType)) return false;
      if (dispatch) {
        const pos = $from.pos;
        const node = alertType.create({ kind }, [state.schema.nodes.paragraph.create()]);
        const tr = state.tr.insert(pos, node);
        tr.setSelection(TextSelection.create(tr.doc, pos + 2));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    return wrapIn(alertType, { kind })(state, dispatch);
  };
}

/// Unwraps the enclosing alert block, keeping its inner content as normal blocks.
export const removeAlert: Command = (state, dispatch) => {
  const existing = alertAt(state);
  if (!existing || existing.depth < 1) return false;
  const $start = state.doc.resolve(existing.pos + 1);
  const $end = state.doc.resolve(existing.pos + existing.node.nodeSize - 1);
  const range = $start.blockRange($end);
  if (!range || range.depth !== existing.depth) return false;
  if (dispatch) {
    dispatch(state.tr.lift(range, existing.depth - 1).scrollIntoView());
  }
  return true;
};

/// ProseMirror NodeView for `alert`: renders a non-editable colored header
/// (Octicon + label; click to change kind or remove) above the editable body.
export function createAlertView(
  initialNode: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  let node = initialNode;

  const dom = document.createElement("div");
  dom.className = "editor-alert";
  dom.setAttribute("role", "note");

  const header = document.createElement("div");
  header.className = "editor-alert-header";
  header.contentEditable = "false";

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "editor-alert-badge";
  badge.title = "Change alert type";

  const iconEl = document.createElement("span");
  iconEl.className = "editor-alert-icon";
  iconEl.setAttribute("aria-hidden", "true");

  const titleEl = document.createElement("span");
  titleEl.className = "editor-alert-title";

  badge.append(iconEl, titleEl);
  header.appendChild(badge);

  const body = document.createElement("div");
  body.className = "editor-alert-body";

  dom.append(header, body);

  const sync = (n: PmNode) => {
    const def = alertDef(n.attrs.kind);
    dom.dataset.alert = def.id;
    iconEl.innerHTML = octiconSvg(def.octicon, 15);
    titleEl.textContent = def.label;
  };
  sync(node);

  badge.addEventListener("mousedown", (e) => e.preventDefault());
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (typeof pos === "number") {
      const cur = alertAt(view.state);
      if (!cur || cur.pos !== pos) {
        const $inside = view.state.doc.resolve(pos + 1);
        view.dispatch(view.state.tr.setSelection(TextSelection.near($inside)));
      }
    }
    view.focus();
    const r = badge.getBoundingClientRect();
    openAlertPicker(view, { at: { x: r.left, y: r.bottom } });
  });

  return {
    dom,
    contentDOM: body,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      sync(next);
      return true;
    },
    stopEvent(e) {
      return header.contains(e.target as Node);
    },
    ignoreMutation(m) {
      return header.contains(m.target);
    },
  };
}

let close: (() => void) | null = null;

export interface AlertPickerOptions {
  at?: { x: number; y: number };
}

/// Opens the alert kind picker anchored at the caret (or `opts.at`),
/// or closes it if already open.
export function openAlertPicker(view: EditorView, opts: AlertPickerOptions = {}): void {
  if (close) {
    close();
    return;
  }
  if (!canInsertAlert(view.state)) return;

  const menu = document.createElement("div");
  menu.className = "table-menu alert-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Alert");
  document.body.appendChild(menu);
  const nav = menuNav(menu);

  const existing = alertAt(view.state);
  const currentKind = existing ? (existing.node.attrs.kind as AlertKind) : null;

  const run = (cmd: Command) => {
    if (!cmd(view.state, view.dispatch, view)) return;
    dispose();
  };

  for (const a of ALERT_KINDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "table-menu-item alert-menu-item";
    const on = currentKind === a.id;
    btn.setAttribute("role", "menuitemcheckbox");
    btn.setAttribute("aria-checked", String(on));
    btn.classList.toggle("table-menu-item--active", on);
    btn.dataset.alertKind = a.id;
    btn.title = tip(a.label, a.key);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => run(setAlertKind(a.id)));

    const icon = document.createElement("span");
    icon.className = "table-menu-icon alert-menu-icon";
    icon.dataset.alert = a.id;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = octiconSvg(a.octicon, 15);

    const text = document.createElement("span");
    text.className = "table-menu-label";
    text.textContent = a.label;

    const kbd = document.createElement("kbd");
    kbd.textContent = a.key;

    btn.append(icon, text, kbd);
    menu.appendChild(btn);
  }

  if (existing) {
    const sep = document.createElement("div");
    sep.className = "table-menu-sep";
    sep.setAttribute("role", "separator");
    menu.appendChild(sep);

    const rmBtn = document.createElement("button");
    rmBtn.type = "button";
    rmBtn.className = "table-menu-item table-menu-item--danger";
    rmBtn.setAttribute("role", "menuitem");
    rmBtn.dataset.alertRemove = "";
    rmBtn.title = tip("Remove alert", "X");
    rmBtn.addEventListener("mousedown", (e) => e.preventDefault());
    rmBtn.addEventListener("click", () => run(removeAlert));

    const rmIcon = document.createElement("span");
    rmIcon.className = "table-menu-icon";
    rmIcon.setAttribute("aria-hidden", "true");
    rmIcon.innerHTML = svg(ICONS.deleteTable);

    const rmLabel = document.createElement("span");
    rmLabel.className = "table-menu-label";
    rmLabel.textContent = "Remove alert";

    const rmKbd = document.createElement("kbd");
    rmKbd.textContent = "X";

    rmBtn.append(rmIcon, rmLabel, rmKbd);
    menu.appendChild(rmBtn);
  }

  const foot = document.createElement("div");
  foot.className = "table-menu-foot";
  foot.textContent = existing ? "N T I W C kind · X remove · Esc" : "N T I W C kind · Esc to close";
  menu.appendChild(foot);

  const c = opts.at
    ? { left: opts.at.x, top: opts.at.y, bottom: opts.at.y }
    : view.coordsAtPos(view.state.selection.head);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(c.left, window.innerWidth - r.width - 8))}px`;
  const below = c.bottom + 6;
  menu.style.top = `${below + r.height > window.innerHeight - 8 ? Math.max(8, c.top - r.height - 6) : below}px`;
  nav.edge(false);

  const onKey = (e: KeyboardEvent) => {
    if (!view.dom.isConnected) return dispose();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return dispose();
    if (e.key === "Enter") return void (nav.activate() || dispose());
    if (navKey(nav, e)) return;
    const ch = e.key.toLowerCase();
    if (existing && ch === "x") return run(removeAlert);
    const hit = ALERT_KINDS.find((a) => a.key.toLowerCase() === ch);
    if (hit) run(setAlertKind(hit.id));
  };

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest(".alert-menu, .insert-alert-btn, .editor-alert-badge")) return;
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
}
