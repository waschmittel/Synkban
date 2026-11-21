/// Helpers for escaping container/code blocks: gap-cursor block rules,
/// inserting paragraphs above/below a block, padding clicks, and code-block
/// Enter/Backspace ergonomics.

import { chainCommands, setBlockType } from "prosemirror-commands";
import { GapCursor } from "prosemirror-gapcursor";
import { undoInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { ResolvedPos } from "prosemirror-model";
import { type Command, EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/// `GapCursor.valid` exists at runtime on `prosemirror-gapcursor` but is
/// marked `@internal` in its `.d.ts`.
export function isValidGapCursor($pos: ResolvedPos): boolean {
  return (GapCursor as unknown as { valid($pos: ResolvedPos): boolean }).valid($pos);
}

const ESCAPABLE_BLOCKS = new Set(["table", "code_block", "lua_block", "blockquote", "bullet_list", "ordered_list"]);

/// True when the selection sits inside a single top-level block that cannot
/// naturally be escaped by typing/splitting (table, code block, quote, list).
export function inEscapableBlock(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return (
    $from.depth >= 1 &&
    $to.depth >= 1 &&
    $from.before(1) === $to.before(1) &&
    ESCAPABLE_BLOCKS.has($from.node(1).type.name)
  );
}

function insertParagraph(where: "before" | "after"): Command {
  return (state, dispatch) => {
    if (!inEscapableBlock(state)) return false;
    const { $from } = state.selection;
    const pos = where === "before" ? $from.before(1) : $from.after(1);
    if (dispatch) {
      const tr = state.tr.insert(pos, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const insertParagraphAbove: Command = insertParagraph("before");
export const insertParagraphBelow: Command = insertParagraph("after");

/// Pressing Enter on an already-blank trailing line at the end of a code block
/// strips the two trailing newlines and exits into a paragraph below.
export const exitCodeOnTripleEnter: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false;
  const { $head, $anchor } = state.selection;
  if (!$head.parent.type.spec.code || !$head.sameParent($anchor)) return false;
  const text = $head.parent.textContent;
  if ($head.parentOffset !== text.length || !text.endsWith("\n\n")) return false;
  const above = $head.node(-1);
  const after = $head.indexAfter(-1);
  const paragraph = state.schema.nodes.paragraph;
  if (!above.canReplaceWith(after, after, paragraph)) return false;
  if (dispatch) {
    const tr = state.tr.delete($head.pos - 2, $head.pos);
    const insertAt = tr.mapping.map($head.after());
    tr.insert(insertAt, paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/// Backspace inside an empty code or Lua block converts it to a plain paragraph.
export const clearEmptyCodeBlock: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false;
  const { $from } = state.selection;
  if (!$from.parent.type.spec.code || $from.parent.content.size !== 0) return false;
  return setBlockType(state.schema.nodes.paragraph)(state, dispatch);
};

const CODE_INDENT = "  ";

/// Indents (`dir = 1`) or unindents (`dir = -1`) every line touched by the
/// selection inside a code block. Always returns `true` inside a code block so
/// a no-op `Shift+Tab` never jumps focus out of the editor.
export function indentCodeBlock(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof TextSelection)) return false;
    const { $from, $to } = sel;
    if (!$from.parent.type.spec.code || !$from.sameParent($to)) return false;

    if (dispatch) {
      const blockStart = $from.start();
      const text = $from.parent.textContent;
      const fromOff = sel.from - blockStart;
      const toOff = sel.to - blockStart;
      const firstLineStart = fromOff === 0 ? 0 : text.lastIndexOf("\n", fromOff - 1) + 1;
      const endLimit = toOff > fromOff && text[toOff - 1] === "\n" ? toOff - 1 : toOff;
      const lineStarts = [firstLineStart];
      for (let i = firstLineStart; i < endLimit; i++) {
        if (text[i] === "\n") lineStarts.push(i + 1);
      }

      const tr = state.tr;
      let changed = false;
      for (let i = lineStarts.length - 1; i >= 0; i--) {
        const start = lineStarts[i];
        const pos = blockStart + start;
        if (dir > 0) {
          if (lineStarts.length > 1 && (start === text.length || text[start] === "\n")) continue;
          tr.insertText(CODE_INDENT, pos);
          changed = true;
        } else {
          const remove =
            text[start] === "\t"
              ? 1
              : text.startsWith(CODE_INDENT, start)
                ? CODE_INDENT.length
                : text[start] === " "
                  ? 1
                  : 0;
          if (remove > 0) {
            tr.delete(pos, pos + remove);
            changed = true;
          }
        }
      }

      if (changed) {
        const startPos = blockStart + firstLineStart;
        const anchorAssoc = !sel.empty && sel.anchor === startPos && sel.anchor < sel.head ? -1 : 1;
        const headAssoc = !sel.empty && sel.head === startPos && sel.head < sel.anchor ? -1 : 1;
        tr.setSelection(
          TextSelection.create(
            tr.doc,
            tr.mapping.map(sel.anchor, anchorAssoc),
            tr.mapping.map(sel.head, headAssoc),
          ),
        );
        dispatch(tr.scrollIntoView());
      }
    }
    return true;
  };
}

/// Keeps a boundary gap cursor at the start/end of the document instead of
/// letting the browser's native arrow fallback pull the caret back into the block.
export function clampGapCursor(dir: -1 | 1): Command {
  return (state) => {
    if (!(state.selection instanceof GapCursor)) return false;
    return state.selection.head === (dir < 0 ? 0 : state.doc.content.size);
  };
}

export const blockEscapeKeymap = keymap({
  Tab: indentCodeBlock(1),
  "Shift-Tab": indentCodeBlock(-1),
  Enter: exitCodeOnTripleEnter,
  Backspace: chainCommands(undoInputRule, clearEmptyCodeBlock),
  ArrowUp: clampGapCursor(-1),
  ArrowLeft: clampGapCursor(-1),
  ArrowDown: clampGapCursor(1),
  ArrowRight: clampGapCursor(1),
});

/// Finds a valid gap-cursor boundary at viewport coordinate `y` when clicking
/// editor padding above the first block, between blocks, or below the last one.
export function gapPosAtY(view: EditorView, y: number): number | null {
  const { doc } = view.state;
  let pos = 0;
  let prevBottom = -Infinity;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const dom = view.nodeDOM(pos);
    if (dom instanceof Element) {
      const rect = dom.getBoundingClientRect();
      if (y < rect.top && y > prevBottom) {
        return isValidGapCursor(doc.resolve(pos)) ? pos : null;
      }
      prevBottom = rect.bottom;
    }
    pos += child.nodeSize;
  }
  if (y > prevBottom) {
    return isValidGapCursor(doc.resolve(doc.content.size)) ? doc.content.size : null;
  }
  return null;
}
