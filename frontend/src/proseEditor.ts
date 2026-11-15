/// ProseMirror editor setup for card descriptions. Custom schema (basic
/// nodes + lists + inline attachment images, no horizontal rules) with JSON serialization,
/// and a Trello-style menu (text-style dropdown + inline marks + custom link
/// dialog).

import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  DOMParser as PmDOMParser,
  DOMSerializer,
  Node as PmNode,
} from "prosemirror-model";
import { sinkListItem, liftListItem } from "prosemirror-schema-list";
import { exampleSetup, buildMenuItems } from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import { autolinkInputRules, handleAutolinkPaste } from "./autolink";
import { tablePlugins } from "./tables";
import { schema, TEXT_STYLES } from "./schema";
import { api } from "./api";
import { pastedImageFiles } from "./pasteImages";
import { resolvePastedImages } from "./pastedRefs";
import {
  canInsertImage,
  hooksOf,
  insertImage,
  openImagePicker,
  registerHooks,
  removeImages,
  type EditorHooks,
} from "./imagePicker";
export { schema, insertImage, removeImages };
export type { EditorHooks };
import { openEditorMenu } from "./editorMenu";
import {
  linkRangeAt,
  linkTarget,
  markActive,
  openLinkEditor,
  sanitizeLinkHref,
} from "./links";
import { ICONS, TABLE_ICON, svg } from "./tableIcons";
import { accel, isMac, tip } from "./platform";
import {
  MenuItem,
  Dropdown,
  blockTypeItem,
  icons,
  undoItem,
  redoItem,
} from "prosemirror-menu";

/// Opens an external link in a new tab. In a normal browser this is a new tab;
/// in the Electron shell window.open routes through setWindowOpenHandler →
/// shell.openExternal (OS default browser); in an installed PWA the OS browser
/// handles it. `noopener` severs the opener reference for security.
export { sanitizeLinkHref };
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


/// The toolbar button's icon (prosemirror-menu clones the node it is given).
function tableIconDom(): HTMLElement {
  const span = document.createElement("span");
  span.innerHTML = svg(TABLE_ICON, 16); // static markup from tableIcons.ts
  return span;
}

function imageIconDom(): HTMLElement {
  const span = document.createElement("span");
  span.innerHTML = svg(ICONS.image, 16); // static markup from tableIcons.ts
  return span;
}

/// Copies carry the source card (`data-att="<card>/<attachment>"`) so a paste
/// into another card can copy the attachment too (`resolvePastedImages`).
const clipboardSerializer = (cardId: string) =>
  new DOMSerializer(
    {
      ...DOMSerializer.nodesFromSchema(schema),
      image: (node) => ["img", { "data-att": `${cardId}/${node.attrs.att}`, alt: node.attrs.alt }],
    },
    DOMSerializer.marksFromSchema(schema),
  );

/// Dropdown whose button shows the current text style and which disables
/// itself entirely when the style can't be changed (e.g. in a table cell).
class TypeDropdown extends Dropdown {
  constructor(items: MenuItem[]) {
    super(items, { label: "Text style", title: "Text style", class: "type-dropdown" });
  }
  render(view: EditorView) {
    const r = super.render(view);
    const btn = r.focusable as HTMLButtonElement;
    const update = r.update;
    r.update = (state: EditorState) => {
      update(state);
      btn.textContent = TEXT_STYLES.find((t) => t.active(state))?.label ?? "Text style";
      const changeable = TEXT_STYLES.some((t) => t.command(state));
      btn.disabled = !changeable;
      btn.title = changeable ? "Text style" : "Text style can't be changed here";
      return true;
    };
    return r;
  }
}

/// Creates an `EditorView` bound to `target`. Transactions go through
/// `onChange` (called with the new doc — used to mark the form dirty).
/// Stands in for an image whose attachment is gone (broken data, manual edit).
const MISSING_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="40"><rect x=".5" y=".5" width="95" height="39" rx="4" fill="#f3f4f6" stroke="#9ca3af" stroke-dasharray="4"/><text x="48" y="24" font-family="sans-serif" font-size="11" fill="#6b7280" text-anchor="middle">image missing</text></svg>',
  );

export function createCardEditor(
  target: HTMLElement,
  initialDoc: PmNode,
  onChange: (doc: PmNode) => void,
  hooks: EditorHooks,
): EditorView {
  const items = buildMenuItems(schema);
  const linkType = schema.marks.link;
  const customLinkItem = new MenuItem({
    title: "Add or edit link",
    icon: icons.link,
    active(state) { return markActive(state, linkType); },
    enable(state) { return !!linkTarget(state, linkType); },
    run(_state, _dispatch, view) { return openLinkEditor(view, linkType); },
  });

  const imageItem = new MenuItem({
    title: "Insert image",
    icon: { dom: imageIconDom() },
    class: "image-menu-trigger",
    enable: (state) => canInsertImage(state),
    run(_state, _dispatch, view) {
      openImagePicker(view);
      return true;
    },
  });

  const inlineMenu = [[
    items.toggleStrong,
    items.toggleEm,
    items.toggleCode,
    customLinkItem,
    imageItem,
  ].filter(Boolean) as any[]];

  const typeDropdown = new TypeDropdown(TEXT_STYLES.map((t) => t.item()));

  const tableItem = new MenuItem({
    title: tip("Table", accel("K")),
    icon: { dom: tableIconDom() },
    class: "table-menu-trigger",
    run(_state, _dispatch, view) {
      openEditorMenu(view);
      return true;
    },
  });

  const menuContent = inlineMenu
    .concat([[typeDropdown]])
    .concat([[tableItem]])
    .concat([[undoItem, redoItem]])
    .concat(items.blockMenu);

  const listItem = schema.nodes.list_item;
  // In a list Tab/Shift+Tab always belong to the editor: an item that can't
  // move (the first one has nothing to nest under) is a no-op, not a focus
  // jump out of the description. Outside lists and tables Tab moves on.
  const inList = (state: EditorState) => {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === listItem) return true;
    return false;
  };
  const listKeymap = keymap({
    "Tab": (state, dispatch) => inList(state) && (sinkListItem(listItem)(state, dispatch), true),
    "Shift-Tab": (state, dispatch) => inList(state) && (liftListItem(listItem)(state, dispatch), true),
  });
  // Opens the context menu (link, text style, table).
  const tableMenuKeymap = keymap({
    "Mod-k": (_state, _dispatch, view) => {
      if (!view) return false;
      openEditorMenu(view);
      return true;
    },
    // Escape belongs to the card (close the modal, leave the Notes pane), not
    // to the base keymap's "select parent node": that selection outlived the
    // Escape and the next keystroke replaced the whole block.
    "Escape": () => true,
  });

  const autolinkPaste = handleAutolinkPaste(schema);
  const state = EditorState.create({
    doc: initialDoc,
    plugins: [
      tableMenuKeymap,
      ...tablePlugins(),
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
    clipboardSerializer: clipboardSerializer(hooks.cardId),
    handlePaste(view, event, slice) {
      // Image without text (screenshot, "copy image"): attach + reference here.
      const files = pastedImageFiles(event.clipboardData);
      if (files.length) {
        hooks.onPasteImages(files);
        return true;
      }
      // Pasted references must point at this card's attachments: copy the
      // attachments of other cards over, drop the ones that don't exist.
      let hasImage = false;
      slice.content.descendants((n) => void (hasImage ||= n.type === schema.nodes.image));
      if (hasImage) {
        resolvePastedImages(slice, hooks.cardId, new Set(hooks.attachments().map((a) => a.id)), async (from, id) =>
          (await hooks.copyAttachment(from, id))?.id,
        ).then((resolved) => view.dispatch(view.state.tr.replaceSelection(resolved).scrollIntoView()));
        return true;
      }
      return autolinkPaste(view, event);
    },
    nodeViews: {
      image(node) {
        const img = document.createElement("img");
        img.className = "editor-image";
        img.alt = node.attrs.alt;
        img.title = node.attrs.alt;
        img.src = api.getAttachmentThumbUrl(hooks.cardId, node.attrs.att);
        // No thumbnail (GIF…): try the original once; then show that it is gone.
        img.addEventListener(
          "error",
          () => {
            img.addEventListener(
              "error",
              () => {
                img.classList.add("editor-image--missing");
                img.title = `${node.attrs.alt} (attachment missing)`;
                img.src = MISSING_IMAGE;
              },
              { once: true },
            );
            img.src = api.getAttachmentUrl(hooks.cardId, node.attrs.att);
          },
          { once: true },
        );
        return { dom: img };
      },
    },
    handleClickOn(_view, _pos, node, _nodePos, event, direct) {
      if (direct && node.type === schema.nodes.image && event.button === 0) {
        if (!(event.target as HTMLElement).classList.contains("editor-image--missing")) {
          hooks.onImageClick(node.attrs.att);
        }
      }
      return false; // still selects the node
    },
    // Plain click on a link opens it (the common case). Cmd/Ctrl+click instead
    // opens an edit dialog (change the URL or remove the link) — placing the
    // cursor for text editing also works by clicking just outside the link or
    // arrowing in.
    handleClick(view, pos, event) {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      // Only the primary button acts on a link: ProseMirror also reports the
      // mouseup of a right-click here, which must leave opening to the menu.
      if (!anchor || event.button !== 0) return false;

      // Accel+click edits. On macOS Ctrl+click is a right-click (context menu).
      if (isMac ? event.metaKey : event.ctrlKey) {
        const range = linkRangeAt(view.state, pos, linkType);
        if (!range) return false;
        event.preventDefault();
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)),
        );
        return openLinkEditor(view, linkType);
      }

      const href = anchor.getAttribute("href");
      if (href) {
        event.preventDefault();
        openExternalLink(href);
        return true;
      }
      return false;
    },
    handleDOMEvents: {
      // Right-click = Accel+K at the pointer. The caret moves there first
      // (like a native right-click) unless it lands inside the selection.
      contextmenu(view, event) {
        const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!hit) return false;
        event.preventDefault();
        const { from, to, empty } = view.state.selection;
        if (empty || hit.pos < from || hit.pos > to) {
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))),
          );
        }
        view.focus();
        openEditorMenu(view, { at: { x: event.clientX, y: event.clientY } });
        return true;
      },
    },
    attributes: { class: "prosemirror-editor" },
  });
  registerHooks(view, hooks);
  return view;
}
