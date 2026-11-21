/// Numbered footnotes for card descriptions.
///
/// Footnote definitions live structurally at the bottom of the document in a
/// trailing `footnote_list` (`doc: block+ footnote_list?`). Inline references
/// (`footnote_ref`) link to definitions (`footnote_def`) by opaque `id` and are
/// auto-numbered `[1]`, `[2]`, … in order of first reference. Definitions are
/// kept sorted in that same order; unreferenced non-empty definitions stay
/// visible (dimmed as `[—]`) and are omitted from PDF exports.

import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { keymap } from "prosemirror-keymap";
import { schema } from "./schema";
import { accelLabel } from "./platform";

export interface FootnoteDefInfo {
  id: string;
  pos: number;
  node: PmNode;
  index: number;
}

export interface FootnoteInfo {
  /** 1-based number by order of first reference in the body (referenced defs only). */
  numbers: Map<string, number>;
  /** Body positions of every `footnote_ref` for each `id`, in document order. */
  refs: Map<string, number[]>;
  /** All definitions in `footnote_list`, keyed by `id`. */
  defs: Map<string, FootnoteDefInfo>;
  /** Canonical order of `footnote_def` ids: referenced (first-ref order), then orphans. */
  order: string[];
  /** Start position of `footnote_list` in `doc`, if present. */
  listPos: number | null;
}

interface ReturnTarget {
  id: string;
  pos: number;
}

interface FootnotePluginState {
  info: FootnoteInfo;
  returnTarget: ReturnTarget | null;
}

interface FootnoteMeta {
  setReturn?: ReturnTarget | null;
  normalized?: boolean;
}

export const footnotePluginKey = new PluginKey<FootnotePluginState>("footnotes");

const JUMP_HINT = `${accelLabel}Enter`;

function makeFootnoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `fn-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `fn-${Math.random().toString(36).slice(2, 10)}`;
}

/** Scans `doc` and derives numbering, reference positions, definitions, and canonical order. */
export function computeFootnotes(doc: PmNode): FootnoteInfo {
  const defs = new Map<string, FootnoteDefInfo>();
  const refs = new Map<string, number[]>();
  const numbers = new Map<string, number>();
  const order: string[] = [];

  const listType = schema.nodes.footnote_list;
  const defType = schema.nodes.footnote_def;
  const refType = schema.nodes.footnote_ref;

  let listPos: number | null = null;
  const last = doc.lastChild;
  if (last && last.type === listType) {
    listPos = doc.content.size - last.nodeSize;
    let offset = listPos + 1;
    for (let i = 0; i < last.childCount; i++) {
      const child = last.child(i);
      if (child.type === defType) {
        const id = child.attrs.id as string;
        if (!defs.has(id)) {
          defs.set(id, { id, pos: offset, node: child, index: i });
        }
      }
      offset += child.nodeSize;
    }
  }

  const bodyEnd = listPos ?? doc.content.size;
  let nextNum = 1;
  doc.nodesBetween(0, bodyEnd, (node, pos) => {
    if (node.type === refType) {
      const id = node.attrs.id as string;
      const list = refs.get(id);
      if (list) list.push(pos);
      else refs.set(id, [pos]);
      if (defs.has(id) && !numbers.has(id)) {
        numbers.set(id, nextNum++);
        order.push(id);
      }
      return false;
    }
    return true;
  });

  // Orphans stay at the end in their current relative order.
  for (const id of defs.keys()) {
    if (!numbers.has(id)) order.push(id);
  }

  return { numbers, refs, defs, order, listPos };
}

export function footnoteDefAt(state: EditorState): { id: string; pos: number; node: PmNode } | null {
  const { $from } = state.selection;
  const defType = schema.nodes.footnote_def;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === defType) {
      return { id: node.attrs.id as string, pos: $from.before(d), node };
    }
  }
  return null;
}

export function footnoteRefNearSelection(state: EditorState): { id: string; pos: number } | null {
  const refType = schema.nodes.footnote_ref;
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === refType) {
    return { id: sel.node.attrs.id as string, pos: sel.from };
  }
  if (!sel.empty) return null;
  const { $from } = sel;
  const before = $from.nodeBefore;
  if (before && before.type === refType) {
    return { id: before.attrs.id as string, pos: sel.from - before.nodeSize };
  }
  const after = $from.nodeAfter;
  if (after && after.type === refType) {
    return { id: after.attrs.id as string, pos: sel.from };
  }
  return null;
}

export function canInsertFootnote(state: EditorState): boolean {
  const { $from } = state.selection;
  const forbidden = new Set([
    schema.nodes.footnote_list,
    schema.nodes.footnote_def,
    schema.nodes.code_block,
    schema.nodes.lua_block,
  ]);
  for (let d = $from.depth; d > 0; d--) {
    if (forbidden.has($from.node(d).type)) return false;
  }
  return $from.parent.type.contentMatch.matchType(schema.nodes.footnote_ref) !== null;
}

function flashElement(view: EditorView | undefined, prefix: string, id: string) {
  if (!view) return;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  requestAnimationFrame(() => {
    const el = view.dom.querySelector(`${prefix}[data-fn-id="${escaped}"]`);
    if (!el) return;
    el.classList.remove("footnote-flash");
    void (el as HTMLElement).offsetWidth;
    el.classList.add("footnote-flash");
  });
}

/** Inserts a new numbered footnote at the selection end and jumps into its definition. */
export const insertFootnote: Command = (state, dispatch, view) => {
  if (!canInsertFootnote(state)) return false;
  if (!dispatch) return true;

  const id = makeFootnoteId();
  const refNode = schema.nodes.footnote_ref.create({ id });
  const defNode = schema.nodes.footnote_def.create(
    { id },
    schema.nodes.footnote_paragraph.create(),
  );

  const insertPos = state.selection.to;
  let tr = state.tr.insert(insertPos, refNode);
  const refPos = insertPos;

  const doc = tr.doc;
  const last = doc.lastChild;
  let newDefPos: number;
  if (last && last.type === schema.nodes.footnote_list) {
    newDefPos = doc.content.size - 1;
    tr = tr.insert(newDefPos, defNode);
  } else {
    const listNode = schema.nodes.footnote_list.create(null, defNode);
    const listPos = doc.content.size;
    tr = tr.insert(listPos, listNode);
    newDefPos = listPos + 1;
  }

  // Place caret inside the new footnote_paragraph (`defPos + 2`).
  tr = tr
    .setSelection(TextSelection.create(tr.doc, newDefPos + 2))
    .setMeta(footnotePluginKey, { setReturn: { id, pos: refPos } } satisfies FootnoteMeta)
    .scrollIntoView();

  dispatch(tr);
  flashElement(view, ".footnote-def", id);
  return true;
};

/** Jumps from a footnote reference to its definition, or back from a definition to its reference. */
export const jumpFootnote: Command = (state, dispatch, view) => {
  const pluginState = footnotePluginKey.getState(state);
  if (!pluginState) return false;
  const { info, returnTarget } = pluginState;

  const inDef = footnoteDefAt(state);
  if (inDef) {
    let targetPos: number | null = null;
    if (returnTarget && returnTarget.id === inDef.id) {
      const node = state.doc.nodeAt(returnTarget.pos);
      if (node && node.type === schema.nodes.footnote_ref && node.attrs.id === inDef.id) {
        targetPos = returnTarget.pos;
      }
    }
    if (targetPos === null) {
      const refs = info.refs.get(inDef.id);
      if (refs && refs.length > 0) targetPos = refs[0];
    }
    if (targetPos === null) return false;
    if (!dispatch) return true;

    const afterRef = Math.min(targetPos + 1, state.doc.content.size);
    const tr = state.tr
      .setSelection(TextSelection.near(state.doc.resolve(afterRef)))
      .setMeta(footnotePluginKey, { setReturn: null } satisfies FootnoteMeta)
      .scrollIntoView();
    dispatch(tr);
    flashElement(view, "sup.footnote-ref", inDef.id);
    return true;
  }

  const nearRef = footnoteRefNearSelection(state);
  if (nearRef) {
    const def = info.defs.get(nearRef.id);
    if (!def) return false;
    if (!dispatch) return true;

    // Caret at end of the definition's last paragraph.
    const caretPos = def.pos + def.node.nodeSize - 2;
    const tr = state.tr
      .setSelection(TextSelection.near(state.doc.resolve(caretPos), -1))
      .setMeta(footnotePluginKey, { setReturn: { id: nearRef.id, pos: nearRef.pos } } satisfies FootnoteMeta)
      .scrollIntoView();
    dispatch(tr);
    flashElement(view, ".footnote-def", nearRef.id);
    return true;
  }

  return false;
};

/** Context-sensitive footnote action for the editor menu (jump if at ref/def, else insert). */
export function footnoteMenuLabel(state: EditorState): string {
  if (footnoteDefAt(state)) return "Jump back to reference";
  if (footnoteRefNearSelection(state)) return "Jump to footnote";
  return "Insert footnote";
}

export const footnoteMenuCommand: Command = (state, dispatch, view) => {
  if (footnoteDefAt(state) || footnoteRefNearSelection(state)) {
    return jumpFootnote(state, dispatch, view);
  }
  return insertFootnote(state, dispatch, view);
};

export const deleteCurrentFootnote: Command = (state, dispatch, view) => {
  const def = footnoteDefAt(state);
  if (!def) return false;
  if (dispatch && view) deleteFootnoteById(view, def.id);
  return true;
};

/** Deletes a footnote definition and all references pointing to it in one undo step. */
export function deleteFootnoteById(view: EditorView, id: string) {
  const { state } = view;
  const info = computeFootnotes(state.doc);
  const def = info.defs.get(id);
  const refs = info.refs.get(id) ?? [];
  if (!def && refs.length === 0) return;

  let tr = state.tr;
  // Delete definition first (at end of doc) so body ref positions stay valid.
  if (def && info.listPos !== null) {
    if (info.defs.size <= 1) {
      const list = state.doc.nodeAt(info.listPos);
      if (list) tr = tr.delete(info.listPos, info.listPos + list.nodeSize);
    } else {
      tr = tr.delete(def.pos, def.pos + def.node.nodeSize);
    }
  }
  // Delete references from back to front.
  for (let i = refs.length - 1; i >= 0; i--) {
    const pos = refs[i];
    tr = tr.delete(pos, pos + 1);
  }
  if (refs.length > 0) {
    const landing = Math.min(refs[0], tr.doc.content.size);
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(landing)));
  }
  tr = tr.setMeta(footnotePluginKey, { setReturn: null } satisfies FootnoteMeta).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

function jumpToDefFromView(view: EditorView, id: string, refPos: number) {
  const info = computeFootnotes(view.state.doc);
  const def = info.defs.get(id);
  if (!def) return;
  const caretPos = def.pos + def.node.nodeSize - 2;
  const tr = view.state.tr
    .setSelection(TextSelection.near(view.state.doc.resolve(caretPos), -1))
    .setMeta(footnotePluginKey, { setReturn: { id, pos: refPos } } satisfies FootnoteMeta)
    .scrollIntoView();
  view.dispatch(tr);
  view.focus();
  flashElement(view, ".footnote-def", id);
}

function jumpBackFromView(view: EditorView, id: string) {
  const pluginState = footnotePluginKey.getState(view.state);
  if (!pluginState) return;
  const { info, returnTarget } = pluginState;
  let targetPos: number | null = null;
  if (returnTarget && returnTarget.id === id) {
    const node = view.state.doc.nodeAt(returnTarget.pos);
    if (node && node.type === schema.nodes.footnote_ref && node.attrs.id === id) {
      targetPos = returnTarget.pos;
    }
  }
  if (targetPos === null) {
    const refs = info.refs.get(id);
    if (refs && refs.length > 0) targetPos = refs[0];
  }
  if (targetPos === null) return;
  const afterRef = Math.min(targetPos + 1, view.state.doc.content.size);
  const tr = view.state.tr
    .setSelection(TextSelection.near(view.state.doc.resolve(afterRef)))
    .setMeta(footnotePluginKey, { setReturn: null } satisfies FootnoteMeta)
    .scrollIntoView();
  view.dispatch(tr);
  view.focus();
  flashElement(view, "sup.footnote-ref", id);
}

function refTooltip(id: string, info: FootnoteInfo): string {
  const def = info.defs.get(id);
  const firstLine = def?.node.firstChild?.textContent.trim() ?? "";
  const preview = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine || "(empty footnote)";
  return `${preview} — Click or ${JUMP_HINT} to jump`;
}

function syncRefDom(dom: HTMLElement, id: string, info: FootnoteInfo) {
  const num = info.numbers.get(id);
  dom.textContent = num !== undefined ? `[${num}]` : "[?]";
  dom.title = refTooltip(id, info);
}

function syncDefDom(dom: HTMLElement, id: string, info: FootnoteInfo) {
  const num = info.numbers.get(id);
  const orphan = num === undefined;
  dom.classList.toggle("footnote-def--orphan", orphan);
  const marker = dom.querySelector<HTMLElement>(".footnote-def-marker");
  if (marker) {
    marker.textContent = orphan ? "[—]" : `[${num}]`;
    marker.title = orphan ? "Unreferenced footnote (omitted from PDF)" : `Jump back (${JUMP_HINT})`;
  }
  const back = dom.querySelector<HTMLElement>(".footnote-def-back");
  if (back) back.hidden = orphan;
}

export function createFootnoteRefView(
  node: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  const id = node.attrs.id as string;
  const dom = document.createElement("sup");
  dom.className = "footnote-ref";
  dom.setAttribute("data-fn-id", id);

  const initInfo = footnotePluginKey.getState(view.state)?.info ?? computeFootnotes(view.state.doc);
  syncRefDom(dom, id, initInfo);

  dom.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = getPos();
    if (pos !== undefined) jumpToDefFromView(view, id, pos);
  });

  return {
    dom,
    stopEvent: (e) => e.type === "mousedown" || e.type === "click",
    ignoreMutation: () => true,
  };
}

export function createFootnoteDefView(node: PmNode, view: EditorView): NodeView {
  const id = node.attrs.id as string;
  const dom = document.createElement("div");
  dom.className = "footnote-def";
  dom.setAttribute("data-fn-id", id);

  const marker = document.createElement("span");
  marker.className = "footnote-def-marker";
  marker.contentEditable = "false";
  marker.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    jumpBackFromView(view, id);
  });

  const contentDOM = document.createElement("div");
  contentDOM.className = "footnote-def-content";

  const actions = document.createElement("span");
  actions.className = "footnote-def-actions";
  actions.contentEditable = "false";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "footnote-def-back";
  backBtn.textContent = "↩";
  backBtn.title = `Jump back (${JUMP_HINT})`;
  backBtn.addEventListener("mousedown", (e) => {
    if (e.button === 0) e.preventDefault();
  });
  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    jumpBackFromView(view, id);
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "footnote-def-delete";
  delBtn.textContent = "×";
  delBtn.title = "Delete footnote";
  delBtn.addEventListener("mousedown", (e) => {
    if (e.button === 0) e.preventDefault();
  });
  delBtn.addEventListener("click", (e) => {
    e.preventDefault();
    deleteFootnoteById(view, id);
  });

  actions.append(backBtn, delBtn);
  dom.append(marker, contentDOM, actions);

  const initInfo = footnotePluginKey.getState(view.state)?.info ?? computeFootnotes(view.state.doc);
  syncDefDom(dom, id, initInfo);

  return {
    dom,
    contentDOM,
    stopEvent(e) {
      const target = e.target as Node | null;
      return !!(target && !contentDOM.contains(target));
    },
    ignoreMutation(m) {
      if (m.type === "selection") return false;
      return !contentDOM.contains(m.target);
    },
  };
}

/** Normalizes `footnote_list`: cleans empty unreferenced defs and keeps defs ordered by first reference. */
function normalizeFootnotes(
  transactions: readonly Transaction[],
  newState: EditorState,
): Transaction | null {
  if (!transactions.some((tr) => tr.docChanged)) return null;
  if (transactions.some((tr) => (tr.getMeta(footnotePluginKey) as FootnoteMeta | undefined)?.normalized)) {
    return null;
  }

  const info = computeFootnotes(newState.doc);
  if (info.listPos === null) return null;
  const listNode = newState.doc.nodeAt(info.listPos);
  if (!listNode) return null;

  const focusedDef = footnoteDefAt(newState);
  const currentIds: string[] = [];
  listNode.forEach((child) => currentIds.push(child.attrs.id as string));

  // Keep every referenced def, every non-empty orphan, and any def the user is currently typing in.
  const keepIds = info.order.filter((id) => {
    if (info.numbers.has(id)) return true;
    if (focusedDef?.id === id) return true;
    const def = info.defs.get(id);
    return def ? def.node.textContent.trim().length > 0 : false;
  });

  const unchanged =
    keepIds.length === currentIds.length && keepIds.every((id, i) => id === currentIds[i]);
  if (unchanged) return null;

  let tr = newState.tr.setMeta(footnotePluginKey, { normalized: true } satisfies FootnoteMeta);
  tr = tr.setMeta("addToHistory", false);

  if (keepIds.length === 0) {
    tr = tr.delete(info.listPos, info.listPos + listNode.nodeSize);
    return tr;
  }

  // Remember caret offset inside the focused footnote_def so reordering doesn't lose cursor position.
  const relOffset =
    focusedDef && keepIds.includes(focusedDef.id)
      ? { id: focusedDef.id, from: newState.selection.from - focusedDef.pos, to: newState.selection.to - focusedDef.pos }
      : null;

  const newDefs = keepIds
    .map((id) => info.defs.get(id)?.node)
    .filter((n): n is PmNode => n !== undefined);
  const newList = schema.nodes.footnote_list.create(null, newDefs);
  tr = tr.replaceWith(info.listPos, info.listPos + listNode.nodeSize, newList);

  if (relOffset) {
    let offset = info.listPos + 1;
    for (const d of newDefs) {
      if (d.attrs.id === relOffset.id) {
        const from = Math.min(offset + relOffset.from, offset + d.nodeSize - 1);
        const to = Math.min(offset + relOffset.to, offset + d.nodeSize - 1);
        tr = tr.setSelection(TextSelection.create(tr.doc, from, to));
        break;
      }
      offset += d.nodeSize;
    }
  }

  return tr;
}

const backspaceEmptyFootnote: Command = (state, dispatch, view) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const def = footnoteDefAt(state);
  if (!def) return false;
  if (def.node.textContent.length > 0 || sel.from !== def.pos + 2) return false;
  if (dispatch && view) deleteFootnoteById(view, def.id);
  return true;
};

const enterOnFootnoteRef: Command = (state, dispatch, view) => {
  if (
    state.selection instanceof NodeSelection &&
    state.selection.node.type === schema.nodes.footnote_ref
  ) {
    return jumpFootnote(state, dispatch, view);
  }
  return false;
};

export function footnotePlugins(): Plugin[] {
  const mainPlugin = new Plugin<FootnotePluginState>({
    key: footnotePluginKey,
    state: {
      init(_config, instance) {
        return { info: computeFootnotes(instance.doc), returnTarget: null };
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(footnotePluginKey) as FootnoteMeta | undefined;
        const info = tr.docChanged ? computeFootnotes(newState.doc) : prev.info;
        let returnTarget = prev.returnTarget;
        if (meta && "setReturn" in meta) {
          returnTarget = meta.setReturn ?? null;
        } else if (returnTarget && tr.docChanged) {
          const mapped = tr.mapping.mapResult(returnTarget.pos);
          returnTarget = mapped.deleted ? null : { id: returnTarget.id, pos: mapped.pos };
        }
        return { info, returnTarget };
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      return normalizeFootnotes(transactions, newState);
    },
    view() {
      return {
        update(view, prevState) {
          const cur = footnotePluginKey.getState(view.state)?.info;
          const prev = footnotePluginKey.getState(prevState)?.info;
          if (!cur || cur === prev) return;
          view.dom.querySelectorAll<HTMLElement>("sup.footnote-ref[data-fn-id]").forEach((el) => {
            const id = el.getAttribute("data-fn-id");
            if (id) syncRefDom(el, id, cur);
          });
          view.dom.querySelectorAll<HTMLElement>("div.footnote-def[data-fn-id]").forEach((el) => {
            const id = el.getAttribute("data-fn-id");
            if (id) syncDefDom(el, id, cur);
          });
        },
      };
    },
  });

  const keys = keymap({
    "Mod-Enter": jumpFootnote,
    Enter: enterOnFootnoteRef,
    Backspace: backspaceEmptyFootnote,
  });

  return [keys, mainPlugin];
}
