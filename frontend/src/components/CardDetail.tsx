import { onMount, onCleanup, createSignal, createMemo, createEffect, on, Show } from "solid-js";
import { EditorView } from "prosemirror-view";
import { EditorState } from "prosemirror-state";
import type { Attachment, Card, ChecklistItem, Draft, DraftContent, Label } from "../types";
import { checklistOf, contentOf, labelsOf, normLabels, sameContent, serializeChecklist, serializeDoc } from "../cardContent";
import { timeAgo } from "../timeAgo";
import { api } from "../api";
import { createCardEditor, docFromDescription, insertImage, removeImages } from "../proseEditor";
import { pastedImageFiles } from "../pasteImages";
import { imageRefIds, stripImageRefs } from "../imageRefs";
import { focusTrap } from "../focusTrap";
import { handleMarkdownShortcut } from "../mdInput";
import { accel, hasAccel, tip } from "../platform";
import CardLabelSection from "./CardLabelSection";
import ChecklistSection from "./ChecklistSection";
import DueDateSection from "./DueDateSection";
import AttachmentsSection from "./AttachmentsSection";
import ImagePreviewOverlay from "./ImagePreviewOverlay";
import ConfirmDialog from "./ConfirmDialog";
import UnsavedDialog from "./UnsavedDialog";
import HistoryDialog from "./HistoryDialog";
import ExportPdfDialog from "./ExportPdfDialog";
import DetailRow from "./DetailRow";

/// Handle the Notes pane hands to its board (ADR-0022).
export interface CardDetailControl {
  dirty: () => boolean;
  /// Resolves true once it's fine to leave the card: clean, saved or
  /// discarded via the unsaved dialog; false when the user cancelled.
  confirmLeave: () => Promise<boolean>;
  focusDescription: () => void;
  /// Esc: back to the master card, asking first when dirty.
  leave: () => void;
}

interface Props {
  card: Card;
  boardLabels: Label[];
  onCreateLabel: (name: string) => Promise<Label>;
  onSave: (id: string, title: string, description: string, labelIds: string[], dueDate: string | null, checklist: ChecklistItem[]) => void | Promise<void>;
  /// Modal: close it. Pane: hand focus back to the card list.
  onClose: () => void;
  onToggleHelp?: () => void;
  /// "modal" (default) closes on Save; "pane" is the inline Notes editor: Save
  /// stays, Cancel is Revert, Esc asks before leaving dirty edits (ADR-0022).
  variant?: "modal" | "pane";
  /// Pane: the card vanished from the board (archived/deleted elsewhere).
  removed?: boolean;
  /// Pane: bring a removed card back; resolves false if that failed.
  onRestore?: () => Promise<boolean>;
  /// Pane: attachments changed (the board refreshes its badges).
  onAttachmentsChanged?: () => void;
  control?: (c: CardDetailControl) => void;
  /// Unsaved edits appeared/went (the board marks the card and its tab).
  onDirtyChange?: (dirty: boolean) => void;
  /// Unsaved edits are kept as a draft of this board while dirty (ADR-0024).
  boardId?: string;
  /// A draft from before the app closed, checked against the card: start from it.
  draft?: Draft;
}

type Content = DraftContent;

export default function CardDetail(props: Props) {
  const pane = props.variant === "pane";
  let editorRef!: HTMLDivElement;
  let titleInputRef!: HTMLInputElement;
  let openDuePicker: (() => void) | undefined;
  let checklistAddRef!: HTMLInputElement;
  let focusLabels: (() => void) | undefined;
  let attachmentInputRef: HTMLInputElement | undefined;
  let view: EditorView | undefined;

  // Saved baseline. Dirtiness = current serialized state differs from it, so
  // reverting an edit back to the original clears dirty. The modal captures it
  // once; the pane rebases it after every save and external reload.
  const [base, setBase] = createSignal(contentOf(props.card));
  // A restored draft is the starting point; `base` stays the stored card.
  // (Read once: the board hands it out a single time.)
  const draft = props.draft;
  const start = draft?.draft ?? base();
  const [restoredAt, setRestoredAt] = createSignal(draft?.saved_at ?? null);

  const [title, setTitle] = createSignal(start.title);
  const [selectedLabelIds, setSelectedLabelIds] = createSignal<string[]>(labelsOf(start));
  const [description, setDescription] = createSignal(start.description);
  const [dueDate, setDueDate] = createSignal<string>(start.due);
  const [checklist, setChecklist] = createSignal<ChecklistItem[]>(checklistOf(start));
  const current = (): Content => ({
    title: title(),
    description: description(),
    labels: normLabels(selectedLabelIds()),
    due: dueDate().trim(),
    checklist: serializeChecklist(checklist()),
  });
  const dirty = createMemo(() => !sameContent(current(), base()));
  // Captured: on unmount the prop getter may read a <Show> that already closed.
  const onDirtyChange = props.onDirtyChange;
  createEffect(() => onDirtyChange?.(dirty()));
  onCleanup(() => onDirtyChange?.(false));

  // --- Draft: kept while dirty, so closing the app loses nothing (ADR-0024) ---
  const cardId = props.card.id;
  const boardId = props.boardId;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let draftStored = !!draft;
  const storeDraft = (keepalive = false) => {
    if (!boardId) return;
    draftStored = true;
    api
      .saveDraft({ card_id: cardId, board_id: boardId, base: base(), draft: current(), saved_at: Date.now() }, keepalive)
      .catch(() => {});
  };
  const dropDraft = () => {
    if (!draftStored) return;
    draftStored = false;
    api.deleteDraft(cardId).catch(() => {});
  };
  createEffect(() => {
    const d = dirty();
    current();
    base();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => (d ? storeDraft() : dropDraft()), 300);
  });
  createEffect(() => !dirty() && setRestoredAt(null));
  // Unloading: send the pending draft now. (No cleanup runs then, so the
  // draft survives; an in-app close below means it was saved or discarded.)
  const onPageHide = () => {
    if (!dirty()) return;
    clearTimeout(draftTimer);
    storeDraft(true);
  };
  window.addEventListener("pagehide", onPageHide);
  onCleanup(() => {
    window.removeEventListener("pagehide", onPageHide);
    clearTimeout(draftTimer);
    dropDraft();
  });
  /// Empty checklist/attachments collapse into "+ Checklist" / "+ Attachment".
  const [checklistOpen, setChecklistOpen] = createSignal(false);
  const showChecklist = () => checklistOpen() || checklist().length > 0;
  const showAttachments = () => uploading() || attachments().length > 0;
  const openChecklist = () => {
    setChecklistOpen(true);
    checklistAddRef?.focus();
  };
  /// Pane: the stored card changed elsewhere while this one was dirty.
  const [conflict, setConflict] = createSignal<Card | null>(null);
  /// Pane: brief confirmation after a save, since nothing closes.
  const [savedAt, setSavedAt] = createSignal<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = createSignal(false);
  const [showHistory, setShowHistory] = createSignal(false);
  const [showExport, setShowExport] = createSignal(false);
  const [attachments, setAttachments] = createSignal<Attachment[]>(props.card.attachments ?? []);
  /// Uploads in flight (several files can go at once).
  const [uploads, setUploads] = createSignal(0);
  const uploading = () => uploads() > 0;
  const [previewAtt, setPreviewAtt] = createSignal<Attachment | null>(null);
  const [deleteAtt, setDeleteAtt] = createSignal<Attachment | null>(null);
  /// Attachments the description shows inline (live, from the editor).
  const referenced = createMemo(() => imageRefIds(description()));
  const [draggingFile, setDraggingFile] = createSignal(false);
  let dragCounter = 0;

  onMount(() => {
    view = createCardEditor(editorRef, docFromDescription(start.description), () => {
      setDescription(serializeDoc(view!.state.doc));
    }, {
      onPasteImages: attachFiles,
      cardId: props.card.id,
      attachments,
      uploadImage: pickImages,
      copyAttachment: async (from, id) => {
        try {
          const att = await api.copyAttachment(props.card.id, from, id);
          setAttachments((prev) => [...prev.filter((a) => a.id !== att.id), att]);
          props.onAttachmentsChanged?.();
          return att;
        } catch {
          return undefined; // the reference is dropped (source gone)
        }
      },
      onImageClick: (id) => {
        const att = attachments().find((a) => a.id === id);
        if (att) setPreviewAtt(att);
      },
    });
    props.control?.({ dirty, confirmLeave, focusDescription: () => view?.focus(), leave: () => guardedClose() });
    // Board.tsx dispatches this when its global Escape handler fires while the
    // modal is open but focus is outside it (e.g. on <body>) — route through
    // the dirty guard instead of closing unconditionally.
    document.addEventListener("request-card-close", handleCloseRequest);
  });

  onCleanup(() => {
    view?.destroy();
    document.removeEventListener("request-card-close", handleCloseRequest);
  });

  // --- Pane: load / revert / external changes ---

  /// Replace the editor content without an undo step back to the old version.
  const setEditorDoc = (description: string) => {
    if (!view) return;
    view.updateState(EditorState.create({ doc: docFromDescription(description), plugins: view.state.plugins }));
    setDescription(serializeDoc(view.state.doc));
  };

  const load = (card: Card) => {
    setBase(contentOf(card));
    setTitle(card.title);
    setSelectedLabelIds(card.label_ids ?? []);
    setDueDate(card.due_date ?? "");
    setChecklist(card.checklist ?? []);
    setChecklistOpen(false);
    setEditorDoc(card.description);
    setConflict(null);
  };

  /// Back to the saved state (the stored card, with any newer stored version).
  const revert = () => load(conflict() ?? props.card);

  // Snapshot being saved right now: its refetch must not look like a foreign
  // change, even though it lands before `base` is rebased.
  let saving: Content | null = null;

  if (pane) {
    createEffect(
      on(
        () => props.card,
        (card) => {
          setAttachments(card.attachments ?? []);
          const incoming = contentOf(card);
          if (sameContent(incoming, base())) return;
          if (saving && sameContent(incoming, saving)) return setBase(saving);
          if (dirty()) setConflict(card);
          else load(card);
        },
        { defer: true },
      ),
    );
  }

  // Pane: the unsaved dialog decides whether a leave may proceed.
  let resolveLeave: ((ok: boolean) => void) | undefined;
  // No focus trap around the pane: put the caret back where it was on Cancel.
  let focusBeforeLeave: HTMLElement | null = null;
  const settleLeave = (ok: boolean) => {
    setShowUnsavedDialog(false);
    const r = resolveLeave;
    resolveLeave = undefined;
    if (!ok && focusBeforeLeave?.isConnected) focusBeforeLeave.focus();
    focusBeforeLeave = null;
    r?.(ok);
  };
  function confirmLeave(): Promise<boolean> {
    if (!dirty()) return Promise.resolve(true);
    resolveLeave?.(false);
    focusBeforeLeave = document.activeElement as HTMLElement | null;
    setShowUnsavedDialog(true);
    return new Promise((r) => (resolveLeave = r));
  }
  const leaveSave = async () => {
    try {
      await handleSave();
    } catch {
      return settleLeave(false);
    }
    settleLeave(!dirty());
  };
  const leaveDiscard = () => {
    revert();
    settleLeave(true);
  };

  const handleCloseRequest = () => {
    if (pane) return;
    if (showUnsavedDialog() || showHistory() || showExport() || deleteAtt()) return;
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
  };

  const createLabel = async (name: string) => {
    const label = await props.onCreateLabel(name);
    setSelectedLabelIds((ids) => (ids.includes(label.id) ? ids : [...ids, label.id]));
  };

  // --- Attachments ---

  const uploadFile = async (file: File): Promise<Attachment | undefined> => {
    setUploads((n) => n + 1);
    try {
      const att = await api.uploadAttachment(props.card.id, file);
      setAttachments((prev) => [...prev.filter((a) => a.id !== att.id), att]);
      props.onAttachmentsChanged?.();
      return att;
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploads((n) => n - 1);
    }
  };

  /// Uploaded/pasted images become attachments; `inline` also references each one in
  /// the description at the caret.
  const attachFiles = async (files: File[], inline = true) => {
    for (const file of files) {
      const att = await uploadFile(file);
      if (att && inline && view) insertImage(view, att);
    }
  };

  // Paste anywhere in the modal except the editor, which handles (and
  // prevents) its own image pastes.
  const handlePaste = (e: ClipboardEvent) => {
    if (e.defaultPrevented) return;
    const files = pastedImageFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    attachFiles(files, false);
  };

  /// File chooser for images to upload and reference at the caret. The input
  /// is detached: nothing stays in the DOM next to the attachment picker.
  const pickImages = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () =>
      attachFiles(Array.from(input.files ?? []).filter((f) => f.type.startsWith("image/")));
    input.click();
  };

  /// Asks first when the description shows the attachment inline.
  const requestDelete = (att: Attachment) => {
    if (referenced().has(att.id)) setDeleteAtt(att);
    else handleDeleteAttachment(att.id);
  };

  // The server drops the references from the stored description too, so the
  // saved baseline loses them as well (unsaved edits stay unsaved).
  const handleDeleteAttachment = async (attId: string) => {
    await api.deleteAttachment(props.card.id, attId);
    setBase((b) => ({ ...b, description: stripImageRefs(b.description, attId) }));
    if (view) removeImages(view, attId);
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
    props.onAttachmentsChanged?.();
  };

  // --- Checklist ---
  // Checklist is card content: edits live in the local signal, feed the dirty
  // memo, and persist as part of the card Save (UpdateCard.checklist). New item
  // IDs are generated client-side; the backend stores the array as-is.

  const handleAddChecklistItem = (text: string) => {
    setChecklist((prev) => [...prev, { id: crypto.randomUUID(), text, done: false }]);
  };

  const handleToggleChecklistItem = (itemId: string, done: boolean) => {
    setChecklist((prev) => prev.map((i) => (i.id === itemId ? { ...i, done } : i)));
  };

  const handleRenameChecklistItem = (itemId: string, text: string) => {
    setChecklist((prev) => prev.map((i) => (i.id === itemId ? { ...i, text } : i)));
  };

  const handleDeleteChecklistItem = (itemId: string) => {
    setChecklist((prev) => prev.filter((i) => i.id !== itemId));
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
  };

  const handleToggleAllChecklist = (done: boolean) => {
    setChecklist((prev) => prev.map((i) => ({ ...i, done })));
  };

  // --- Modal-wide file drag/drop ---

  /// The pane sits on the board: card drags pass through to the list tabs.
  const ignoreDrag = (e: DragEvent) => pane && !e.dataTransfer?.types.includes("Files");

  const handleDragEnter = (e: DragEvent) => {
    if (ignoreDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (e.dataTransfer?.types.includes("Files")) setDraggingFile(true);
  };

  const handleDragOver = (e: DragEvent) => {
    if (ignoreDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent) => {
    if (ignoreDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setDraggingFile(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    if (ignoreDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    setDraggingFile(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) uploadFile(file);
  };

  // --- Save / close ---

  const handleSave = async () => {
    if (!view) return;
    const desc = serializeDoc(view.state.doc);
    const dd = dueDate().trim();
    if (!pane) return props.onSave(props.card.id, title(), desc, selectedLabelIds(), dd || null, checklist());
    if (props.removed && !(await props.onRestore?.())) return;
    const snapshot = { ...current(), description: desc };
    saving = snapshot;
    try {
      await props.onSave(props.card.id, title(), desc, selectedLabelIds(), dd || null, checklist());
      setBase(snapshot);
      setConflict(null);
      setSavedAt(new Date().toTimeString().slice(0, 5));
    } finally {
      saving = null;
    }
  };

  // The "Saved" note goes as soon as the card is edited again.
  createEffect(on(dirty, (d) => d && setSavedAt(null), { defer: true }));

  // --- PDF export ---

  /// Exports the *saved* card. Unsaved edits aren't in the PDF, so a dirty
  /// card first asks whether to save (which closes the modal) or to export
  /// the stored version as-is.
  const startExport = () => {
    if (dirty()) setShowExport(true);
    else api.downloadCardPdf(props.card.id);
  };

  const exportAfterSave = async () => {
    const id = props.card.id;
    await handleSave();
    api.downloadCardPdf(id);
  };

  const exportSaved = () => {
    setShowExport(false);
    api.downloadCardPdf(props.card.id);
  };

  const guardedClose = () => {
    if (pane) {
      confirmLeave().then((ok) => ok && props.onClose());
      return;
    }
    if (dirty()) {
      setShowUnsavedDialog(true);
      return;
    }
    props.onClose();
  };

  // --- Keyboard ---

  const handleKeyDown = (e: KeyboardEvent) => {
    // The unsaved dialog owns the keyboard while it's open (its own handler
    // covers Enter/Escape) — don't let underlying modal shortcuts fire.
    if (showUnsavedDialog() || showHistory() || showExport() || deleteAtt()) return;
    if (e.key === "Escape") {
      if (previewAtt()) {
        setPreviewAtt(null);
        e.stopPropagation();
        return;
      }
      guardedClose();
    }
    // Accelerator section-focus shortcuts. These fire regardless of focus (even
    // while typing) since they carry a modifier; preventDefault suppresses the
    // browser defaults (bookmark, address bar, find-next, view-source).
    //
    // Letter choice is constrained twice over: never a key the browser refuses
    // to yield (T/N/W/Q/digits open tabs and windows — preventDefault does
    // nothing), and never a text-editing key (C/V/X/A/Z/Y), which is why the
    // checklist is L (list) and not C — that one silently ate every copy made
    // inside the modal. G mirrors the board's `g` = labels, E its `e` = edit.
    // History is J (journal): its natural letter H is Cmd+H (hide app) on macOS
    // and Ctrl+H (history page) elsewhere — preventDefault can't win that.
    // Accel+S saves — NOT Ctrl+Enter, which makes ProseMirror insert a hard
    // break that would corrupt the description right before saving.
    if (hasAccel(e)) {
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (k === "e") {
        e.preventDefault();
        titleInputRef?.focus();
        return;
      }
      if (k === "g") {
        e.preventDefault();
        focusLabels?.();
        return;
      }
      if (k === "d") {
        e.preventDefault();
        view?.focus();
        return;
      }
      if (k === "l") {
        e.preventDefault();
        openChecklist();
        return;
      }
      if (k === "o") {
        e.preventDefault();
        attachmentInputRef?.click();
        return;
      }
      if (k === "j") {
        e.preventDefault();
        setShowHistory(true);
        return;
      }
      // P (print): the browser's own print dialog is exactly what we replace.
      if (k === "p") {
        e.preventDefault();
        startExport();
        return;
      }
      if (k === "u") {
        e.preventDefault();
        openDuePicker?.();
        return;
      }
    }
    const el = e.target as HTMLElement;
    const isTyping =
      el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.contentEditable === "true";
    if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "?") {
      e.preventDefault();
      props.onToggleHelp?.();
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
      class={pane ? "notes-detail" : "modal-overlay"}
      ref={(el) => !pane && onCleanup(focusTrap(el))}
      classList={{ "modal-overlay--drop-active": draggingFile() }}
      onClick={pane ? undefined : handleOverlayClick}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="modal-content" classList={{ "modal-content--pane": pane }} data-pane-card={pane ? props.card.id : undefined}>
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
            <Show when={dirty()}>
              <span class="dirty-dot" title="Unsaved changes" />
            </Show>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
          </div>
          <input
            ref={(el) => { titleInputRef = el; if (!pane) requestAnimationFrame(() => el.focus()); }}
            class="modal-title-input"
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={handleTitleKeyDown}
            // Back to the start, so the ellipsis cuts the end, not the beginning.
            onBlur={(e) => (e.currentTarget.scrollLeft = 0)}
            placeholder="Card title..."
            title={tip("Edit title", accel("E"))}
          />
          <Show when={!pane}>
            <button class="modal-close" onClick={guardedClose} title="Close (Esc)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>
        <div class="modal-body">
          <Show when={pane && props.removed}>
            <div class="pane-banner pane-banner--removed" role="status">
              <span>This card was archived or deleted elsewhere. Your unsaved edits are kept until you leave it.</span>
              <button class="btn btn-sm" onClick={handleSave}>Restore &amp; save</button>
            </div>
          </Show>
          <Show when={restoredAt()}>
            {(at) => (
              <div class="pane-banner draft-banner" role="status">
                <span>Restored your unsaved edits from {timeAgo(at())}.</span>
                <button class="btn btn-sm" onClick={revert}>Discard</button>
              </div>
            )}
          </Show>
          <Show when={pane && !props.removed && conflict()}>
            <div class="pane-banner" role="status">
              <span>This card was changed elsewhere while you were editing. Saving keeps your version.</span>
              <button class="btn btn-sm" onClick={revert}>Load theirs</button>
            </div>
          </Show>
          <div class="card-meta">
            <DueDateSection value={dueDate()} onChange={setDueDate} openRef={(open) => (openDuePicker = open)} />
            <div class="card-meta-labels">
              <CardLabelSection
                boardLabels={props.boardLabels}
                selectedIds={selectedLabelIds()}
                onToggleLabel={toggleLabel}
                onCreateLabel={createLabel}
                focusRef={(f) => (focusLabels = f)}
              />
            </div>
          </div>
          <DetailRow
            class="description-row"
            title={tip("Description", accel("D"))}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="17" y1="10" x2="3" y2="10" />
                <line x1="21" y1="6" x2="3" y2="6" />
                <line x1="21" y1="14" x2="3" y2="14" />
                <line x1="17" y1="18" x2="3" y2="18" />
              </svg>
            }
          >
            <div class="editor-wrapper" ref={editorRef!} />
          </DetailRow>
          <Show when={showChecklist()}>
            <ChecklistSection
              items={checklist()}
              onAdd={handleAddChecklistItem}
              onToggle={handleToggleChecklistItem}
              onRename={handleRenameChecklistItem}
              onDelete={handleDeleteChecklistItem}
              onMove={handleMoveChecklistItem}
              onToggleAll={handleToggleAllChecklist}
              onIdle={() => setChecklistOpen(false)}
              addInputRef={(el) => (checklistAddRef = el)}
            />
          </Show>
          <Show when={showAttachments()}>
            <AttachmentsSection
              cardId={props.card.id}
              attachments={attachments()}
              uploading={uploading()}
              onAdd={() => attachmentInputRef?.click()}
              referenced={referenced()}
              onDelete={requestDelete}
              onPreview={setPreviewAtt}
              onInsert={(att) => view && insertImage(view, att)}
            />
          </Show>
          <Show when={!showChecklist() || !showAttachments()}>
            <div class="detail-add-row">
              <Show when={!showChecklist()}>
                <button type="button" class="detail-add-btn detail-add-checklist" title={tip("Add checklist", accel("L"))} onClick={openChecklist}>
                  Checklist
                </button>
              </Show>
              <Show when={!showAttachments()}>
                <button type="button" class="detail-add-btn detail-add-attachment" title={tip("Add attachment", accel("O"))} onClick={() => attachmentInputRef?.click()}>
                  Attachment
                </button>
              </Show>
            </div>
          </Show>
          <input
            type="file"
            multiple
            class="attachment-file-input"
            hidden
            ref={(el) => (attachmentInputRef = el)}
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = "";
              for (const f of files) uploadFile(f);
            }}
          />
        </div>
        <div class="modal-footer">
          <button
            class="btn modal-save-btn"
            classList={{ "btn-primary": dirty(), "btn-quiet": !dirty() }}
            onClick={handleSave}
            title={tip(dirty() ? "Save" : "Save (no changes)", accel("S"))}
          >
            Save
          </button>
          <Show
            when={pane}
            fallback={<button class="btn btn-cancel" onClick={guardedClose} title={tip("Cancel", "Esc")}>Cancel</button>}
          >
            <button class="btn btn-cancel" onClick={revert} disabled={!dirty()} title="Revert to the saved card">Revert</button>
          </Show>
          {dirty() && (
            <span class="unsaved-indicator">
              Unsaved changes
            </span>
          )}
          <Show when={pane && !dirty() && savedAt()}>
            {(at) => <span class="saved-indicator">Saved {at()}</span>}
          </Show>
          <button class="btn modal-export-btn" title={tip("Export PDF", accel("P"))} onClick={startExport}>
            <svg class="pdf-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <text x="12" y="18.5" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">PDF</text>
            </svg>
            Export PDF
          </button>
          <button class="btn modal-history-btn" title={tip("History", accel("J"))} onClick={() => setShowHistory(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <polyline points="3 3 3 8 8 8" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
            History
          </button>
        </div>
      </div>

      <Show when={showUnsavedDialog()}>
        <Show
          when={pane}
          fallback={
            <UnsavedDialog
              onSave={handleSave}
              onDiscard={props.onClose}
              onCancel={() => setShowUnsavedDialog(false)}
            />
          }
        >
          <UnsavedDialog onSave={leaveSave} onDiscard={leaveDiscard} onCancel={() => settleLeave(false)} />
        </Show>
      </Show>

      <Show when={showExport()}>
        <ExportPdfDialog
          onSaveAndExport={exportAfterSave}
          onExportSaved={exportSaved}
          onCancel={() => setShowExport(false)}
        />
      </Show>

      <Show when={deleteAtt()}>
        {(att) => (
          <ConfirmDialog
            message={`“${att().filename}” is shown in the description. Deleting it also removes it from the description.`}
            confirmLabel="Delete"
            onConfirm={() => {
              const id = att().id;
              setDeleteAtt(null);
              handleDeleteAttachment(id);
            }}
            onCancel={() => setDeleteAtt(null)}
          />
        )}
      </Show>

      <Show when={showHistory()}>
        <HistoryDialog
          cardId={props.card.id}
          boardLabels={props.boardLabels}
          onClose={() => setShowHistory(false)}
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
