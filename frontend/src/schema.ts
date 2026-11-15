/// The ProseMirror schema of card descriptions, and the text styles (block
/// types) shared by the toolbar dropdown and the Accel+K menu.

import { Schema, Mark as PmMark, type Attrs, type NodeSpec } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { setBlockType } from "prosemirror-commands";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { blockTypeItem } from "prosemirror-menu";
import { tableNodeSpecs } from "./tables";

const filteredNodes = basicSchema.spec.nodes.remove("image").remove("horizontal_rule");

/// Inline reference to an *image attachment* of the card (`att` = attachment
/// id), not a URL — the editor renders it from the attachment endpoints
/// (ADR-0020). Only `img[data-att]` parses, so foreign images never get in.
const imageSpec: NodeSpec = {
  inline: true,
  group: "inline",
  draggable: true,
  attrs: { att: {}, alt: { default: "" } },
  parseDOM: [
    {
      tag: "img[data-att]",
      getAttrs: (dom) => ({
        att: (dom as HTMLElement).getAttribute("data-att"),
        alt: (dom as HTMLElement).getAttribute("alt") ?? "",
      }),
    },
  ],
  toDOM: (node) => ["img", { "data-att": node.attrs.att, alt: node.attrs.alt }],
};

// Override the link mark's toDOM so rendered anchors carry target="_blank" and
// a safe rel. The editor opens links via handleClick (below), but the
// attributes keep the markup correct and serve as a fallback.
const linkSpec = basicSchema.spec.marks.get("link")!;
const marks = basicSchema.spec.marks.update("link", {
  ...linkSpec,
  toDOM(mark: PmMark) {
    const { href, title } = mark.attrs;
    return ["a", { href, title, target: "_blank", rel: "noopener noreferrer" }, 0];
  },
});

export const schema = new Schema({
  nodes: addListNodes(filteredNodes, "paragraph block*", "block").append(tableNodeSpecs).addToEnd("image", imageSpec),
  marks,
});

/// The text styles of the toolbar dropdown and the Accel+K menu.
export const TEXT_STYLES = [
  { label: "Plain text", short: "Plain text", node: schema.nodes.paragraph, attrs: null, key: "0" },
  { label: "Code block", short: "Code block", node: schema.nodes.code_block, attrs: null, key: "b" },
  ...[1, 2, 3].map((level) => ({
    label: `Heading ${level}`,
    short: `Heading ${level}`,
    node: schema.nodes.heading,
    attrs: { level } as Attrs | null,
    key: String(level),
  })),
].map((t) => ({
  ...t,
  /// Possible right now (false in table cells, and for the current style).
  command: setBlockType(t.node, t.attrs),
  /// Whether the selection's block already has this style.
  active(state: EditorState) {
    const { $from, to, node } = state.selection as any;
    if (node) return node.hasMarkup(t.node, t.attrs);
    return to <= $from.end() && $from.parent.hasMarkup(t.node, t.attrs);
  },
  item() {
    return blockTypeItem(t.node, {
      title: t.label,
      label: t.label,
      attrs: t.attrs,
      // The current style stays a (checked) choice instead of greying out.
      enable: (state: EditorState) => this.command(state) || this.active(state),
    });
  },
}));

