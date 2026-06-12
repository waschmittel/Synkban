/// ProseMirror editor setup for card descriptions. Custom schema (basic
/// nodes + lists, no images or horizontal rules) with JSON serialization,
/// and a Trello-style menu (Plain/Code/H1-H3 dropdown + inline marks +
/// custom link dialog).

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as PmDOMParser,
  Node as PmNode,
  MarkType,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes, sinkListItem, liftListItem } from "prosemirror-schema-list";
import { exampleSetup, buildMenuItems } from "prosemirror-example-setup";
import { toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import {
  MenuItem,
  Dropdown,
  blockTypeItem,
  icons,
  undoItem,
  redoItem,
} from "prosemirror-menu";

const filteredNodes = basicSchema.spec.nodes.remove("image").remove("horizontal_rule");
export const schema = new Schema({
  nodes: addListNodes(filteredNodes, "paragraph block*", "block"),
  marks: basicSchema.spec.marks,
});

export function docFromDescription(description: string): PmNode {
  if (!description) {
    return schema.node("doc", null, [schema.node("paragraph")]);
  }
  try {
    const json = JSON.parse(description);
    return PmNode.fromJSON(schema, json);
  } catch {
    const el = document.createElement("div");
    el.textContent = description;
    return PmDOMParser.fromSchema(schema).parse(el);
  }
}

export function isDocEmpty(doc: PmNode): boolean {
  return (
    doc.childCount === 0 ||
    (doc.childCount === 1 && doc.firstChild!.isTextblock && doc.firstChild!.content.size === 0)
  );
}

function markActive(state: EditorState, type: MarkType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

const ALLOWED_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];

/// Returns a normalized safe href, or null if the URL is relative or uses a
/// disallowed scheme (e.g. javascript:, data:). The URL constructor strips
/// surrounding whitespace and lowercases the protocol, so obfuscated schemes
/// like " JaVaScRiPt:" are caught too.
export function sanitizeLinkHref(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return ALLOWED_LINK_PROTOCOLS.includes(url.protocol) ? candidate : null;
}

function showLinkDialog(view: EditorView, markType: MarkType, prefillUrl: string) {
  const overlay = document.createElement("div");
  overlay.className = "link-dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "link-dialog";

  const label = document.createElement("label");
  label.className = "link-dialog-label";
  label.textContent = "URL";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "link-dialog-input";
  input.placeholder = "https://…";
  input.value = prefillUrl;

  const errorMsg = document.createElement("div");
  errorMsg.className = "link-dialog-error";
  errorMsg.style.display = "none";
  errorMsg.textContent = "Only http, https and mailto links are allowed.";

  const actions = document.createElement("div");
  actions.className = "link-dialog-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary btn-sm";
  saveBtn.textContent = "Apply";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-cancel btn-sm";
  cancelBtn.textContent = "Cancel";

  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  dialog.appendChild(label);
  dialog.appendChild(input);
  dialog.appendChild(errorMsg);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    input.focus();
    if (prefillUrl) input.select();
  });

  const close = () => overlay.remove();

  const submit = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const href = sanitizeLinkHref(raw);
    if (!href) {
      errorMsg.style.display = "";
      return;
    }
    close();
    toggleMark(markType, { href })(view.state, view.dispatch);
    view.focus();
  };

  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", () => { close(); view.focus(); });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { close(); view.focus(); }
  });
  input.addEventListener("input", () => { errorMsg.style.display = "none"; });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); close(); view.focus(); }
  });
}

/// Creates an `EditorView` bound to `target`. Transactions go through
/// `onChange` (called with the new doc — used to mark the form dirty).
export function createCardEditor(
  target: HTMLElement,
  initialDoc: PmNode,
  onChange: (doc: PmNode) => void,
): EditorView {
  const items = buildMenuItems(schema);
  const linkType = schema.marks.link;
  const customLinkItem = new MenuItem({
    title: "Add or remove link",
    icon: icons.link,
    active(state) { return markActive(state, linkType); },
    enable(state) { return !state.selection.empty; },
    run(state, dispatch, view) {
      if (markActive(state, linkType)) {
        toggleMark(linkType)(state, dispatch);
        return true;
      }
      const { from, to } = state.selection;
      const selectedText = state.doc.textBetween(from, to, " ");
      const trimmed = selectedText.trim();
      const looksLikeUrl = /^https?:\/\//.test(trimmed) || /^www\./.test(trimmed);
      showLinkDialog(view, linkType, looksLikeUrl ? trimmed : "");
    }
  });

  const inlineMenu = [[
    items.toggleStrong,
    items.toggleEm,
    items.toggleCode,
    customLinkItem,
  ].filter(Boolean) as any[]];

  const typeDropdown = new Dropdown([
    blockTypeItem(schema.nodes.paragraph, { title: "Plain text", label: "Plain" }),
    blockTypeItem(schema.nodes.code_block, { title: "Code block", label: "Code" }),
    blockTypeItem(schema.nodes.heading, { title: "Heading 1", label: "H1", attrs: { level: 1 } }),
    blockTypeItem(schema.nodes.heading, { title: "Heading 2", label: "H2", attrs: { level: 2 } }),
    blockTypeItem(schema.nodes.heading, { title: "Heading 3", label: "H3", attrs: { level: 3 } }),
  ], { label: "Type" });

  const menuContent = inlineMenu
    .concat([[typeDropdown]])
    .concat([[undoItem, redoItem]])
    .concat(items.blockMenu);

  const listItem = schema.nodes.list_item;
  const listKeymap = keymap({
    "Tab": sinkListItem(listItem),
    "Shift-Tab": liftListItem(listItem),
  });

  const state = EditorState.create({
    doc: initialDoc,
    plugins: [listKeymap, ...exampleSetup({ schema, menuBar: true, menuContent })],
  });

  const view: EditorView = new EditorView(target, {
    state,
    dispatchTransaction(tr) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
      if (tr.docChanged) onChange(newState.doc);
    },
    attributes: { class: "prosemirror-editor" },
  });
  return view;
}
