import { onMount, onCleanup, createSignal, Show, For } from "solid-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  Schema,
  DOMParser as PmDOMParser,
  Node as PmNode,
} from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { exampleSetup } from "prosemirror-example-setup";
import type { Card, Label } from "../types";
import { renderTitle } from "./Card";

const schema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"),
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

  onMount(() => {
    const doc = docFromDescription(props.card.description);
    const state = EditorState.create({
      doc,
      plugins: exampleSetup({ schema, menuBar: true }),
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
    </div>
  );
}
