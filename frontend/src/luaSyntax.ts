/// Native ProseMirror syntax highlighting and caret-anchored autocompletion
/// for `lua_block` nodes (ADR-0028). Zero external dependencies.

import { Plugin, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { hidePopoverSafe, positionFloating, showPopoverSafe } from "./floatingPopup";
import { onOverlayOpen } from "./overlayLayers";
import { schema } from "./schema";

export type LuaTokenType =
  | "keyword"
  | "builtin"
  | "string"
  | "number"
  | "comment"
  | "ident"
  | "op";

export interface LuaToken {
  type: LuaTokenType;
  from: number;
  to: number;
  text: string;
  closed?: boolean;
}

export interface LuaCompletionItem {
  label: string;
  insert: string;
  kind: "keyword" | "builtin" | "local";
  detail?: string;
}

export interface LuaCompletionResult {
  from: number;
  to: number;
  items: LuaCompletionItem[];
}

export const LUA_KEYWORDS: readonly string[] = [
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "goto",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
];

const KEYWORD_SET = new Set<string>(LUA_KEYWORDS);

export const LUA_BUILTINS: readonly { label: string; detail: string }[] = [
  { label: "print", detail: "print(...)" },
  { label: "tostring", detail: "tostring(v)" },
  { label: "tonumber", detail: "tonumber(e [, base])" },
  { label: "type", detail: "type(v)" },
  { label: "pairs", detail: "pairs(t)" },
  { label: "ipairs", detail: "ipairs(t)" },
  { label: "next", detail: "next(table [, index])" },
  { label: "select", detail: "select(index, ...)" },
  { label: "pcall", detail: "pcall(f [, arg1, ...])" },
  { label: "xpcall", detail: "xpcall(f, msgh [, arg1, ...])" },
  { label: "error", detail: "error(message [, level])" },
  { label: "assert", detail: "assert(v [, message])" },
  { label: "load", detail: "load(chunk [, chunkname])" },
  { label: "getmetatable", detail: "getmetatable(object)" },
  { label: "setmetatable", detail: "setmetatable(table, metatable)" },
  { label: "rawequal", detail: "rawequal(v1, v2)" },
  { label: "rawget", detail: "rawget(table, index)" },
  { label: "rawlen", detail: "rawlen(v)" },
  { label: "rawset", detail: "rawset(table, index, value)" },
  { label: "math", detail: "stdlib module" },
  { label: "string", detail: "stdlib module" },
  { label: "table", detail: "stdlib module" },
  { label: "utf8", detail: "stdlib module" },
  { label: "os", detail: "time & date helpers" },
  { label: "_VERSION", detail: "\"Lua 5.4\"" },
];

const BUILTIN_SET = new Set<string>(LUA_BUILTINS.map((b) => b.label));

export const LUA_STDLIB_MEMBERS: Record<string, readonly { label: string; detail: string }[]> = {
  math: [
    { label: "abs", detail: "math.abs(x)" },
    { label: "acos", detail: "math.acos(x)" },
    { label: "asin", detail: "math.asin(x)" },
    { label: "atan", detail: "math.atan(y [, x])" },
    { label: "ceil", detail: "math.ceil(x)" },
    { label: "cos", detail: "math.cos(x)" },
    { label: "deg", detail: "math.deg(x)" },
    { label: "exp", detail: "math.exp(x)" },
    { label: "floor", detail: "math.floor(x)" },
    { label: "fmod", detail: "math.fmod(x, y)" },
    { label: "huge", detail: "number (+∞)" },
    { label: "log", detail: "math.log(x [, base])" },
    { label: "max", detail: "math.max(x, ...)" },
    { label: "min", detail: "math.min(x, ...)" },
    { label: "modf", detail: "math.modf(x)" },
    { label: "pi", detail: "3.1415926535898" },
    { label: "rad", detail: "math.rad(x)" },
    { label: "random", detail: "math.random([m [, n]])" },
    { label: "randomseed", detail: "math.randomseed([x [, y]])" },
    { label: "sin", detail: "math.sin(x)" },
    { label: "sqrt", detail: "math.sqrt(x)" },
    { label: "tan", detail: "math.tan(x)" },
    { label: "tointeger", detail: "math.tointeger(x)" },
    { label: "type", detail: "math.type(x)" },
  ],
  string: [
    { label: "byte", detail: "string.byte(s [, i [, j]])" },
    { label: "char", detail: "string.char(...)" },
    { label: "find", detail: "string.find(s, pat [, init])" },
    { label: "format", detail: "string.format(fmt, ...)" },
    { label: "gmatch", detail: "string.gmatch(s, pat)" },
    { label: "gsub", detail: "string.gsub(s, pat, repl [, n])" },
    { label: "len", detail: "string.len(s)" },
    { label: "lower", detail: "string.lower(s)" },
    { label: "match", detail: "string.match(s, pat [, init])" },
    { label: "rep", detail: "string.rep(s, n [, sep])" },
    { label: "reverse", detail: "string.reverse(s)" },
    { label: "sub", detail: "string.sub(s, i [, j])" },
    { label: "upper", detail: "string.upper(s)" },
  ],
  table: [
    { label: "concat", detail: "table.concat(list [, sep [, i [, j]]])" },
    { label: "insert", detail: "table.insert(list, [pos,] value)" },
    { label: "move", detail: "table.move(a1, f, e, t [, a2])" },
    { label: "pack", detail: "table.pack(...)" },
    { label: "remove", detail: "table.remove(list [, pos])" },
    { label: "sort", detail: "table.sort(list [, comp])" },
    { label: "unpack", detail: "table.unpack(list [, i [, j]])" },
  ],
  utf8: [
    { label: "char", detail: "utf8.char(...)" },
    { label: "charpattern", detail: "string" },
    { label: "codepoint", detail: "utf8.codepoint(s [, i [, j]])" },
    { label: "codes", detail: "utf8.codes(s)" },
    { label: "len", detail: "utf8.len(s [, i [, j]])" },
    { label: "offset", detail: "utf8.offset(s, n [, i])" },
  ],
  os: [
    { label: "clock", detail: "os.clock()" },
    { label: "date", detail: "os.date([fmt [, time]])" },
    { label: "difftime", detail: "os.difftime(t2, t1)" },
    { label: "time", detail: "os.time([table])" },
  ],
};

const STDLIB_MEMBER_SETS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(LUA_STDLIB_MEMBERS).map(([mod, list]) => [
    mod,
    new Set(list.map((m) => m.label)),
  ]),
);

function matchLongBracket(code: string, start: number): { end: number; closed: boolean } | null {
  if (code[start] !== "[") return null;
  let eq = 0;
  let i = start + 1;
  while (code[i] === "=") {
    eq++;
    i++;
  }
  if (code[i] !== "[") return null;
  const close = "]" + "=".repeat(eq) + "]";
  const idx = code.indexOf(close, i + 1);
  return idx === -1
    ? { end: code.length, closed: false }
    : { end: idx + close.length, closed: true };
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentCont(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/// Tokenizes a Lua 5.4 source string for syntax highlighting and identifier
/// scraping. Preserves exact UTF-16 character offsets for ProseMirror.
export function tokenizeLua(code: string): LuaToken[] {
  const tokens: LuaToken[] = [];
  let i = 0;
  const len = code.length;

  while (i < len) {
    const ch = code[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Comments: `--[[...]]` or `--...`
    if (ch === "-" && code[i + 1] === "-") {
      const long = matchLongBracket(code, i + 2);
      if (long) {
        tokens.push({
          type: "comment",
          from: i,
          to: long.end,
          text: code.slice(i, long.end),
          closed: long.closed,
        });
        i = long.end;
      } else {
        const nl = code.indexOf("\n", i + 2);
        const end = nl === -1 ? len : nl;
        tokens.push({
          type: "comment",
          from: i,
          to: end,
          text: code.slice(i, end),
          closed: nl !== -1,
        });
        i = end;
      }
      continue;
    }

    // Long strings: `[[...]]`, `[=[...]=]`
    const longStr = matchLongBracket(code, i);
    if (longStr) {
      tokens.push({
        type: "string",
        from: i,
        to: longStr.end,
        text: code.slice(i, longStr.end),
        closed: longStr.closed,
      });
      i = longStr.end;
      continue;
    }

    // Short strings: `"..."` or `'...'`
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      let closed = false;
      while (i < len) {
        const c = code[i];
        if (c === "\n") break;
        if (c === "\\") {
          i += i + 1 < len ? 2 : 1;
          continue;
        }
        if (c === ch) {
          closed = true;
          i++;
          break;
        }
        i++;
      }
      tokens.push({
        type: "string",
        from: start,
        to: i,
        text: code.slice(start, i),
        closed,
      });
      continue;
    }

    // Numbers: hex or decimal
    if (isDigit(ch) || (ch === "." && isDigit(code[i + 1] ?? ""))) {
      const start = i;
      if (ch === "0" && (code[i + 1] === "x" || code[i + 1] === "X")) {
        i += 2;
        while (i < len && isHexDigit(code[i])) i++;
        if (code[i] === ".") {
          i++;
          while (i < len && isHexDigit(code[i])) i++;
        }
        if (code[i] === "p" || code[i] === "P") {
          i++;
          if (code[i] === "+" || code[i] === "-") i++;
          while (i < len && isDigit(code[i])) i++;
        }
      } else {
        while (i < len && isDigit(code[i])) i++;
        if (code[i] === "." && code[i + 1] !== ".") {
          i++;
          while (i < len && isDigit(code[i])) i++;
        }
        if (code[i] === "e" || code[i] === "E") {
          i++;
          if (code[i] === "+" || code[i] === "-") i++;
          while (i < len && isDigit(code[i])) i++;
        }
      }
      tokens.push({ type: "number", from: start, to: i, text: code.slice(start, i) });
      continue;
    }

    // Identifiers, keywords, builtins, and stdlib members
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < len && isIdentCont(code[i])) i++;
      const text = code.slice(start, i);
      const prev1 = tokens[tokens.length - 1];
      const prev2 = tokens[tokens.length - 2];
      let type: LuaTokenType = "ident";
      if (
        prev1?.type === "op" &&
        prev1.text === "." &&
        prev2 &&
        STDLIB_MEMBER_SETS[prev2.text]?.has(text) &&
        prev1.to === start &&
        prev2.to === prev1.from
      ) {
        type = "builtin";
      } else if (KEYWORD_SET.has(text)) {
        type = "keyword";
      } else if (BUILTIN_SET.has(text)) {
        type = "builtin";
      }
      tokens.push({ type, from: start, to: i, text });
      continue;
    }

    // Multi-character operators
    const two = code.slice(i, i + 2);
    if (
      two === ".." ||
      two === "==" ||
      two === "~=" ||
      two === "<=" ||
      two === ">=" ||
      two === "//" ||
      two === "<<" ||
      two === ">>" ||
      two === "::"
    ) {
      tokens.push({ type: "op", from: i, to: i + 2, text: two });
      i += 2;
      continue;
    }

    tokens.push({ type: "op", from: i, to: i + 1, text: ch });
    i++;
  }

  return tokens;
}

/// Extracts local variable, function, and parameter names from tokenized Lua,
/// ignoring any identifier currently being edited at `caretOffset`.
function extractLocalNames(tokens: LuaToken[], caretOffset?: number): string[] {
  const names = new Set<string>();
  const skip = (idx: number) => {
    while (idx < tokens.length && tokens[idx].type === "comment") idx++;
    return idx;
  };
  const addIdent = (tok: LuaToken | undefined) => {
    if (!tok || tok.type !== "ident") return;
    if (caretOffset !== undefined && tok.from <= caretOffset && caretOffset <= tok.to) return;
    names.add(tok.text);
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== "keyword") continue;

    if (t.text === "local") {
      let j = skip(i + 1);
      if (tokens[j]?.type === "keyword" && tokens[j].text === "function") {
        j = skip(j + 1);
        addIdent(tokens[j]);
        continue;
      }
      while (j < tokens.length) {
        addIdent(tokens[j]);
        j = skip(j + 1);
        if (tokens[j]?.type === "op" && tokens[j].text === ",") {
          j = skip(j + 1);
        } else {
          break;
        }
      }
    } else if (t.text === "function") {
      let j = skip(i + 1);
      if (tokens[j]?.type === "ident") {
        addIdent(tokens[j]);
        j = skip(j + 1);
      }
      if (tokens[j]?.type === "op" && tokens[j].text === "(") {
        j = skip(j + 1);
        while (j < tokens.length && !(tokens[j].type === "op" && tokens[j].text === ")")) {
          addIdent(tokens[j]);
          j = skip(j + 1);
          if (tokens[j]?.type === "op" && tokens[j].text === ",") j = skip(j + 1);
          else if (!(tokens[j]?.type === "op" && tokens[j].text === ")")) break;
        }
      }
    } else if (t.text === "for") {
      let j = skip(i + 1);
      while (j < tokens.length) {
        addIdent(tokens[j]);
        j = skip(j + 1);
        if (tokens[j]?.type === "op" && tokens[j].text === ",") {
          j = skip(j + 1);
        } else {
          break;
        }
      }
    }
  }
  return [...names];
}

function insideCommentOrString(tokens: LuaToken[], offset: number): boolean {
  for (const tok of tokens) {
    if (tok.type !== "comment" && tok.type !== "string") continue;
    if (offset > tok.from && (offset < tok.to || !tok.closed)) return true;
  }
  return false;
}

/// Computes Lua autocompletion candidates at UTF-16 `offset` within `code`, or
/// `null` when inside comments/strings or when nothing useful matches.
export function luaCompletionsAt(code: string, offset: number): LuaCompletionResult | null {
  const tokens = tokenizeLua(code);
  if (insideCommentOrString(tokens, offset)) return null;

  const before = code.slice(0, offset);
  const memberMatch = before.match(/(?:^|[^A-Za-z0-9_.])(math|string|table|utf8|os)\.([A-Za-z_]\w*)?$/);
  if (memberMatch) {
    const mod = memberMatch[1];
    const prefix = memberMatch[2] ?? "";
    const low = prefix.toLowerCase();
    const members = LUA_STDLIB_MEMBERS[mod] ?? [];
    const items: LuaCompletionItem[] = members
      .filter((m) => m.label.toLowerCase().startsWith(low))
      .map((m) => ({ label: m.label, insert: m.label, kind: "builtin", detail: m.detail }));
    if (items.length === 0 || (items.length === 1 && items[0].label === prefix)) return null;
    return { from: offset - prefix.length, to: offset, items };
  }

  const identMatch = before.match(/([A-Za-z_]\w*)$/);
  if (!identMatch) return null;
  const prefix = identMatch[1];
  if (prefix.length < 2) return null;
  // Already a complete keyword (e.g. `else`, `do`, `in`, `return`).
  if (KEYWORD_SET.has(prefix)) return null;
  const prefixStart = offset - prefix.length;
  // Don't offer globals right after an arbitrary member dot like `foo.ba`.
  if (before[prefixStart - 1] === ".") return null;
  // Don't pop up while naming a new variable, function, or loop counter.
  let prevTok: LuaToken | undefined;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.type === "comment" || t.to > prefixStart) continue;
    prevTok = t;
    break;
  }
  if (prevTok?.type === "keyword" && (prevTok.text === "local" || prevTok.text === "function" || prevTok.text === "for")) {
    return null;
  }

  const low = prefix.toLowerCase();
  const seen = new Set<string>();
  const items: LuaCompletionItem[] = [];

  for (const name of extractLocalNames(tokens, offset)) {
    if (!seen.has(name) && name.toLowerCase().startsWith(low)) {
      seen.add(name);
      items.push({ label: name, insert: name, kind: "local" });
    }
  }
  for (const b of LUA_BUILTINS) {
    if (!seen.has(b.label) && b.label.toLowerCase().startsWith(low)) {
      seen.add(b.label);
      items.push({ label: b.label, insert: b.label, kind: "builtin", detail: b.detail });
    }
  }
  for (const kw of LUA_KEYWORDS) {
    if (!seen.has(kw) && kw.toLowerCase().startsWith(low)) {
      seen.add(kw);
      items.push({ label: kw, insert: kw, kind: "keyword" });
    }
  }

  if (items.length === 0 || (items.length === 1 && items[0].label === prefix)) return null;
  return { from: offset - prefix.length, to: offset, items };
}

function buildHighlightDecorations(state: EditorState): DecorationSet {
  const luaType = schema.nodes.lua_block;
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type !== luaType) return;
    const base = pos + 1;
    for (const tok of tokenizeLua(node.textContent)) {
      if (tok.type === "ident" || tok.type === "op") continue;
      decos.push(Decoration.inline(base + tok.from, base + tok.to, { class: `lua-tok-${tok.type}` }));
    }
    return false;
  });
  return DecorationSet.create(state.doc, decos);
}

/// ProseMirror plugin applying inline syntax-token classes inside `lua_block`s.
export function luaHighlightPlugin(): Plugin {
  return new Plugin({
    state: {
      init(_cfg, state) {
        return buildHighlightDecorations(state);
      },
      apply(tr, old, _oldState, newState) {
        return tr.docChanged ? buildHighlightDecorations(newState) : old;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/// ProseMirror plugin rendering a caret-anchored Lua autocomplete popup with
/// non-intrusive keyboard navigation (Tab accepts, Arrow+Enter accepts while a
/// passive popup lets Enter insert a newline, Esc dismisses the popup without
/// closing the card modal).
export function luaCompletionPlugin(): Plugin {
  let onKey: ((e: KeyboardEvent) => boolean) | null = null;

  return new Plugin({
    props: {
      handleKeyDown(_view, e) {
        return onKey ? onKey(e) : false;
      },
    },
    view(editorView: EditorView) {
      const popup = document.createElement("div");
      popup.className = "lua-autocomplete";
      popup.setAttribute("popover", "manual");
      popup.setAttribute("role", "listbox");
      popup.setAttribute("aria-label", "Lua completions");

      let items: LuaCompletionItem[] = [];
      let absFrom = 0;
      let absTo = 0;
      let idx = 0;
      let visible = false;
      let navigated = false;
      let dismissedKey: string | null = null;

      const hide = () => {
        if (!visible) return;
        visible = false;
        navigated = false;
        hidePopoverSafe(popup);
        popup.remove();
        items = [];
      };

      const accept = (item: LuaCompletionItem | undefined) => {
        if (!item) return;
        const tr = editorView.state.tr.insertText(item.insert, absFrom, absTo);
        hide();
        editorView.dispatch(tr.scrollIntoView());
        editorView.focus();
      };

      const highlight = () => {
        const els = popup.querySelectorAll<HTMLButtonElement>(".lua-autocomplete-item");
        els.forEach((el, i) => {
          const active = i === idx;
          el.classList.toggle("lua-autocomplete-item--hi", active);
          el.setAttribute("aria-selected", String(active));
        });
        els[idx]?.scrollIntoView({ block: "nearest" });
      };

      const position = () => {
        positionFloating(
          popup,
          () => editorView.coordsAtPos(editorView.state.selection.head),
          { gap: 4 },
        );
      };

      onKey = (e: KeyboardEvent) => {
        if (!visible || !editorView.dom.isConnected || !editorView.hasFocus()) {
          hide();
          return false;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) {
          if (e.key.toLowerCase() === "k" || e.key === "Enter") hide();
          return false;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          idx = (idx + 1) % items.length;
          navigated = true;
          highlight();
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          idx = (idx - 1 + items.length) % items.length;
          navigated = true;
          highlight();
          return true;
        }
        if (!e.shiftKey && e.key === "Tab") {
          e.preventDefault();
          accept(items[idx]);
          return true;
        }
        if (!e.shiftKey && e.key === "Enter") {
          if (navigated) {
            e.preventDefault();
            accept(items[idx]);
            return true;
          }
          hide();
          return false;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          dismissedKey = `${absFrom}:${editorView.state.doc.textBetween(absFrom, absTo)}`;
          hide();
          return true;
        }
        return false;
      };

      const onPointerDown = (e: PointerEvent) => {
        if ((e.target as Element | null)?.closest(".lua-autocomplete")) return;
        hide();
      };
      const onFocusOut = () => hide();
      const releaseOverlay = onOverlayOpen(() => hide());
      document.addEventListener("pointerdown", onPointerDown, true);
      editorView.dom.addEventListener("focusout", onFocusOut);

      const render = (nextItems: LuaCompletionItem[]) => {
        items = nextItems;
        idx = 0;
        navigated = false;
        popup.textContent = "";
        for (const item of items) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "lua-autocomplete-item";
          btn.setAttribute("role", "option");
          btn.addEventListener("mousedown", (e) => e.preventDefault());
          btn.addEventListener("click", () => accept(item));

          const kind = document.createElement("span");
          kind.className = `lua-ac-kind lua-ac-kind--${item.kind}`;
          kind.textContent = item.kind === "keyword" ? "kw" : item.kind === "builtin" ? "fn" : "var";

          const label = document.createElement("span");
          label.className = "lua-ac-label";
          label.textContent = item.label;

          btn.append(kind, label);
          if (item.detail) {
            const detail = document.createElement("span");
            detail.className = "lua-ac-detail";
            detail.textContent = item.detail;
            btn.append(detail);
          }
          popup.appendChild(btn);
        }

        if (!visible) {
          (editorView.dom.parentElement ?? document.body).appendChild(popup);
          showPopoverSafe(popup);
          visible = true;
        }
        highlight();
        position();
      };

      return {
        update(view, prevState) {
          const { state } = view;
          const docChanged = !state.doc.eq(prevState.doc);
          const sel = state.selection;
          if (
            !view.hasFocus() ||
            !(sel instanceof TextSelection) ||
            !sel.empty ||
            sel.$from.parent.type !== schema.nodes.lua_block
          ) {
            dismissedKey = null;
            hide();
            return;
          }

          if (!docChanged) {
            hide();
            return;
          }

          const blockStart = sel.$from.start();
          const offset = sel.from - blockStart;
          const result = luaCompletionsAt(sel.$from.parent.textContent, offset);
          if (!result) {
            dismissedKey = null;
            hide();
            return;
          }

          absFrom = blockStart + result.from;
          absTo = blockStart + result.to;
          const key = `${absFrom}:${state.doc.textBetween(absFrom, absTo)}`;
          if (dismissedKey === key) return;
          dismissedKey = null;
          render(result.items);
        },
        destroy() {
          hide();
          onKey = null;
          releaseOverlay();
          document.removeEventListener("pointerdown", onPointerDown, true);
          editorView.dom.removeEventListener("focusout", onFocusOut);
        },
      };
    },
  });
}
