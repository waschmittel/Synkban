import { onMount, onCleanup, createSignal, Show } from "solid-js";
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
import type { Card } from "../types";

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

interface Props {
  card: Card;
  onSave: (id: string, title: string, description: string) => void;
  onClose: () => void;
}

export default function CardDetail(props: Props) {
  let editorRef!: HTMLDivElement;
  let view: EditorView | undefined;
  const [title, setTitle] = createSignal(props.card.title);
  const [dirty, setDirty] = createSignal(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = createSignal(false);

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

  const handleSave = () => {
    if (!view) return;
    const doc = view.state.doc;
    const description = isDocEmpty(doc) ? "" : JSON.stringify(doc.toJSON());
    setDirty(false);
    props.onSave(props.card.id, title(), description);
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

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      guardedClose();
    }
  };

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
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); view?.focus(); } }}
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
            <kbd>Ctrl</kbd>+<kbd>B</kbd> bold &middot; <kbd>Ctrl</kbd>+<kbd>I</kbd> italic &middot; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save
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
