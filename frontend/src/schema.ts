/// The ProseMirror schema of card descriptions (derived from `schema.json`,
/// shared with `backend/src/schema.rs`), and the text styles (block types)
/// shared by the toolbar dropdown and the Accel+K menu.

import {
  Schema,
  Mark as PmMark,
  Node as PmNode,
  type AttributeSpec,
  type Attrs,
  type MarkSpec,
  type NodeSpec,
  type NodeType,
} from "prosemirror-model";
import { type Command, type EditorState, type Selection, TextSelection } from "prosemirror-state";
import { setBlockType } from "prosemirror-commands";
import { GapCursor } from "prosemirror-gapcursor";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { MenuItem } from "prosemirror-menu";
import { tableNodeSpecs } from "./tables";
import { isValidLinkHref } from "./links";
import schemaSpec from "./schema.json";

export { schemaSpec };

const ALLOWED_ALIGNMENTS: ReadonlySet<string> = new Set(schemaSpec.allowedAlignments);
const ALLOWED_HIGHLIGHT_COLORS: ReadonlySet<string> = new Set(schemaSpec.allowedHighlightColors);
const ALLOWED_ALERT_KINDS: ReadonlySet<string> = new Set(schemaSpec.allowedAlertKinds);

export type HighlightColor = (typeof schemaSpec.allowedHighlightColors)[number];
export type AlertKind = (typeof schemaSpec.allowedAlertKinds)[number];

function attrValidator(type: string): (value: unknown) => void {
  switch (type) {
    case "number":
      return (v) => {
        if (typeof v !== "number" || !Number.isFinite(v)) throw new RangeError("Expected number");
      };
    case "boolean":
      return (v) => {
        if (typeof v !== "boolean") throw new RangeError("Expected boolean");
      };
    case "string":
      return (v) => {
        if (typeof v !== "string") throw new RangeError("Expected string");
      };
    case "string|null":
      return (v) => {
        if (v !== null && typeof v !== "string") throw new RangeError("Expected string or null");
      };
    case "non_empty_string":
      return (v) => {
        if (typeof v !== "string" || v.length === 0) throw new RangeError("Expected non-empty string");
      };
    case "colwidth":
      return (v) => {
        if (v !== null && (!Array.isArray(v) || !v.every((n) => typeof n === "number" && Number.isFinite(n))))
          throw new RangeError("Expected colwidth array or null");
      };
    case "align":
      return (v) => {
        if (v !== null && (typeof v !== "string" || !ALLOWED_ALIGNMENTS.has(v)))
          throw new RangeError("Expected valid align or null");
      };
    case "link_href":
      return (v) => {
        if (typeof v !== "string" || !isValidLinkHref(v)) throw new RangeError("Expected valid link href");
      };
    case "highlight_color":
      return (v) => {
        if (typeof v !== "string" || !ALLOWED_HIGHLIGHT_COLORS.has(v))
          throw new RangeError("Expected valid highlight color");
      };
    case "alert_kind":
      return (v) => {
        if (typeof v !== "string" || !ALLOWED_ALERT_KINDS.has(v))
          throw new RangeError("Expected valid alert kind");
      };
    default:
      throw new Error(`Unknown schema attribute type: ${type}`);
  }
}

interface JsonAttrSpec {
  default?: unknown;
  type: string;
}

interface JsonNodeSpec {
  content?: string;
  group?: string;
  inline?: boolean;
  marks?: string;
  code?: boolean;
  attrs?: Record<string, JsonAttrSpec>;
}

interface JsonMarkSpec {
  excludes?: string;
  attrs?: Record<string, JsonAttrSpec>;
}

function buildAttrs(raw?: Record<string, JsonAttrSpec>): Record<string, AttributeSpec> | undefined {
  if (!raw) return undefined;
  const out: Record<string, AttributeSpec> = {};
  for (const [name, spec] of Object.entries(raw)) {
    const attr: AttributeSpec = { validate: attrValidator(spec.type) };
    if ("default" in spec) attr.default = spec.default;
    out[name] = attr;
  }
  return out;
}

/// Inline reference to an *image attachment* of the card (`att` = attachment
/// id), not a URL — the editor renders it from the attachment endpoints
/// (ADR-0020). Only `img[data-att]` parses, so foreign images never get in.
const imageSpec: NodeSpec = {
  draggable: true,
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

const luaBlockSpec: NodeSpec = {
  defining: true,
  selectable: false,
  parseDOM: [
    {
      tag: "pre[data-lua]",
      preserveWhitespace: "full",
      priority: 60,
      getAttrs: (dom) => ({
        output: (dom as HTMLElement).getAttribute("data-output"),
        error: (dom as HTMLElement).getAttribute("data-error"),
        ran_hash: (dom as HTMLElement).getAttribute("data-ran-hash"),
      }),
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { "data-lua": "" };
    if (node.attrs.output !== null) attrs["data-output"] = node.attrs.output;
    if (node.attrs.error !== null) attrs["data-error"] = node.attrs.error;
    if (node.attrs.ran_hash !== null) attrs["data-ran-hash"] = node.attrs.ran_hash;
    return ["pre", attrs, ["code", 0]];
  },
};

const footnoteRefSpec: NodeSpec = {
  atom: true,
  selectable: true,
  parseDOM: [
    {
      tag: "sup.footnote-ref[data-fn-id]",
      getAttrs: (dom) => {
        const id = (dom as HTMLElement).getAttribute("data-fn-id");
        return id ? { id } : false;
      },
    },
  ],
  toDOM: (node) => ["sup", { class: "footnote-ref", "data-fn-id": node.attrs.id }, "[?]"],
};

const footnoteListSpec: NodeSpec = {
  defining: true,
  isolating: true,
  selectable: false,
  parseDOM: [{ tag: "section.footnote-list" }],
  toDOM: () => ["section", { class: "footnote-list" }, 0],
};

const footnoteDefSpec: NodeSpec = {
  defining: true,
  isolating: true,
  selectable: false,
  parseDOM: [
    {
      tag: "div.footnote-def[data-fn-id]",
      getAttrs: (dom) => {
        const id = (dom as HTMLElement).getAttribute("data-fn-id");
        return id ? { id } : false;
      },
    },
  ],
  toDOM: (node) => ["div", { class: "footnote-def", "data-fn-id": node.attrs.id }, 0],
};

const footnoteParagraphSpec: NodeSpec = {
  parseDOM: [{ tag: "p.footnote-para", priority: 60 }],
  toDOM: () => ["p", { class: "footnote-para" }, 0],
};

const alertSpec: NodeSpec = {
  defining: true,
  parseDOM: [
    {
      tag: "div.editor-alert[data-alert]",
      getAttrs: (dom) => {
        const kind = (dom as HTMLElement).getAttribute("data-alert");
        return kind && ALLOWED_ALERT_KINDS.has(kind) ? { kind } : false;
      },
    },
  ],
  toDOM: (node) => ["div", { class: "editor-alert", "data-alert": node.attrs.kind }, 0],
};

const highlightSpec: MarkSpec = {
  parseDOM: [
    {
      tag: "mark[data-highlight]",
      getAttrs: (dom) => {
        const color = (dom as HTMLElement).getAttribute("data-highlight");
        return color && ALLOWED_HIGHLIGHT_COLORS.has(color) ? { color } : false;
      },
    },
  ],
  toDOM: (mark) => ["mark", { "data-highlight": mark.attrs.color }, 0],
};

const baseNodes = addListNodes(
  basicSchema.spec.nodes,
  schemaSpec.nodes.list_item.content,
  schemaSpec.nodes.ordered_list.group,
)
  .append(tableNodeSpecs)
  .append({
    alert: alertSpec,
    lua_block: luaBlockSpec,
    footnote_ref: footnoteRefSpec,
    footnote_list: footnoteListSpec,
    footnote_def: footnoteDefSpec,
    footnote_paragraph: footnoteParagraphSpec,
  })
  .update("image", imageSpec);

const GAP_CURSOR_BLOCKS = new Set(["code_block", "lua_block", "blockquote", "alert", "bullet_list", "ordered_list"]);

const nodes: Record<string, NodeSpec> = {};
for (const [name, spec] of Object.entries(schemaSpec.nodes as Record<string, JsonNodeSpec>)) {
  const dom = baseNodes.get(name);
  if (!dom) throw new Error(`Missing DOM NodeSpec for ${name}`);
  nodes[name] = {
    ...dom,
    content: spec.content,
    group: spec.group,
    inline: spec.inline,
    marks: spec.marks,
    code: spec.code,
    attrs: buildAttrs(spec.attrs),
    ...(GAP_CURSOR_BLOCKS.has(name) ? { createGapCursor: true } : {}),
    ...(name === "doc" ? { allowGapCursor: true } : {}),
    ...(name === "list_item" || name === "footnote_list" || name === "footnote_def"
      ? { allowGapCursor: false }
      : {}),
  };
}

// Override the link mark's toDOM so rendered anchors carry target="_blank" and
// a safe rel. The editor opens links via handleClick (below), but the
// attributes keep the markup correct and serve as a fallback.
const linkSpec = basicSchema.spec.marks.get("link")!;
const baseMarks = basicSchema.spec.marks
  .update("link", {
    ...linkSpec,
    toDOM(mark: PmMark) {
      const { href, title } = mark.attrs;
      return ["a", { href, title, target: "_blank", rel: "noopener noreferrer" }, 0];
    },
  })
  .append({ highlight: highlightSpec });

const marks: Record<string, MarkSpec> = {};
for (const [name, spec] of Object.entries(schemaSpec.marks as Record<string, JsonMarkSpec>)) {
  const dom = baseMarks.get(name);
  if (!dom) throw new Error(`Missing DOM MarkSpec for ${name}`);
  marks[name] = {
    ...dom,
    excludes: spec.excludes,
    attrs: buildAttrs(spec.attrs),
  };
}

export const schema = new Schema({
  topNode: schemaSpec.topNode,
  nodes,
  marks,
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkRawAttrs(raw: unknown, allowed?: Record<string, JsonAttrSpec>) {
  if (raw === undefined || raw === null) return;
  if (!isPlainObject(raw)) throw new RangeError("attrs must be an object");
  for (const k of Object.keys(raw)) {
    if (!allowed || !(k in allowed)) throw new RangeError(`Unsupported attribute ${k}`);
  }
}

function checkRawNode(raw: unknown) {
  if (!isPlainObject(raw)) throw new RangeError("Node must be an object");
  if (typeof raw.type !== "string") throw new RangeError("Node missing string type");
  const spec = (schemaSpec.nodes as Record<string, JsonNodeSpec>)[raw.type];
  if (!spec) throw new RangeError(`Unknown node type ${raw.type}`);

  if (raw.marks !== undefined && raw.marks !== null) {
    if (!Array.isArray(raw.marks)) throw new RangeError("marks must be an array");
    for (const m of raw.marks) {
      if (!isPlainObject(m) || typeof m.type !== "string") throw new RangeError("Invalid mark");
      for (const k of Object.keys(m)) {
        if (k !== "type" && k !== "attrs") throw new RangeError(`Unsupported mark key ${k}`);
      }
      const mSpec = (schemaSpec.marks as Record<string, JsonMarkSpec>)[m.type];
      if (!mSpec) throw new RangeError(`Unknown mark type ${m.type}`);
      checkRawAttrs(m.attrs, mSpec.attrs);
    }
  }

  if (raw.type === "text") {
    for (const k of Object.keys(raw)) {
      if (k !== "type" && k !== "text" && k !== "marks")
        throw new RangeError(`Unsupported text node key ${k}`);
    }
    return;
  }

  for (const k of Object.keys(raw)) {
    if (k !== "type" && k !== "attrs" && k !== "content" && k !== "marks")
      throw new RangeError(`Unsupported node key ${k}`);
  }
  checkRawAttrs(raw.attrs, spec.attrs);
  if (raw.content !== undefined && raw.content !== null) {
    if (!Array.isArray(raw.content)) throw new RangeError("content must be an array");
    for (const child of raw.content) checkRawNode(child);
  }
}

/// Parses and validates a serialized description against `schema.json`,
/// matching `backend/src/schema.rs::validate_description`. Returns `null` for
/// the empty string `""`, or the validated ProseMirror `doc` node; throws on
/// any schema violation.
export function validateDescription(description: string): PmNode | null {
  if (!description) return null;
  const json: unknown = JSON.parse(description);
  checkRawNode(json);
  const doc = PmNode.fromJSON(schema, json);
  if (doc.type !== schema.topNodeType) throw new RangeError("Root node must be doc");
  if (doc.marks.length > 0) throw new RangeError("Root node cannot have marks");
  doc.check();
  return doc;
}

function selectionEnd(state: EditorState): number {
  const { from, to, $to } = state.selection;
  return $to.parentOffset === 0 && to > from ? Math.max(from, $to.before()) : to;
}

function isTextStyleActive(state: EditorState, nodeType: NodeType, attrs: Attrs | null): boolean {
  const sel = state.selection as Selection & { node?: PmNode };
  if (sel.node) return sel.node.hasMarkup(nodeType, attrs);
  if (sel instanceof GapCursor) return false;
  const { from, $from, $to } = sel;
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    return $from.parent.hasMarkup(nodeType, attrs);
  }
  const end = selectionEnd(state);
  let saw = false;
  let all = true;
  state.doc.nodesBetween(from, end, (node) => {
    if (!node.isTextblock) return true;
    saw = true;
    if (!node.hasMarkup(nodeType, attrs)) all = false;
    return false;
  });
  return saw && all;
}

function splitCodeBlockToTextblocks(
  state: EditorState,
  dispatch: ((tr: any) => void) | undefined,
  nodeType: NodeType,
  attrs: Attrs | null,
): boolean {
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return false;
  const { $from, $to } = sel;
  if (!$from.sameParent($to) || !$from.parent.type.spec.code || nodeType.spec.code) return false;
  const text = $from.parent.textContent;
  if (!text.includes("\n") || $from.depth < 1) return false;
  const parent = $from.node($from.depth - 1);
  const idx = $from.index($from.depth - 1);
  if (!parent.canReplaceWith(idx, idx + 1, nodeType)) return false;

  if (dispatch) {
    const lines = text.split("\n");
    const blockStart = $from.before();
    const blockEnd = $from.after();
    const fromOff = sel.from - $from.start();
    const toOff = sel.to - $from.start();
    const paraType = state.schema.nodes.paragraph;
    const nodes: PmNode[] = [];

    let offset = 0;
    let outPos = blockStart;
    let newFrom = blockStart + 1;
    let newTo = blockStart + 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = offset;
      const lineEnd = offset + line.length;
      const touched = fromOff <= lineEnd && toOff >= lineStart;
      const type = nodeType === paraType || touched ? nodeType : paraType;
      const node = type.create(type === nodeType ? attrs : null, line ? [state.schema.text(line)] : undefined);
      nodes.push(node);
      if (fromOff >= lineStart && fromOff <= lineEnd) newFrom = outPos + 1 + (fromOff - lineStart);
      if (toOff >= lineStart && toOff <= lineEnd) newTo = outPos + 1 + (toOff - lineStart);
      outPos += node.nodeSize;
      offset = lineEnd + 1;
    }

    const forward = sel.anchor <= sel.head;
    const tr = state.tr.replaceWith(blockStart, blockEnd, nodes);
    tr.setSelection(TextSelection.create(tr.doc, forward ? newFrom : newTo, forward ? newTo : newFrom));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function mergeSiblingBlocksToCode(
  state: EditorState,
  dispatch: ((tr: any) => void) | undefined,
  nodeType: NodeType,
  attrs: Attrs | null,
): boolean {
  if (!nodeType.spec.code) return false;
  const { from } = state.selection;
  const end = selectionEnd(state);
  if (from >= end) return false;
  const $start = state.doc.resolve(from);
  const $end = state.doc.resolve(end);
  const shared = $start.sharedDepth(end);
  const parent = $start.node(shared);
  const startIdx = $start.index(shared);
  const endIdx = $end.depth > shared ? $end.index(shared) + 1 : $end.index(shared);
  if (endIdx - startIdx < 2) return false;
  for (let i = startIdx; i < endIdx; i++) {
    if (!parent.child(i).isTextblock) return false;
  }
  if (!parent.canReplaceWith(startIdx, endIdx, nodeType)) return false;

  if (dispatch) {
    const replaceFrom = $start.posAtIndex(startIdx, shared);
    const replaceTo = $start.posAtIndex(endIdx, shared);
    const lines: string[] = [];
    for (let i = startIdx; i < endIdx; i++) lines.push(parent.child(i).textContent);
    const joined = lines.join("\n");
    const node = nodeType.create(attrs, joined ? [state.schema.text(joined)] : undefined);
    const tr = state.tr.replaceWith(replaceFrom, replaceTo, node);
    tr.setSelection(TextSelection.create(tr.doc, replaceFrom + 1, replaceFrom + 1 + joined.length));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function setTextStyle(nodeType: NodeType, attrs: Attrs | null): Command {
  const baseCmd = setBlockType(nodeType, attrs);
  return (state, dispatch, view) => {
    if (state.selection instanceof GapCursor) {
      const { $from } = state.selection;
      if (!$from.parent.canReplaceWith($from.index(), $from.index(), nodeType)) return false;
      if (dispatch) {
        const pos = $from.pos;
        const tr = state.tr.insert(pos, nodeType.create(attrs));
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    if (isTextStyleActive(state, nodeType, attrs)) return false;
    if (splitCodeBlockToTextblocks(state, dispatch, nodeType, attrs)) return true;
    if (mergeSiblingBlocksToCode(state, dispatch, nodeType, attrs)) return true;
    return baseCmd(state, dispatch, view);
  };
}

/// The text styles of the toolbar dropdown and the Accel+K menu.
export const TEXT_STYLES = [
  { label: "Plain text", short: "Plain text", node: schema.nodes.paragraph, attrs: null, key: "0" },
  { label: "Code block", short: "Code block", node: schema.nodes.code_block, attrs: null, key: "b" },
  { label: "Lua block", short: "Lua block", node: schema.nodes.lua_block, attrs: null, key: "e" },
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
  command: setTextStyle(t.node, t.attrs),
  /// Whether the selection's block already has this style.
  active(state: EditorState) {
    return isTextStyleActive(state, t.node, t.attrs);
  },
  item() {
    return new MenuItem({
      title: t.label,
      label: t.label,
      run: (state, dispatch, view) => this.command(state, dispatch, view),
      // The current style stays a (checked) choice instead of greying out.
      enable: (state: EditorState) => this.command(state) || this.active(state),
      active: (state: EditorState) => this.active(state),
    });
  },
}));

