/// List helpers for the description editor: detecting the innermost enclosing
/// list and converting between bullet and ordered lists.

import type { Node as PmNode, NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { wrapInList } from "prosemirror-schema-list";
import { schema } from "./schema";

const bulletListType = schema.nodes.bullet_list;
const orderedListType = schema.nodes.ordered_list;

export interface EnclosingList {
  node: PmNode;
  pos: number;
  depth: number;
}

/// Returns the innermost `bullet_list` or `ordered_list` enclosing the entire
/// selection, or `null` if the selection is outside a list or spans across lists.
export function enclosingList(state: EditorState): EnclosingList | null {
  const { $from, $to } = state.selection;
  const maxDepth = Math.min($from.depth, $to.depth);
  for (let d = maxDepth; d > 0; d--) {
    const node = $from.node(d);
    if (
      (node.type === bulletListType || node.type === orderedListType) &&
      $from.before(d) === $to.before(d)
    ) {
      return { node, pos: $from.before(d), depth: d };
    }
  }
  return null;
}

/// Converts the innermost enclosing list to `targetType` (`bullet_list` or
/// `ordered_list`). Returns `false` if not inside a list or already that type.
export function convertList(targetType: NodeType): Command {
  return (state, dispatch) => {
    const found = enclosingList(state);
    if (!found || found.node.type === targetType) return false;
    if (dispatch) {
      const attrs = targetType === orderedListType ? { order: 1 } : null;
      dispatch(state.tr.setNodeMarkup(found.pos, targetType, attrs).scrollIntoView());
    }
    return true;
  };
}

/// Converts the innermost enclosing list between bullet and ordered list.
export const toggleListType: Command = (state, dispatch, view) => {
  const found = enclosingList(state);
  if (!found) return false;
  const target = found.node.type === orderedListType ? bulletListType : orderedListType;
  return convertList(target)(state, dispatch, view);
};

/// Context-sensitive label for the editor menu's list conversion item.
export function convertListLabel(state: EditorState): string {
  return enclosingList(state)?.node.type === orderedListType
    ? "Convert to bullet list"
    : "Convert to ordered list";
}

/// Wraps the selection in `targetType` when outside a list, converts the
/// innermost enclosing list when inside the other list type, and does nothing
/// (returns `false`) when already inside `targetType`.
export function setListType(targetType: NodeType): Command {
  const wrap = wrapInList(targetType);
  return (state, dispatch, view) => {
    const found = enclosingList(state);
    if (found) {
      if (found.node.type === targetType) return false;
      return convertList(targetType)(state, dispatch, view);
    }
    return wrap(state, dispatch, view);
  };
}
