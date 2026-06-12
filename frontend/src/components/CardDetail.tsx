import { onMount, onCleanup, createSignal, Show } from "solid-js";
import { EditorView } from "prosemirror-view";
import type { Attachment, Card, ChecklistItem, Label } from "../types";
import { api } from "../api";
import { createCardEditor, docFromDescription, isDocEmpty } from "../proseEditor";
import { focusTrap } from "../focusTrap";
import { createMutationQueue } from "../mutationQueue";
import { handleMarkdownShortcut } from "../mdInput";
import CardLabelSection from "./CardLabelSection";
import ChecklistSection from "./ChecklistSection";
import DueDateSection from "./DueDateSection";
import AttachmentsSection from "./AttachmentsSection";
import ImagePreviewOverlay from "./ImagePreviewOverlay";
import UnsavedDialog from "./UnsavedDialog";

interface Props {
  card: Card;
  boardLabels: Label[];
  onSave: (id: string, title: string, description: string, labelIds: string[], dueDate: string | null) => void;
  onClose: () => void;
  onToggleFilter?: () => void;
  onToggleHelp?: () => void;
}

export default function CardDetail(props: Props) {
  let editorRef!: HTMLDivElement;
  let titleInputRef!: HTMLInputElement;
  let dueDateRef!: HTMLInputElement;
  let checklistAddRef!: HTMLInputElement;
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
  const [draggingFile, setDraggingFile] = createSignal(false);
  const [dueDate, setDueDate] = createSignal<string>(props.card.due_date ?? "");
  const [checklist, setChecklist] = createSignal<ChecklistItem[]>(props.card.checklist ?? []);
  let dragCounter = 0;

  onMount(() => {
    view = createCardEditor(editorRef, docFromDescription(props.card.description), () => {
      setDirty(true);
    });
    // Board.tsx dispatches this when its global Escape handler fires while the
    // modal is open but focus is outside it (e.g. on <body>) — route through
    // the dirty guard instead of closing unconditionally.
    document.addEventListener("request-card-close", handleCloseRequest);
  });

  onCleanup(() => {
    view?.destroy();
    document.removeEventListener("request-card-close", handleCloseRequest);
  });

  const handleCloseRequest = () => {
    if (showUnsavedDialog()) return;
    if (previewAtt()) {
      setPreviewAtt(null);
      return;
    }
    guardedClose();
  };

  // --- Labels ---

  const toggleLabel = (labelId: string) => {
    setSelectedLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId]
    );
    setDirty(true);
  };

  // --- Attachments ---

  const uploadFile = async (file: File) => {
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

  // --- Checklist (saves immediately: optimistic local update + API call) ---

  // Checklist ops are optimistic and not awaited by the UI; the queue
  // serializes them against the card file (see mutationQueue.ts).
  const checklistQueue = createMutationQueue();
  const enqueueChecklistOp = checklistQueue.enqueue;

  const handleAddChecklistItem = (text: string) => {
    enqueueChecklistOp(async () => {
      const item = await api.addChecklistItem(props.card.id, text);
      setChecklist((prev) => [...prev, item]);
    });
  };

  const handleToggleChecklistItem = (itemId: string, done: boolean) => {
    setChecklist((prev) => prev.map((i) => (i.id === itemId ? { ...i, done } : i)));
    enqueueChecklistOp(() => api.updateChecklistItem(props.card.id, itemId, { done }));
  };

  const handleRenameChecklistItem = (itemId: string, text: string) => {
    setChecklist((prev) => prev.map((i) => (i.id === itemId ? { ...i, text } : i)));
    enqueueChecklistOp(() => api.updateChecklistItem(props.card.id, itemId, { text }));
  };

  const handleDeleteChecklistItem = (itemId: string) => {
    setChecklist((prev) => prev.filter((i) => i.id !== itemId));
    enqueueChecklistOp(() => api.deleteChecklistItem(props.card.id, itemId));
  };

  const handleMoveChecklistItem = (itemId: string, toIndex: number) => {
    setChecklist((prev) => {
      const from = prev.findIndex((i) => i.id === itemId);
      if (from === -1) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, item);
      return next;
    });
    enqueueChecklistOp(() => api.updateChecklistItem(props.card.id, itemId, { pos: toIndex }));
  };

  const handleToggleAllChecklist = (done: boolean) => {
    setChecklist((prev) => prev.map((i) => ({ ...i, done })));
    enqueueChecklistOp(() => api.setChecklistAll(props.card.id, done));
  };

  // --- Modal-wide file drag/drop ---

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer?.types.includes("Files")) setDraggingFile(true);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setDraggingFile(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    setDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) uploadFile(file);
  };

  // --- Save / close ---

  const handleSave = () => {
    if (!view) return;
    const doc = view.state.doc;
    const description = isDocEmpty(doc) ? "" : JSON.stringify(doc.toJSON());
    setDirty(false);
    const dd = dueDate().trim();
    // Wait for in-flight checklist writes: the card save is a read-modify-write
    // of the same file and would otherwise clobber them (and the refetch after
    // save would show stale state).
    void checklistQueue.flush().then(() =>
      props.onSave(props.card.id, title(), description, selectedLabelIds(), dd || null)
    );
  };

  const closeAfterFlush = () => {
    void checklistQueue.flush().then(() => props.onClose());
  };

  const guardedClose = () => {
    if (dirty()) {
      setShowUnsavedDialog(true);
      return;
    }
    closeAfterFlush();
  };

  // --- Keyboard ---

  const handleKeyDown = (e: KeyboardEvent) => {
    // The unsaved dialog owns the keyboard while it's open (its own handler
    // covers Enter/Escape) — don't let underlying modal shortcuts fire.
    if (showUnsavedDialog()) return;
    if (e.key === "Escape") {
      if (previewAtt()) {
        setPreviewAtt(null);
        e.stopPropagation();
        return;
      }
      guardedClose();
    }
    // Ctrl/Cmd+S saves. Not Ctrl+Enter: ProseMirror inserts a hard break on
    // Ctrl+Enter, which would corrupt the description right before saving.
    if ((e.key === "s" || e.key === "S") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Shift" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const inEditor = editorRef?.contains(e.target as Node);
      if (inEditor) {
        titleInputRef?.focus();
      } else {
        view?.focus();
      }
      return;
    }
    const el = e.target as HTMLElement;
    const isTyping =
      el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.contentEditable === "true";
    if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === "d") {
        e.preventDefault();
        dueDateRef?.focus();
      } else if (e.key === "c") {
        e.preventDefault();
        checklistAddRef?.focus();
      } else if (e.key === "l") {
        e.preventDefault();
        setShowLabelPicker((v) => !v);
      } else if (e.key === "f") {
        e.preventDefault();
        props.onToggleFilter?.();
      } else if (e.key === "?") {
        e.preventDefault();
        props.onToggleHelp?.();
      }
    }
  };

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      view?.focus();
      return;
    }
    handleMarkdownShortcut(e);
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) guardedClose();
  };

  return (
    <div
      class="modal-overlay"
      ref={(el) => onCleanup(focusTrap(el))}
      classList={{ "modal-overlay--drop-active": draggingFile() }}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="modal-content">
        <Show when={draggingFile()}>
          <div class="drop-zone-overlay">
            <div class="drop-zone-message">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span>Drop files to attach</span>
            </div>
          </div>
        </Show>
        <div class="modal-header">
          <div class="modal-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
          </div>
          <input
            ref={(el) => { titleInputRef = el; requestAnimationFrame(() => el.focus()); }}
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
          <CardLabelSection
            boardLabels={props.boardLabels}
            selectedIds={selectedLabelIds()}
            pickerOpen={showLabelPicker()}
            onToggleLabel={toggleLabel}
            onTogglePicker={() => setShowLabelPicker((v) => !v)}
          />
          <DueDateSection
            value={dueDate()}
            onChange={(v) => { setDueDate(v); setDirty(true); }}
            inputRef={(el) => (dueDateRef = el)}
          />
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
            <kbd>Ctrl</kbd>+<kbd>B</kbd> bold &middot; <kbd>Ctrl</kbd>+<kbd>I</kbd> italic &middot; <kbd>Tab</kbd>/<kbd>Shift</kbd>+<kbd>Tab</kbd> nest list &middot; <kbd>Ctrl</kbd>+<kbd>S</kbd> save
          </div>
          <ChecklistSection
            items={checklist()}
            onAdd={handleAddChecklistItem}
            onToggle={handleToggleChecklistItem}
            onRename={handleRenameChecklistItem}
            onDelete={handleDeleteChecklistItem}
            onMove={handleMoveChecklistItem}
            onToggleAll={handleToggleAllChecklist}
            addInputRef={(el) => (checklistAddRef = el)}
          />
          <AttachmentsSection
            cardId={props.card.id}
            attachments={attachments()}
            uploading={uploading()}
            onUpload={uploadFile}
            onDelete={handleDeleteAttachment}
            onPreview={setPreviewAtt}
          />
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onClick={handleSave}>Save</button>
          <button class="btn btn-cancel" onClick={guardedClose}>Cancel</button>
          {dirty() && <span class="unsaved-indicator">Unsaved changes</span>}
        </div>
      </div>

      <Show when={showUnsavedDialog()}>
        <UnsavedDialog
          onSave={handleSave}
          onDiscard={closeAfterFlush}
          onCancel={() => setShowUnsavedDialog(false)}
        />
      </Show>

      <Show when={previewAtt()}>
        {(att) => (
          <ImagePreviewOverlay
            cardId={props.card.id}
            attachment={att()}
            onClose={() => setPreviewAtt(null)}
          />
        )}
      </Show>
    </div>
  );
}
