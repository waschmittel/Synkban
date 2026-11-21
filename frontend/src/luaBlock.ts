/// Native ProseMirror `lua_block` NodeView, fence input rules, and run/clear
/// commands (ADR-0028). Evaluation runs in `luaRunner.ts`; results persist in
/// node attributes `{ output, error, ran_hash }`.

import { inputRules, textblockTypeInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";
import { hashLuaCode, runLua } from "./luaRunner";
import { luaCompletionPlugin, luaHighlightPlugin } from "./luaSyntax";
import { accel, tip } from "./platform";
import { schema } from "./schema";

interface BlockController {
  getPos: () => number | undefined;
  setRunning: (running: boolean) => void;
}

const controllers = new WeakMap<Element, BlockController>();

function attrsEqual(a: PmNode["attrs"], b: Record<string, unknown>): boolean {
  return a.output === b.output && a.error === b.error && a.ran_hash === b.ran_hash;
}

/// Runs the `lua_block` at `pos` asynchronously and writes `{ output, error,
/// ran_hash }` back to the document if anything changed.
export function runLuaBlockAt(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== schema.nodes.lua_block) return false;
  const dom = view.nodeDOM(pos);
  const ctrl = dom instanceof Element ? controllers.get(dom) : undefined;
  const code = node.textContent;
  const hash = hashLuaCode(code);

  ctrl?.setRunning(true);
  void runLua(code).then((res) => {
    ctrl?.setRunning(false);
    if (!view.dom.isConnected) return;
    const curPos = ctrl?.getPos() ?? pos;
    const current = view.state.doc.nodeAt(curPos);
    if (!current || current.type !== schema.nodes.lua_block) return;
    const nextAttrs = { output: res.output, error: res.error, ran_hash: hash };
    if (attrsEqual(current.attrs, nextAttrs)) return;
    view.dispatch(view.state.tr.setNodeMarkup(curPos, undefined, nextAttrs));
  });
  return true;
}

function clearLuaBlockAt(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== schema.nodes.lua_block) return false;
  const nextAttrs = { output: null, error: null, ran_hash: null };
  if (attrsEqual(node.attrs, nextAttrs)) return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, nextAttrs));
  return true;
}

/// ProseMirror command for `Mod-Enter` inside a `lua_block`.
export const runFocusedLuaBlock: Command = (state, dispatch, view) => {
  const { $from } = state.selection;
  if ($from.parent.type !== schema.nodes.lua_block) return false;
  if (dispatch && view) runLuaBlockAt(view, $from.before());
  return true;
};

/// Creates the native ProseMirror NodeView for a `lua_block` node.
/// Uses `contentDOM` directly on the `<pre>` element so cursor motion,
/// padding clicks, drag selection, undo/redo, copy/paste, IME, and inline
/// token decorations stay native to ProseMirror.
export function createLuaBlockView(
  initialNode: PmNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  let node = initialNode;
  let running = false;

  const dom = document.createElement("div");
  dom.className = "lua-block";

  const header = document.createElement("div");
  header.className = "lua-block-header";
  header.contentEditable = "false";

  const badge = document.createElement("span");
  badge.className = "lua-block-badge";
  badge.textContent = "Lua";

  const status = document.createElement("span");
  status.className = "lua-block-status";

  const actions = document.createElement("span");
  actions.className = "lua-block-actions";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "lua-block-clear";
  clearBtn.textContent = "Clear";
  clearBtn.title = "Clear output";

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "lua-block-run";
  runBtn.textContent = "Run";
  runBtn.title = tip("Run Lua", accel("Enter"));

  actions.append(clearBtn, runBtn);
  header.append(badge, status, actions);

  const pre = document.createElement("pre");
  pre.className = "lua-block-pre lua-block-code";

  const result = document.createElement("div");
  result.className = "lua-block-result";
  result.contentEditable = "false";

  const outPre = document.createElement("pre");
  outPre.className = "lua-block-output";
  const errPre = document.createElement("pre");
  errPre.className = "lua-block-error";
  result.append(outPre, errPre);

  dom.append(header, pre, result);

  const renderState = () => {
    const output = node.attrs.output as string | null;
    const error = node.attrs.error as string | null;
    const ranHash = node.attrs.ran_hash as string | null;
    const hasResult = output !== null || error !== null;
    const stale = hasResult && ranHash !== hashLuaCode(node.textContent);

    status.className = "lua-block-status";
    if (running) {
      status.textContent = "Running…";
      status.classList.add("lua-block-status--running");
    } else if (stale) {
      status.textContent = "Outdated";
      status.classList.add("lua-block-status--stale");
    } else if (error !== null) {
      status.textContent = "Error";
      status.classList.add("lua-block-status--error");
    } else if (output !== null) {
      status.textContent = "Ran";
      status.classList.add("lua-block-status--ran");
    } else {
      status.textContent = "";
    }

    runBtn.disabled = running;
    clearBtn.hidden = !hasResult && !running;
    clearBtn.disabled = running;

    result.hidden = !hasResult;
    result.classList.toggle("lua-block-result--stale", stale);

    if (output !== null) {
      outPre.hidden = false;
      outPre.textContent = output === "" && error === null ? "(no output)" : output;
    } else {
      outPre.hidden = true;
      outPre.textContent = "";
    }

    if (error !== null) {
      errPre.hidden = false;
      errPre.textContent = error;
    } else {
      errPre.hidden = true;
      errPre.textContent = "";
    }
  };

  header.addEventListener("mousedown", (e) => {
    if ((e.target as Element | null)?.closest("button")) return;
    e.preventDefault();
    view.focus();
    const pos = getPos();
    if (pos === undefined) return;
    const { $from } = view.state.selection;
    if ($from.parent.type !== schema.nodes.lua_block || $from.before() !== pos) {
      const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1));
      view.dispatch(tr.scrollIntoView());
    }
  });
  for (const btn of [runBtn, clearBtn]) {
    btn.addEventListener("mousedown", (e) => e.preventDefault());
  }
  runBtn.addEventListener("click", () => {
    const pos = getPos();
    if (pos !== undefined) runLuaBlockAt(view, pos);
  });
  clearBtn.addEventListener("click", () => {
    const pos = getPos();
    if (pos !== undefined) clearLuaBlockAt(view, pos);
  });

  controllers.set(dom, {
    getPos,
    setRunning(r) {
      if (running === r) return;
      running = r;
      renderState();
    },
  });

  renderState();

  return {
    dom,
    contentDOM: pre,
    update(updated) {
      if (updated.type !== schema.nodes.lua_block) return false;
      node = updated;
      renderState();
      return true;
    },
    stopEvent(event) {
      const target = event.target as Node | null;
      return !!target && (header.contains(target) || result.contains(target));
    },
    ignoreMutation(mutation) {
      return header.contains(mutation.target) || result.contains(mutation.target);
    },
    destroy() {
      controllers.delete(dom);
    },
  };
}

/// Converts a `code_block` whose only text is `"lua"` into an empty `lua_block`
/// when Space or Enter is pressed (fallback for manually typed `"lua"` inside a
/// code block).
function upgradeCodeFenceToLua(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || !sel.empty) return false;
  const { $from } = sel;
  if (
    $from.parent.type !== schema.nodes.code_block ||
    $from.parent.textContent !== "lua" ||
    $from.parentOffset !== 3
  ) {
    return false;
  }
  if (dispatch) {
    const from = $from.before();
    const to = $from.after();
    const tr = state.tr.replaceWith(from, to, schema.nodes.lua_block.create());
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

interface FenceState {
  freshCodePos: number | null;
  upgradedLuaPos: number | null;
}

const fenceKey = new PluginKey<FenceState>("lua-fence");

/// Automatically upgrades ```lua immediately once `a` is typed in a freshly
/// fence-created code block, and swallows an optional delimiter Space/Enter.
function luaFencePlugin(): Plugin<FenceState> {
  return new Plugin<FenceState>({
    key: fenceKey,
    state: {
      init: () => ({ freshCodePos: null, upgradedLuaPos: null }),
      apply(tr, prev, oldState, newState) {
        if (tr.getMeta("history$")) return { freshCodePos: null, upgradedLuaPos: null };

        const meta = tr.getMeta(fenceKey) as { upgraded?: number | null } | undefined;
        let freshCodePos: number | null = null;
        if (
          tr.docChanged &&
          oldState.selection.$from.parent.type === schema.nodes.paragraph &&
          oldState.selection.$from.parent.textContent === "``" &&
          newState.selection.$from.parent.type === schema.nodes.code_block &&
          newState.selection.$from.parent.content.size === 0
        ) {
          freshCodePos = newState.selection.$from.before();
        } else if (prev.freshCodePos !== null) {
          const mapped = tr.mapping.map(prev.freshCodePos, -1);
          const n = newState.doc.nodeAt(mapped);
          const sel = newState.selection;
          if (
            n?.type === schema.nodes.code_block &&
            "lua".startsWith(n.textContent) &&
            sel instanceof TextSelection &&
            sel.empty &&
            sel.$from.before() === mapped &&
            sel.$from.parentOffset === n.content.size
          ) {
            freshCodePos = mapped;
          }
        }

        let upgradedLuaPos: number | null = prev.upgradedLuaPos;
        if (meta && "upgraded" in meta) {
          upgradedLuaPos = meta.upgraded ?? null;
        } else if (tr.docChanged || !tr.selection.eq(oldState.selection)) {
          upgradedLuaPos = null;
        }
        return { freshCodePos, upgradedLuaPos };
      },
    },
    appendTransaction(trs, _oldState, newState) {
      if (trs.some((t) => t.getMeta("history$"))) return null;
      const fs = fenceKey.getState(newState);
      if (!fs || fs.freshCodePos === null) return null;
      const pos = fs.freshCodePos;
      const node = newState.doc.nodeAt(pos);
      if (!node || node.type !== schema.nodes.code_block || node.textContent !== "lua") return null;
      const tr = newState.tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.lua_block.create());
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      tr.setMeta(fenceKey, { upgraded: pos });
      return tr;
    },
    props: {
      handleKeyDown(view, e) {
        const fs = fenceKey.getState(view.state);
        if (!fs || fs.upgradedLuaPos === null) return false;
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key !== " " && e.key !== "Enter") return false;
        const sel = view.state.selection;
        if (
          !(sel instanceof TextSelection) ||
          !sel.empty ||
          sel.$from.parent.type !== schema.nodes.lua_block ||
          sel.$from.parent.content.size !== 0 ||
          sel.$from.before() !== fs.upgradedLuaPos
        ) {
          return false;
        }
        e.preventDefault();
        view.dispatch(view.state.tr.setMeta(fenceKey, { upgraded: null }));
        return true;
      },
    },
  });
}

/// Returns all ProseMirror plugins required for `lua_block`:
/// 1. Highlighting decorations (`luaHighlightPlugin`)
/// 2. Caret-anchored autocompletion (`luaCompletionPlugin`)
/// 3. Fence auto-upgrade (`luaFencePlugin`)
/// 4. Keymap (`Mod-Enter` run + ```lua Space/Enter fallback conversion)
/// 5. Input rule (`^```lua ` on paragraphs)
export function luaPlugins(): Plugin[] {
  return [
    luaHighlightPlugin(),
    luaCompletionPlugin(),
    luaFencePlugin(),
    keymap({
      "Mod-Enter": runFocusedLuaBlock,
      Space: upgradeCodeFenceToLua,
      Enter: upgradeCodeFenceToLua,
    }),
    inputRules({
      rules: [textblockTypeInputRule(/^```lua\s$/, schema.nodes.lua_block)],
    }),
  ];
}
