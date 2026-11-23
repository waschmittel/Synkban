/// Inline images in the description (ADR-0020): insert/remove helpers and the
/// image picker — a popup at the caret listing the card's image attachments
/// plus "Upload image…". Opened from the toolbar and the editor menu (Accel+K).
/// Same look and keys as the editor menu (↑↓ Home End Enter Esc, 1–9, U).

import { TextSelection, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { GapCursor } from "prosemirror-gapcursor";
import { api } from "./api";
import { openFloatingPopup, type FloatingPopupHandle } from "./floatingPopup";
import { menuNav, navKey } from "./menuNav";
import { schema } from "./schema";
import { ICONS, svg } from "./tableIcons";
import { tip } from "./platform";
import type { Attachment } from "./types";
import type { SearchState } from "./editorSearch";

export interface EditorHooks {
  cardId: string;
  /// The card's attachments (images are the ones offered by the picker).
  attachments: () => Attachment[];
  /// Asks for image files to upload; the result is inserted at the caret.
  uploadImage: () => void;
  /// Pasted image files: upload them as attachments, then insert.
  onPasteImages: (files: File[]) => void;
  /// An inline image was clicked.
  onImageClick: (attId: string) => void;
  /// Copies an attachment of another card onto this one (pasted reference).
  copyAttachment: (fromCard: string, attId: string) => Promise<Attachment | undefined>;
  /// Fires whenever the description's Find & Replace plugin state changes.
  onSearchStateChange?: (state: SearchState) => void;
  /// Toolbar Find button clicked.
  onOpenSearch?: () => void;
}

const hooksByView = new WeakMap<EditorView, EditorHooks>();
export const registerHooks = (view: EditorView, h: EditorHooks) => hooksByView.set(view, h);
export const hooksOf = (view: EditorView) => hooksByView.get(view);

/// Whether an image can be inserted at the selection (not in a code block).
export function canInsertImage(state: EditorState): boolean {
  const { $from } = state.selection;
  return (!$from.parent.type.spec.code && $from.parent.inlineContent) || state.selection instanceof GapCursor;
}

/// Inserts an inline reference to image attachment `att` at the selection.
export function insertImage(view: EditorView, att: Attachment) {
  if (!canInsertImage(view.state)) return;
  const node = schema.nodes.image.create({ att: att.id, alt: att.filename });
  if (view.state.selection instanceof GapCursor) {
    const pos = view.state.selection.head;
    const tr = view.state.tr.insert(pos, schema.nodes.paragraph.create(null, [node]));
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    view.dispatch(tr.scrollIntoView());
  } else {
    view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
  }
  view.focus();
}

/// Removes every reference to attachment `attId` (it was deleted).
export function removeImages(view: EditorView, attId: string) {
  const tr = view.state.tr;
  const hits: number[] = [];
  view.state.doc.descendants((n, pos) => {
    if (n.type === schema.nodes.image && n.attrs.att === attId) hits.push(pos);
  });
  for (const pos of hits.reverse()) tr.delete(pos, pos + 1);
  if (hits.length) view.dispatch(tr);
}

let close: (() => void) | null = null;

/// Opens the picker for `view`, or closes it if it is already open.
export function openImagePicker(view: EditorView): void {
  if (close) {
    close();
    return;
  }
  const hooks = hooksOf(view);
  if (!hooks) return;

  const menu = document.createElement("div");
  menu.className = "table-menu image-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Insert image");
  const nav = menuNav(menu);

  const choose = (att: Attachment) => {
    dispose();
    insertImage(view, att);
  };
  const upload = () => {
    dispose();
    hooks.uploadImage();
  };

  const button = (label: string, hint: string, onClick: () => void, lead: HTMLElement) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "table-menu-item";
    btn.setAttribute("role", "menuitem");
    btn.title = tip(label, hint);
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret
    btn.addEventListener("click", onClick);
    const text = document.createElement("span");
    text.className = "table-menu-label";
    text.textContent = label;
    const kbd = document.createElement("kbd");
    kbd.textContent = hint;
    btn.append(lead, text);
    if (hint) btn.append(kbd);
    menu.appendChild(btn);
  };

  const images = hooks.attachments().filter((a) => a.content_type.startsWith("image/"));
  images.forEach((att, i) => {
    const img = document.createElement("img");
    img.className = "image-menu-thumb";
    img.alt = "";
    img.src = api.getAttachmentThumbUrl(hooks.cardId, att.id);
    img.addEventListener("error", () => (img.src = api.getAttachmentUrl(hooks.cardId, att.id)), {
      once: true,
    });
    button(att.filename, i < 9 ? String(i + 1) : "", () => choose(att), img);
  });
  if (images.length) {
    const sep = document.createElement("div");
    sep.className = "table-menu-sep";
    sep.setAttribute("role", "separator");
    menu.appendChild(sep);
  }
  const icon = document.createElement("span");
  icon.className = "table-menu-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = svg(ICONS.image); // static markup from tableIcons.ts
  button("Upload image…", "U", upload, icon);
  const foot = document.createElement("div");
  foot.className = "table-menu-foot";
  foot.textContent = "↑↓ Enter to choose · Esc to close";
  menu.appendChild(foot);

  let popup: FloatingPopupHandle | null = null;
  function dispose() {
    popup?.dispose();
  }
  close = dispose;

  popup = openFloatingPopup({
    el: menu,
    container: view.dom.parentElement ?? document.body,
    anchor: () => view.coordsAtPos(view.state.selection.head),
    ignoreOutside: (t) => !!t?.closest(".image-menu-trigger"),
    onKey(e) {
      if (!view.dom.isConnected) return dispose();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return dispose();
      if (e.key === "Enter") return void (nav.activate() || dispose());
      if (navKey(nav, e)) return;
      if (e.key.toLowerCase() === "u") return upload();
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
      if (images[n]) choose(images[n]);
    },
    onClose() {
      popup = null;
      if (close === dispose) close = null;
      view.focus();
    },
  });
  nav.edge(false);
}
