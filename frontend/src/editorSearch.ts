/// Find & replace plugin for the card description ProseMirror editor (ADR-0029).
///
/// Matches are computed per textblock so queries span inline marks (bold, links,
/// code) without ever bridging across block or table-cell boundaries. Replace
/// all applies edits in reverse document order inside a single transaction so
/// one Undo reverts the whole batch.

import { Plugin, PluginKey, TextSelection, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchState {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  matches: SearchMatch[];
  activeIndex: number;
  regexError: string | null;
  decorations: DecorationSet;
}

export const MAX_SEARCH_MATCHES = 10_000;

export const EMPTY_SEARCH_STATE: SearchState = {
  open: false,
  replaceOpen: false,
  query: "",
  caseSensitive: false,
  regex: false,
  matches: [],
  activeIndex: -1,
  regexError: null,
  decorations: DecorationSet.empty,
};

type SearchAction =
  | { type: "open"; replaceOpen?: boolean; query?: string }
  | { type: "close" }
  | {
      type: "update";
      query?: string;
      caseSensitive?: boolean;
      regex?: boolean;
      replaceOpen?: boolean;
    }
  | { type: "step"; delta: 1 | -1 }
  | { type: "afterReplace" };

export const searchPluginKey = new PluginKey<SearchState>("editorSearch");

export function compileSearchRegex(
  query: string,
  caseSensitive: boolean,
  regex: boolean,
): { re: RegExp | null; error: string | null } {
  if (!query) return { re: null, error: null };
  const flags = caseSensitive ? "g" : "gi";
  try {
    if (regex) return { re: new RegExp(query, flags), error: null };
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { re: new RegExp(escaped, flags), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message.replace(/^Invalid regular expression:\s*/, "") : "Invalid regex";
    return { re: null, error: msg };
  }
}

/// Finds all non-empty matches of `re` inside every textblock of `doc`.
export function findMatches(doc: PmNode, re: RegExp): SearchMatch[] {
  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_SEARCH_MATCHES) return false;
    if (!node.isTextblock) return true;

    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const childPos = pos + 1 + offset;
      if (child.isText && child.text) {
        text += child.text;
        for (let i = 0; i < child.text.length; i++) positions.push(childPos + i);
      } else if (child.type.name === "hard_break") {
        text += "\n";
        positions.push(childPos);
      } else {
        // Inline atom (e.g. image): acts as a barrier so matches never bridge it.
        text += "\uFFFC";
        positions.push(childPos);
      }
    });

    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      matches.push({ from: positions[start], to: positions[end - 1] + 1 });
      if (matches.length >= MAX_SEARCH_MATCHES) break;
    }
    return false;
  });
  return matches;
}

/// Computes replacement text for a single match. Literal mode returns
/// `replacement` verbatim so `$1`/`$&` are not expanded; regex mode applies
/// standard JS capture-group expansion.
export function computeReplacement(
  matchedText: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
  regex: boolean,
): string {
  if (!regex) return replacement;
  const single = new RegExp(query, caseSensitive ? "" : "i");
  return matchedText.replace(single, replacement);
}

function buildDecorations(doc: PmNode, matches: SearchMatch[], activeIndex: number): DecorationSet {
  if (!matches.length) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? "pm-search-match pm-search-match--active" : "pm-search-match",
    }),
  );
  return DecorationSet.create(doc, decos);
}

function firstMatchAtOrAfter(matches: SearchMatch[], pos: number): number {
  if (!matches.length) return -1;
  const idx = matches.findIndex((m) => m.from >= pos);
  return idx === -1 ? 0 : idx;
}

export function editorSearchPlugin(onStateChange?: (state: SearchState) => void): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchPluginKey,
    state: {
      init: () => EMPTY_SEARCH_STATE,
      apply(tr, prev, _oldState, newState) {
        const action = tr.getMeta(searchPluginKey) as SearchAction | undefined;
        if (!action && !tr.docChanged) return prev;

        if (action?.type === "close") {
          return {
            ...prev,
            open: false,
            matches: [],
            activeIndex: -1,
            regexError: null,
            decorations: DecorationSet.empty,
          };
        }

        const nextOpen = action?.type === "open" ? true : prev.open;
        if (!nextOpen) return prev;

        const nextReplaceOpen =
          action?.type === "open"
            ? (action.replaceOpen ?? prev.replaceOpen)
            : action?.type === "update" && action.replaceOpen !== undefined
              ? action.replaceOpen
              : prev.replaceOpen;

        const nextQuery =
          action?.type === "open" && action.query !== undefined
            ? action.query
            : action?.type === "update" && action.query !== undefined
              ? action.query
              : prev.query;

        const nextCase =
          action?.type === "update" && action.caseSensitive !== undefined
            ? action.caseSensitive
            : prev.caseSensitive;

        const nextRegex =
          action?.type === "update" && action.regex !== undefined ? action.regex : prev.regex;

        // Stepping does not need to re-scan the document.
        if (action?.type === "step" && !tr.docChanged) {
          if (!prev.matches.length) return prev;
          const activeIndex =
            (prev.activeIndex + action.delta + prev.matches.length) % prev.matches.length;
          return {
            ...prev,
            activeIndex,
            decorations: buildDecorations(newState.doc, prev.matches, activeIndex),
          };
        }

        // Toggling only the replace row doesn't need to re-scan the document.
        if (
          action?.type === "update" &&
          !tr.docChanged &&
          nextQuery === prev.query &&
          nextCase === prev.caseSensitive &&
          nextRegex === prev.regex
        ) {
          return nextReplaceOpen === prev.replaceOpen
            ? prev
            : { ...prev, replaceOpen: nextReplaceOpen };
        }

        const { re, error } = compileSearchRegex(nextQuery, nextCase, nextRegex);
        const matches = re ? findMatches(newState.doc, re) : [];

        let activeIndex = -1;
        if (matches.length > 0) {
          if (action?.type === "afterReplace" || action?.type === "open" || action?.type === "update") {
            activeIndex = firstMatchAtOrAfter(matches, tr.selection.from);
          } else {
            activeIndex = Math.min(Math.max(prev.activeIndex, 0), matches.length - 1);
          }
        }

        return {
          open: true,
          replaceOpen: nextReplaceOpen,
          query: nextQuery,
          caseSensitive: nextCase,
          regex: nextRegex,
          matches,
          activeIndex,
          regexError: error,
          decorations: buildDecorations(newState.doc, matches, activeIndex),
        };
      },
    },
    props: {
      decorations(state) {
        return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
    view(editorView) {
      onStateChange?.(searchPluginKey.getState(editorView.state) ?? EMPTY_SEARCH_STATE);
      return {
        update(view, prevState) {
          const next = searchPluginKey.getState(view.state) ?? EMPTY_SEARCH_STATE;
          const prev = searchPluginKey.getState(prevState) ?? EMPTY_SEARCH_STATE;
          if (next !== prev) onStateChange?.(next);
        },
      };
    },
  });
}

export function getSearchState(state: EditorState): SearchState {
  return searchPluginKey.getState(state) ?? EMPTY_SEARCH_STATE;
}

/// Extracts a clean single-line selection to pre-fill Find (empty if none or multi-line).
function selectedSingleLineText(state: EditorState): string | undefined {
  const { from, to, empty } = state.selection;
  if (empty || to - from > 200) return undefined;
  const text = state.doc.textBetween(from, to, "\n", "\uFFFC");
  if (!text || text.includes("\n") || text.includes("\uFFFC")) return undefined;
  return text;
}

function scrollActiveMatchIntoView(view: EditorView) {
  const el = view.dom.querySelector(".pm-search-match--active");
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "nearest" });
  }
}

export function openSearch(view: EditorView, opts?: { replace?: boolean }) {
  const prev = getSearchState(view.state);
  const prefill = !prev.open || view.hasFocus() ? selectedSingleLineText(view.state) : undefined;
  view.dispatch(
    view.state.tr.setMeta(searchPluginKey, {
      type: "open",
      replaceOpen: opts?.replace,
      query: prefill,
    } satisfies SearchAction),
  );
  scrollActiveMatchIntoView(view);
}

export function closeSearch(view: EditorView, focusEditor = true) {
  const prev = getSearchState(view.state);
  if (!prev.open) return;
  const active = prev.matches[prev.activeIndex];
  let tr = view.state.tr.setMeta(searchPluginKey, { type: "close" } satisfies SearchAction);
  if (active && active.to <= tr.doc.content.size) {
    tr = tr.setSelection(TextSelection.create(tr.doc, active.from, active.to)).scrollIntoView();
  }
  view.dispatch(tr);
  if (focusEditor) view.focus();
}

export function updateSearch(
  view: EditorView,
  patch: { query?: string; caseSensitive?: boolean; regex?: boolean; replaceOpen?: boolean },
) {
  view.dispatch(
    view.state.tr.setMeta(searchPluginKey, { type: "update", ...patch } satisfies SearchAction),
  );
  if (patch.query !== undefined || patch.caseSensitive !== undefined || patch.regex !== undefined) {
    scrollActiveMatchIntoView(view);
  }
}

export function stepSearch(view: EditorView, delta: 1 | -1) {
  const prev = getSearchState(view.state);
  if (!prev.open || !prev.matches.length) return;
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { type: "step", delta } satisfies SearchAction));
  scrollActiveMatchIntoView(view);
}

export function replaceActive(view: EditorView, replacement: string): boolean {
  const s = getSearchState(view.state);
  if (!s.open || s.regexError || s.activeIndex < 0) return false;
  const match = s.matches[s.activeIndex];
  if (!match) return false;

  const matchedText = view.state.doc.textBetween(match.from, match.to, "\n", "\uFFFC");
  const repText = computeReplacement(matchedText, s.query, replacement, s.caseSensitive, s.regex);
  const tr = view.state.tr
    .insertText(repText, match.from, match.to)
    .setMeta(searchPluginKey, { type: "afterReplace" } satisfies SearchAction);
  tr.setSelection(TextSelection.create(tr.doc, match.from + repText.length));
  view.dispatch(tr.scrollIntoView());
  scrollActiveMatchIntoView(view);
  return true;
}

export function replaceAllMatches(view: EditorView, replacement: string): number {
  const s = getSearchState(view.state);
  if (!s.open || s.regexError || !s.matches.length) return 0;

  const tr = view.state.tr;
  const count = s.matches.length;
  for (let i = count - 1; i >= 0; i--) {
    const m = s.matches[i];
    const matchedText = view.state.doc.textBetween(m.from, m.to, "\n", "\uFFFC");
    const repText = computeReplacement(matchedText, s.query, replacement, s.caseSensitive, s.regex);
    tr.insertText(repText, m.from, m.to);
  }
  view.dispatch(tr.scrollIntoView());
  return count;
}
