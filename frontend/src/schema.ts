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
} from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { setBlockType } from "prosemirror-commands";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { blockTypeItem } from "prosemirror-menu";
import { tableNodeSpecs } from "./tables";
import { isValidLinkHref } from "./links";
import schemaSpec from "./schema.json";

export { schemaSpec };

const ALLOWED_ALIGNMENTS: ReadonlySet<string> = new Set(schemaSpec.allowedAlignments);

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

const baseNodes = addListNodes(
  basicSchema.spec.nodes,
  schemaSpec.nodes.list_item.content,
  schemaSpec.nodes.ordered_list.group,
)
  .append(tableNodeSpecs)
  .update("image", imageSpec);

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
  };
}

// Override the link mark's toDOM so rendered anchors carry target="_blank" and
// a safe rel. The editor opens links via handleClick (below), but the
// attributes keep the markup correct and serve as a fallback.
const linkSpec = basicSchema.spec.marks.get("link")!;
const baseMarks = basicSchema.spec.marks.update("link", {
  ...linkSpec,
  toDOM(mark: PmMark) {
    const { href, title } = mark.attrs;
    return ["a", { href, title, target: "_blank", rel: "noopener noreferrer" }, 0];
  },
});

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

