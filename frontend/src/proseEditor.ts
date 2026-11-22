/// ProseMirror editor setup for card descriptions. Custom schema (basic
/// nodes + lists + inline attachment images, no horizontal rules) with JSON serialization,
/// and a Trello-style menu (text-style dropdown + inline marks + custom link
/// dialog).

import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { GapCursor } from "prosemirror-gapcursor";
import {
  DOMParser as PmDOMParser,
  DOMSerializer,
  Node as PmNode,
} from "prosemirror-model";
import { wrapIn } from "prosemirror-commands";
import { sinkListItem, liftListItem, wrapInList } from "prosemirror-schema-list";
import { exampleSetup, buildMenuItems } from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import { autolinkInputRules, handleAutolinkPaste } from "./autolink";
import { blockEscapeKeymap, gapPosAtY } from "./blockEscape";
import {
  canInsertFootnote,
  createFootnoteDefView,
  createFootnoteRefView,
  footnotePlugins,
  insertFootnote,
} from "./footnotes";
import { createLuaBlockView, luaPlugins } from "./luaBlock";
import { canInsertAlert, createAlertView, openAlertPicker } from "./alerts";
import {
  canHighlight,
  getLastHighlightColor,
  hasAnyHighlight,
  highlightLabel,
  openHighlightSwatchPopover,
  toggleDefaultHighlight,
} from "./highlights";
import { insertMatrix, insertTable, tablePlugins } from "./tables";
import { schema, TEXT_STYLES, validateDescription } from "./schema";
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
export { schema, validateDescription, insertImage, removeImages };
export type { EditorHooks };
import { openEditorMenu } from "./editorMenu";
import {
  linkRangeAt,
  linkTarget,
  markActive,
  openLinkEditor,
  sanitizeLinkHref,
} from "./links";
import { ICONS, MATRIX_ICON, TABLE_ICON, svg } from "./tableIcons";
import { accel, isMac, tip } from "./platform";
import { editorSearchPlugin, getSearchState, openSearch } from "./editorSearch";
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
    return validateDescription(description)!;
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


/// Toolbar icon wrapper (prosemirror-menu clones the node it is given).
function iconDom(markup: string): HTMLElement {
  const span = document.createElement("span");
  span.innerHTML = svg(markup, 16); // static markup from tableIcons.ts
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

/// Renders an Insert-dropdown item with both icon and text label.
function insertDropdownItem(opts: {
  label: string;
  title: string;
  icon: string;
  className: string;
  enable?: (state: EditorState) => boolean;
  run: Command;
}): MenuItem<HTMLButtonElement> {
  return new MenuItem({
    label: opts.label,
    title: opts.title,
    class: opts.className,
    enable: opts.enable,
    run: opts.run,
    render() {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `insert-menu-item ${opts.className}`;
      el.title = opts.title;
      el.innerHTML =
        `<span class="insert-menu-icon">${svg(opts.icon, 15)}</span>` +
        `<span class="insert-menu-label">${opts.label}</span>`;
      return el;
    },
  });
}

class InsertDropdown extends Dropdown {
  constructor(items: readonly MenuItem<any>[]) {
    super(items, { label: "Insert", title: "Insert", class: "insert-dropdown" });
  }
  render(view: EditorView) {
    const r = super.render(view);
    const btn = r.focusable as HTMLButtonElement;
    // Render as a "+ Insert" menu trigger rather than a plain text select box.
    btn.innerHTML =
      `<span class="insert-trigger-icon" aria-hidden="true">${svg(ICONS.plus, 14)}</span>` +
      `<span>Insert</span>`;
    // prosemirror-menu's 100ms `isMenuEvent` window skips auto-closing when an
    // item is clicked immediately after opening; close it explicitly on item click.
    // Check disabled state in capture phase before MenuItem's handler runs the command
    // (which may immediately disable the item, e.g. inserting a table).
    let closeAfterClick = false;
    r.dom.addEventListener(
      "click",
      (e) => {
        const item = (e.target as HTMLElement | null)?.closest(".insert-menu-item");
        closeAfterClick = !!(item && !item.classList.contains("ProseMirror-menu-disabled"));
      },
      true,
    );
    r.dom.addEventListener("click", () => {
      if (!closeAfterClick) return;
      closeAfterClick = false;
      queueMicrotask(() => {
        if (r.dom.querySelector(".ProseMirror-menu-dropdown-menu")) btn.click();
      });
    });
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

  const highlightSplitItem = {
    render(view: EditorView) {
      const wrap = document.createElement("div");
      wrap.className = "highlight-split-btn";

      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "ProseMirror-icon highlight-split-action";
      actionBtn.setAttribute("aria-label", "Highlight");
      actionBtn.innerHTML =
        `<span class="highlight-trigger-stack">` +
        `${svg(ICONS.highlight, 15)}` +
        `<span class="highlight-trigger-bar" aria-hidden="true"></span>` +
        `</span>`;
      const bar = actionBtn.querySelector<HTMLElement>(".highlight-trigger-bar")!;

      const chevronBtn = document.createElement("button");
      chevronBtn.type = "button";
      chevronBtn.className = "ProseMirror-icon highlight-split-chevron";
      chevronBtn.title = "Choose highlight color";
      chevronBtn.setAttribute("aria-label", "Choose highlight color");
      chevronBtn.setAttribute("aria-haspopup", "menu");
      chevronBtn.innerHTML = svg('<path d="m6 9 6 6 6-6"/>', 11);

      actionBtn.addEventListener("mousedown", (e) => e.preventDefault());
      actionBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toggleDefaultHighlight(view.state, view.dispatch, view);
        view.focus();
      });

      chevronBtn.addEventListener("mousedown", (e) => e.preventDefault());
      chevronBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const r = wrap.getBoundingClientRect();
        openHighlightSwatchPopover(view, { at: { x: r.left, y: r.bottom } });
      });

      wrap.append(actionBtn, chevronBtn);

      const update = (state: EditorState) => {
        const enabled = canHighlight(state);
        const active = hasAnyHighlight(state);
        const last = getLastHighlightColor();
        bar.dataset.highlight = last;
        actionBtn.disabled = !enabled;
        chevronBtn.disabled = !enabled;
        actionBtn.classList.toggle("ProseMirror-menu-disabled", !enabled);
        chevronBtn.classList.toggle("ProseMirror-menu-disabled", !enabled);
        actionBtn.classList.toggle("ProseMirror-menu-active", active);
        actionBtn.title = active ? "Remove highlight" : `Highlight (${highlightLabel(last)})`;
        return true;
      };
      update(view.state);
      return { dom: wrap, update };
    },
  };

  const inlineMenu = [[
    items.toggleStrong,
    items.toggleEm,
    items.toggleCode,
    highlightSplitItem,
    customLinkItem,
  ].filter(Boolean) as any[]];

  const typeDropdown = new TypeDropdown(TEXT_STYLES.map((t) => t.item()));

  const bulletListCmd = wrapInList(schema.nodes.bullet_list);
  const orderedListCmd = wrapInList(schema.nodes.ordered_list);
  const blockquoteCmd = wrapIn(schema.nodes.blockquote);

  const insertDropdown = new InsertDropdown([
    insertDropdownItem({
      label: "Footnote",
      title: "Insert footnote",
      icon: ICONS.footnote,
      className: "insert-footnote-btn",
      enable: canInsertFootnote,
      run: insertFootnote,
    }),
    insertDropdownItem({
      label: "Image",
      title: "Insert image",
      icon: ICONS.image,
      className: "image-menu-trigger",
      enable: canInsertImage,
      run(_state, _dispatch, view) {
        if (view) setTimeout(() => openImagePicker(view), 0);
        return true;
      },
    }),
    insertDropdownItem({
      label: "Table",
      title: "Insert table",
      icon: TABLE_ICON,
      className: "insert-table-btn",
      enable: (state) => insertTable(state),
      run: insertTable,
    }),
    insertDropdownItem({
      label: "Matrix",
      title: "Insert matrix",
      icon: MATRIX_ICON,
      className: "insert-matrix-btn",
      enable: (state) => insertMatrix(state),
      run: insertMatrix,
    }),
    insertDropdownItem({
      label: "Bullet list",
      title: "Bullet list",
      icon: ICONS.bulletList,
      className: "insert-bullet-list-btn",
      enable: (state) => bulletListCmd(state),
      run: bulletListCmd,
    }),
    insertDropdownItem({
      label: "Ordered list",
      title: "Ordered list",
      icon: ICONS.orderedList,
      className: "insert-ordered-list-btn",
      enable: (state) => orderedListCmd(state),
      run: orderedListCmd,
    }),
    insertDropdownItem({
      label: "Blockquote",
      title: "Blockquote",
      icon: ICONS.blockquote,
      className: "insert-blockquote-btn",
      enable: (state) => blockquoteCmd(state),
      run: blockquoteCmd,
    }),
    insertDropdownItem({
      label: "Alert",
      title: "Insert or change alert",
      icon: ICONS.alert,
      className: "insert-alert-btn",
      enable: (state) => canInsertAlert(state),
      run(_state, _dispatch, view) {
        if (view) setTimeout(() => openAlertPicker(view), 0);
        return true;
      },
    }),
  ]);

  const searchItem = new MenuItem({
    title: tip("Find in description", accel("F")),
    icon: { dom: iconDom(ICONS.search) },
    class: "editor-find-btn",
    active: (state) => getSearchState(state).open,
    run(_state, _dispatch, view) {
      if (hooks.onOpenSearch) hooks.onOpenSearch();
      else openSearch(view);
      return true;
    },
  });

  const menuContent = inlineMenu
    .concat([[typeDropdown]])
    .concat([[insertDropdown]])
    .concat([[undoItem, redoItem]])
    .concat([[searchItem]]);

  const listItem = schema.nodes.list_item;
  // In a list Tab/Shift+Tab always belong to the editor: an item that can't
  // move (the first one has nothing to nest under) is a no-op, not a focus
  // jump out of the description. Outside lists, tables and code blocks Tab moves on.
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
      editorSearchPlugin(hooks.onSearchStateChange),
      ...footnotePlugins(),
      ...luaPlugins(),
      tableMenuKeymap,
      ...tablePlugins(),
      blockEscapeKeymap,
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
      alert: createAlertView,
      lua_block: createLuaBlockView,
      footnote_ref: createFootnoteRefView,
      footnote_def: createFootnoteDefView,
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
      // Clicking the editor padding above, between or below non-paragraph
      // blocks places a gap cursor there instead of snapping back inside.
      mousedown(view, event) {
        if (
          event.button !== 0 ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          event.target !== view.dom
        ) {
          return false;
        }
        const gap = gapPosAtY(view, event.clientY);
        if (gap === null) return false;
        event.preventDefault();
        view.focus();
        view.dispatch(view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(gap))));
        return true;
      },
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
