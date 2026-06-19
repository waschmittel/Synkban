/// Auto-linkify URLs in the card description editor: typed URLs become links
/// when followed by a space/enter (InputRule), and pasting a bare URL either
/// wraps the current selection or inserts a linked text node. Both paths reuse
/// `sanitizeLinkHref` so the same protocol allow-list as the link dialog applies.

import { InputRule, inputRules } from "prosemirror-inputrules";
import { MarkType, Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { sanitizeLinkHref } from "./proseEditor";

/// Matches a URL (http(s):// or www.) immediately followed by a trigger char
/// (whitespace). The trailing trigger is re-inserted unmarked so the link mark
/// doesn't bleed into subsequent typing.
const URL_INPUT = /(https?:\/\/[^\s]+|www\.[^\s]+?)([.,;:!?)\]]*)(\s)$/;

/// Detects whether an entire pasted string is a single URL (no internal
/// whitespace), used to decide between linkifying and a normal paste.
const URL_WHOLE = /^(https?:\/\/\S+|www\.\S+)$/;

export function autolinkInputRules(schema: Schema): Plugin {
  const linkType = schema.marks.link;
  const rule = new InputRule(URL_INPUT, (state, match, start, end) => {
    const url = match[1];
    const href = sanitizeLinkHref(url);
    if (!href) return null;
    const urlStart = start + match[0].indexOf(url);
    const urlEnd = urlStart + url.length;
    return state.tr
      .addMark(urlStart, urlEnd, linkType.create({ href }))
      .removeStoredMark(linkType)
      .insertText(match[2] + match[3], urlEnd, end);
  });
  return inputRules({ rules: [rule] });
}

/// Paste handler: when the clipboard holds a single bare URL, wrap the current
/// selection in a link (non-empty selection) or insert the URL as linked text
/// (empty selection). Returns false for anything else so normal paste runs.
export function handleAutolinkPaste(schema: Schema): (view: EditorView, event: ClipboardEvent) => boolean {
  const linkType: MarkType = schema.marks.link;
  return (view, event) => {
    const text = event.clipboardData?.getData("text/plain")?.trim();
    if (!text || !URL_WHOLE.test(text)) return false;
    const href = sanitizeLinkHref(text);
    if (!href) return false;

    const { empty } = view.state.selection;
    const mark = linkType.create({ href });
    if (empty) {
      const node = schema.text(text, [mark]);
      view.dispatch(view.state.tr.replaceSelectionWith(node, false).removeStoredMark(linkType));
    } else {
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.addMark(from, to, mark).removeStoredMark(linkType));
    }
    return true;
  };
}
