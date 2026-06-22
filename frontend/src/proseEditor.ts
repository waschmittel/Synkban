/// ProseMirror editor setup for card descriptions. Custom schema (basic
/// nodes + lists, no images or horizontal rules) with JSON serialization,
/// and a Trello-style menu (Plain/Code/H1-H3 dropdown + inline marks +
/// custom link dialog).

import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as PmDOMParser,
  Node as PmNode,
  Mark as PmMark,
  MarkType,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes, sinkListItem, liftListItem } from "prosemirror-schema-list";
import { exampleSetup, buildMenuItems } from "prosemirror-example-setup";
import { toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { autolinkInputRules, handleAutolinkPaste } from "./autolink";
import { registerOverlay } from "./overlayLayers";
import {
  MenuItem,
  Dropdown,
  blockTypeItem,
  icons,
  undoItem,
  redoItem,
} from "prosemirror-menu";

const filteredNodes = basicSchema.spec.nodes.remove("image").remove("horizontal_rule");

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
  nodes: addListNodes(filteredNodes, "paragraph block*", "block"),
  marks,
});

/// Opens an external link in a new tab. In a normal browser this is a new tab;
/// in the Electron shell window.open routes through setWindowOpenHandler →
/// shell.openExternal (OS default browser); in an installed PWA the OS browser
/// handles it. `noopener` severs the opener reference for security.
export function openExternalLink(href: string) {
  const safe = sanitizeLinkHref(href);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer");
}

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

/// Finds the contiguous range of `markType` (a link) surrounding document
/// position `pos`, plus the mark itself, or null if `pos` isn't inside one.
/// Used to turn a click on a link into a full-link selection for editing.
function linkRangeAt(
  state: EditorState,
  pos: number,
  markType: MarkType,
): { mark: PmMark; from: number; to: number } | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  let mark =
    markType.isInSet($pos.marks()) ||
    ($pos.nodeBefore && markType.isInSet($pos.nodeBefore.marks)) ||
    ($pos.nodeAfter && markType.isInSet($pos.nodeAfter.marks)) ||
    null;
  if (!mark) return null;

  let startIndex = $pos.index();
  let endIndex = $pos.indexAfter();
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) startIndex--;
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) endIndex++;

  let from = $pos.start();
  let to = from;
  for (let i = 0; i < endIndex; i++) {
    const size = parent.child(i).nodeSize;
    if (i < startIndex) from += size;
    to += size;
  }
  return { mark, from, to };
}

interface LinkDialogOptions {
  prefillUrl: string;
  /// Apply a (sanitized) href — caller dispatches the mark change.
  apply: (href: string) => void;
  /// When set, the dialog shows a "Remove link" button wired to this.
  remove?: () => void;
}

function showLinkDialog(view: EditorView, opts: LinkDialogOptions) {
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
  input.value = opts.prefillUrl;

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

  // Remove sits on the left (margin-auto pushes Apply/Cancel right) so the
  // destructive action is visually separated from the confirm pair.
  let removeBtn: HTMLButtonElement | null = null;
  if (opts.remove) {
    removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-cancel btn-sm link-dialog-remove";
    removeBtn.textContent = "Remove link";
    actions.appendChild(removeBtn);
  }
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  dialog.appendChild(label);
  dialog.appendChild(input);
  dialog.appendChild(errorMsg);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const unregister = registerOverlay(overlay);

  requestAnimationFrame(() => {
    input.focus();
    if (opts.prefillUrl) input.select();
  });

  const close = () => { unregister(); overlay.remove(); };

  const submit = () => {
    const raw = input.value.trim();
    if (!raw) return;
    const href = sanitizeLinkHref(raw);
    if (!href) {
      errorMsg.style.display = "";
      return;
    }
    close();
    opts.apply(href);
    view.focus();
  };

  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", () => { close(); view.focus(); });
  removeBtn?.addEventListener("click", () => { close(); opts.remove!(); view.focus(); });
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
      showLinkDialog(view, {
        prefillUrl: looksLikeUrl ? trimmed : "",
        apply: (href) => toggleMark(linkType, { href })(view.state, view.dispatch),
      });
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
    plugins: [
      listKeymap,
      autolinkInputRules(schema),
      ...exampleSetup({ schema, menuBar: true, menuContent }),
    ],
  });

  const view: EditorView = new EditorView(target, {
    state,
    dispatchTransaction(tr) {
      const newState = view.state.apply(tr);
      view.updateState(newState);
      if (tr.docChanged) onChange(newState.doc);
    },
    handlePaste: handleAutolinkPaste(schema),
    // Plain click on a link opens it (the common case). Cmd/Ctrl+click instead
    // opens an edit dialog (change the URL or remove the link) — placing the
    // cursor for text editing also works by clicking just outside the link or
    // arrowing in.
    handleClick(view, pos, event) {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return false;

      if (event.metaKey || event.ctrlKey) {
        const range = linkRangeAt(view.state, pos, linkType);
        if (!range) return false;
        const { from, to } = range;
        event.preventDefault();
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
        );
        showLinkDialog(view, {
          prefillUrl: range.mark.attrs.href,
          apply: (href) =>
            view.dispatch(
              view.state.tr
                .removeMark(from, to, linkType)
                .addMark(from, to, linkType.create({ href })),
            ),
          remove: () => view.dispatch(view.state.tr.removeMark(from, to, linkType)),
        });
        return true;
      }

      const href = anchor.getAttribute("href");
      if (href) {
        event.preventDefault();
        openExternalLink(href);
        return true;
      }
      return false;
    },
    attributes: { class: "prosemirror-editor" },
  });
  return view;
}
