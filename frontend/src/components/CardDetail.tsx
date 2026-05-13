import { onMount, onCleanup, createSignal, Show, For } from "solid-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as PmDOMParser,
  Node as PmNode,
  MarkType,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { exampleSetup, buildMenuItems } from "prosemirror-example-setup";
import { toggleMark } from "prosemirror-commands";
import { MenuItem, icons, undoItem, redoItem } from "prosemirror-menu";
import type { Attachment, Card, Label } from "../types";
import { renderTitle } from "./Card";
import { api } from "../api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

const filteredNodes = basicSchema.spec.nodes.remove("image").remove("horizontal_rule");
const schema = new Schema({
  nodes: addListNodes(filteredNodes, "paragraph block*", "block"),
  marks: basicSchema.spec.marks,
});

function docFromDescription(description: string): PmNode {
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

function isDocEmpty(doc: PmNode): boolean {
  return doc.childCount === 0 || (doc.childCount === 1 && doc.firstChild!.isTextblock && doc.firstChild!.content.size === 0);
}

function wrapSelection(input: HTMLInputElement, marker: string) {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  const val = input.value;
  const sel = val.slice(start, end);
  if (!sel) return;
  const mlen = marker.length;
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length > mlen * 2) {
    const unwrapped = sel.slice(mlen, -mlen);
    input.value = val.slice(0, start) + unwrapped + val.slice(end);
    input.setSelectionRange(start, start + unwrapped.length);
  } else {
    const wrapped = marker + sel + marker;
    input.value = val.slice(0, start) + wrapped + val.slice(end);
    input.setSelectionRange(start + mlen, start + mlen + sel.length);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function markActive(state: EditorState, type: MarkType) {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
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
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    input.focus();
    if (prefillUrl) input.select();
  });

  const close = () => {
    overlay.remove();
  };

  const submit = () => {
    const href = input.value.trim();
    if (!href) return;
    close();
    toggleMark(markType, { href })(view.state, view.dispatch);
    view.focus();
  };

  saveBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", () => { close(); view.focus(); });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { close(); view.focus(); }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); close(); view.focus(); }
  });
}

interface Props {
  card: Card;
  boardLabels: Label[];
  onSave: (id: string, title: string, description: string, labelIds: string[]) => void;
  onClose: () => void;
}

export default function CardDetail(props: Props) {
  let editorRef!: HTMLDivElement;
  let view: EditorView | undefined;
  const [title, setTitle] = createSignal(props.card.title);
  const [selectedLabelIds, setSelectedLabelIds] = createSignal<string[]>(
    props.card.label_ids ?? []
  );
  const [dirty, setDirty] = createSignal(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = createSignal(false);
  const [showLabelPicker, setShowLabelPicker] = createSignal(false);
  const [attachments, setAttachments] = createSignal<Attachment[]>(props.card.attachments ?? []);
  const [uploading, setUploading] = createSignal(false);
  const [previewAtt, setPreviewAtt] = createSignal<Attachment | null>(null);

  onMount(() => {
    const doc = docFromDescription(props.card.description);

    const menuItems = buildMenuItems(schema);
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
      menuItems.toggleStrong,
      menuItems.toggleEm,
      menuItems.toggleCode,
      customLinkItem,
    ].filter(Boolean) as any[]];

    const menuContent = inlineMenu
      .concat([[menuItems.typeMenu]])
      .concat([[undoItem, redoItem]])
      .concat(menuItems.blockMenu);

    const state = EditorState.create({
      doc,
      plugins: exampleSetup({ schema, menuBar: true, menuContent }),
    });
    view = new EditorView(editorRef, {
      state,
      dispatchTransaction(tr) {
        const newState = view!.state.apply(tr);
        view!.updateState(newState);
        if (tr.docChanged) setDirty(true);
      },
      attributes: { class: "prosemirror-editor" },
    });
  });

  onCleanup(() => {
    view?.destroy();
  });

  const toggleLabel = (labelId: string) => {
    setSelectedLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId]
    );
    setDirty(true);
  };

  const handleFileUpload = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    setUploading(true);
    try {
      const att = await api.uploadAttachment(props.card.id, file);
      setAttachments((prev) => [...prev, att]);
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAttachment = async (attId: string) => {
    await api.deleteAttachment(props.card.id, attId);
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const handleSave = () => {
    if (!view) return;
    const doc = view.state.doc;
    const description = isDocEmpty(doc) ? "" : JSON.stringify(doc.toJSON());
    setDirty(false);
    props.onSave(props.card.id, title(), description, selectedLabelIds());
  };

  const guardedClose = () => {
    if (dirty()) {
      setShowUnsavedDialog(true);
      return;
    }
    props.onClose();
  };

  const handleDialogKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const active = document.activeElement as HTMLElement;
      if (active?.tagName === "BUTTON" && active.closest(".unsaved-dialog")) {
        active.click();
      } else {
        handleSave();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setShowUnsavedDialog(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (previewAtt()) {
        setPreviewAtt(null);
        e.stopPropagation();
        return;
      }
      guardedClose();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSave();
    }
  };

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      view?.focus();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "b") {
        e.preventDefault();
        wrapSelection(e.currentTarget as HTMLInputElement, "**");
      } else if (e.key === "i") {
        e.preventDefault();
        wrapSelection(e.currentTarget as HTMLInputElement, "*");
      }
    }
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      guardedClose();
    }
  };

  const assignedLabels = () =>
    props.boardLabels.filter((l) => selectedLabelIds().includes(l.id));

  const hasLabels = () => props.boardLabels.length > 0;

  return (
    <div class="modal-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown}>
      <div class="modal-content">
        <div class="modal-header">
          <div class="modal-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
          </div>
          <input
            ref={(el) => requestAnimationFrame(() => el.focus())}
            class="modal-title-input"
            type="text"
            value={title()}
            onInput={(e) => { setTitle(e.currentTarget.value); setDirty(true); }}
            onKeyDown={handleTitleKeyDown}
            placeholder="Card title..."
          />
          <button class="modal-close" onClick={guardedClose} title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <Show when={hasLabels()}>
            <div class="modal-section-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
              <span class="modal-label">Labels</span>
            </div>
            <div class="label-assigned-area">
              <div class="label-assigned-chips">
                <For each={assignedLabels()}>
                  {(label) => (
                    <span
                      class="label-assigned-chip"
                      style={{ "background-color": label.color }}
                      title={`Remove "${label.name}"`}
                      onClick={() => toggleLabel(label.id)}
                      innerHTML={renderTitle(label.name)}
                    />
                  )}
                </For>
                <button
                  class="label-add-btn"
                  onClick={() => setShowLabelPicker((v) => !v)}
                  title={showLabelPicker() ? "Hide label picker" : "Add/remove labels"}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {showLabelPicker() ? "Done" : "Add label"}
                </button>
              </div>
              <Show when={showLabelPicker()}>
                <div class="label-picker">
                  <For each={props.boardLabels}>
                    {(label) => {
                      const selected = () => selectedLabelIds().includes(label.id);
                      return (
                        <button
                          class="label-picker-item"
                          classList={{ "label-picker-item--selected": selected() }}
                          style={{ "--label-color": label.color }}
                          onClick={() => toggleLabel(label.id)}
                          title={selected() ? `Remove "${label.name}"` : `Add "${label.name}"`}
                        >
                          <span class="label-picker-dot" style={{ "background-color": label.color }} />
                          <span class="label-picker-name" innerHTML={renderTitle(label.name)} />
                          <Show when={selected()}>
                            <svg class="label-picker-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
          <div class="modal-section-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="17" y1="10" x2="3" y2="10" />
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" />
              <line x1="17" y1="18" x2="3" y2="18" />
            </svg>
            <span class="modal-label">Description</span>
          </div>
          <div class="editor-wrapper" ref={editorRef!} />
          <div class="editor-hint">
            <kbd>Ctrl</kbd>+<kbd>B</kbd> bold &middot; <kbd>Ctrl</kbd>+<kbd>I</kbd> italic &middot; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save (title and description)
          </div>
          <div class="modal-section-header" style={{ "margin-top": "16px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span class="modal-label">Attachments</span>
          </div>
          <div class="attachments-list">
            <For each={attachments()}>
              {(att) => (
                <div class="attachment-item" classList={{ "attachment-item--image": isImageType(att.content_type) }}>
                  <Show when={isImageType(att.content_type)}>
                    <img
                      class="attachment-thumb"
                      src={api.getAttachmentUrl(props.card.id, att.id)}
                      alt={att.filename}
                      onClick={() => setPreviewAtt(att)}
                    />
                  </Show>
                  <div class="attachment-info">
                    <Show when={isImageType(att.content_type)} fallback={
                      <a
                        class="attachment-filename"
                        href={api.getAttachmentUrl(props.card.id, att.id)}
                        download={att.filename}
                        title={att.filename}
                      >
                        {att.filename}
                      </a>
                    }>
                      <span
                        class="attachment-filename attachment-filename--clickable"
                        title={att.filename}
                        onClick={() => setPreviewAtt(att)}
                      >
                        {att.filename}
                      </span>
                    </Show>
                    <span class="attachment-size">{formatSize(att.size)}</span>
                  </div>
                  <button
                    class="attachment-delete"
                    title="Remove attachment"
                    onClick={() => handleDeleteAttachment(att.id)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </For>
          </div>
          <label class="attachment-upload" classList={{ "attachment-upload--busy": uploading() }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            {uploading() ? "Uploading…" : "Add attachment"}
            <input
              type="file"
              style={{ display: "none" }}
              onChange={handleFileUpload}
              disabled={uploading()}
            />
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onClick={handleSave}>
            Save
          </button>
          <button class="btn btn-cancel" onClick={guardedClose}>
            Cancel
          </button>
          {dirty() && <span class="unsaved-indicator">Unsaved changes</span>}
        </div>
      </div>
      <Show when={showUnsavedDialog()}>
        <div class="unsaved-overlay" onKeyDown={handleDialogKeyDown}>
          <div class="unsaved-dialog">
            <p>You have unsaved changes.</p>
            <div class="unsaved-dialog-actions">
              <button
                ref={(el) => requestAnimationFrame(() => el.focus())}
                class="btn btn-primary"
                onClick={handleSave}
              >
                Save
              </button>
              <button class="btn btn-danger" onClick={props.onClose}>
                Discard
              </button>
              <button class="btn btn-cancel" onClick={() => setShowUnsavedDialog(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>
      <Show when={previewAtt()}>
        {(att) => (
          <div class="image-preview-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPreviewAtt(null); }}>
            <div class="image-preview-container">
              <div class="image-preview-header">
                <span class="image-preview-filename">{att().filename}</span>
                <div class="image-preview-actions">
                  <a
                    class="btn btn-sm image-preview-download"
                    href={api.getAttachmentUrl(props.card.id, att().id)}
                    download={att().filename}
                    title="Download"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </a>
                  <button class="image-preview-close" onClick={() => setPreviewAtt(null)} title="Close">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <img
                class="image-preview-img"
                src={api.getAttachmentUrl(props.card.id, att().id)}
                alt={att().filename}
              />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
