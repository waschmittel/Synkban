import { createSignal, Index, Show } from "solid-js";
import type { ChecklistItem } from "../types";
import { moveRovingFocus } from "../rovingFocus";

interface Props {
  items: ChecklistItem[];
  onAdd: (text: string) => void;
  onToggle: (itemId: string, done: boolean) => void;
  onRename: (itemId: string, text: string) => void;
  onDelete: (itemId: string) => void;
  onMove: (itemId: string, toIndex: number) => void;
  onToggleAll: (done: boolean) => void;
  addInputRef?: (el: HTMLInputElement) => void;
}

/// Checklist in the card detail modal. Edits mutate the parent's local state
/// only and persist as part of the card Save (no immediate API call). Items are
/// keyboard-first: tabindex=0, ↑↓ to move, Space toggles, Enter edits,
/// Shift+↑↓ reorders, Delete/Backspace asks for inline confirmation.
/// Items can also be reordered via native HTML5 drag & drop.
export default function ChecklistSection(props: Props) {
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");
  const [newText, setNewText] = createSignal("");
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);
  const [draggedId, setDraggedId] = createSignal<string | null>(null);
  // Insertion slot (0..items.length) while dragging, null otherwise.
  const [dropSlot, setDropSlot] = createSignal<number | null>(null);

  const doneCount = () => props.items.filter((i) => i.done).length;
  const allDone = () => props.items.length > 0 && doneCount() === props.items.length;

  // Focus by id on the next frame — used where the focused element is being
  // swapped out (edit input ↔ text span, item deletion, reorder).
  const focusItem = (id: string) =>
    requestAnimationFrame(() => {
      (
        document.querySelector(`[data-checklist-item-id="${id}"]`) as HTMLElement | null
      )?.focus();
    });

  // Rows are rendered with <Index> so an optimistic toggle updates the row
  // in place instead of re-creating the DOM node. Focus must never leave the
  // item, otherwise keys pressed right after Space (e.g. Delete) hit <body>.
  const toggleItem = (item: ChecklistItem) => {
    props.onToggle(item.id, !item.done);
  };

  const startEdit = (item: ChecklistItem) => {
    setEditValue(item.text);
    setEditingId(item.id);
  };

  const commitEdit = (item: ChecklistItem) => {
    if (editingId() !== item.id) return;
    const text = editValue().trim();
    setEditingId(null);
    if (text && text !== item.text) props.onRename(item.id, text);
    focusItem(item.id);
  };

  const cancelEdit = (item: ChecklistItem) => {
    setEditingId(null);
    focusItem(item.id);
  };

  const cancelDelete = (itemId: string) => {
    setConfirmDeleteId(null);
    focusItem(itemId);
  };

  const confirmDelete = (el: HTMLElement, itemId: string) => {
    setConfirmDeleteId(null);
    const sibling = (el.nextElementSibling ?? el.previousElementSibling) as HTMLElement | null;
    props.onDelete(itemId);
    if (sibling?.classList.contains("checklist-item")) {
      const sibId = sibling.dataset.checklistItemId;
      if (sibId) focusItem(sibId);
    }
  };

  const moveItem = (item: ChecklistItem, index: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= props.items.length || toIndex === index) return;
    props.onMove(item.id, toIndex);
    focusItem(item.id);
  };

  const handleItemKeyDown = (e: KeyboardEvent, item: ChecklistItem, index: number) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT") return;
    const el = e.currentTarget as HTMLElement;
    // While the inline delete confirmation is open, the Yes/No buttons own
    // Enter/Space — only Escape is handled here (cancel + refocus the item).
    if (target.tagName === "BUTTON" || confirmDeleteId() === item.id) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelDelete(item.id);
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      toggleItem(item);
    } else if (e.key === "Enter") {
      e.preventDefault();
      startEdit(item);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setConfirmDeleteId(item.id);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      if (e.shiftKey) {
        moveItem(item, index, index + dir);
      } else {
        moveRovingFocus(el.parentElement as HTMLElement, ".checklist-item", dir);
      }
    }
  };

  // --- Drag & drop reorder ---
  // The drop event must bubble up to the modal overlay: its drop handler
  // resets the file-drop counter (and ignores non-file drops), otherwise the
  // "Drop files to attach" overlay can get stuck after an internal drag.

  const handleDragStart = (e: DragEvent, item: ChecklistItem) => {
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);
    }
    setDraggedId(item.id);
  };

  const handleDragOver = (e: DragEvent, index: number) => {
    if (!draggedId()) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropSlot(before ? index : index + 1);
  };

  const handleDrop = (e: DragEvent) => {
    const id = draggedId();
    const slot = dropSlot();
    setDraggedId(null);
    setDropSlot(null);
    if (id === null || slot === null) return;
    e.preventDefault();
    const from = props.items.findIndex((i) => i.id === id);
    if (from === -1) return;
    const to = slot > from ? slot - 1 : slot;
    if (to !== from) {
      props.onMove(id, to);
      focusItem(id);
    }
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropSlot(null);
  };

  const handleAdd = () => {
    const text = newText().trim();
    if (!text) return;
    setNewText("");
    props.onAdd(text);
  };

  return (
    <div class="checklist-area">
      <div class="modal-section-header checklist-header" style={{ "margin-top": "16px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span class="modal-label">Checklist</span>
        <Show when={props.items.length > 0}>
          <span class="checklist-progress" classList={{ "checklist-progress--complete": allDone() }}>
            {doneCount()}/{props.items.length}
          </span>
          <button
            class="checklist-toggle-all"
            onClick={() => props.onToggleAll(!allDone())}
            title={allDone() ? "Uncheck all items" : "Check all items"}
          >
            {allDone() ? "Uncheck all" : "Check all"}
          </button>
        </Show>
      </div>
      <div class="checklist-items">
        <Index each={props.items}>
          {(item, index) => (
            <div
              class="checklist-item"
              classList={{
                "checklist-item--done": item().done,
                "checklist-item--dragging": draggedId() === item().id,
                "checklist-item--drop-before": dropSlot() === index,
                "checklist-item--drop-after":
                  index === props.items.length - 1 && dropSlot() === props.items.length,
              }}
              tabindex="0"
              data-checklist-item-id={item().id}
              draggable={editingId() !== item().id}
              onKeyDown={(e) => handleItemKeyDown(e, item(), index)}
              onDragStart={(e) => handleDragStart(e, item())}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              <input
                type="checkbox"
                class="checklist-checkbox"
                tabindex="-1"
                checked={item().done}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleItem(item())}
              />
              <Show
                when={editingId() === item().id}
                fallback={
                  <span class="checklist-text" onClick={() => startEdit(item())}>
                    {item().text}
                  </span>
                }
              >
                <input
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  class="checklist-edit-input"
                  type="text"
                  value={editValue()}
                  onInput={(e) => setEditValue(e.currentTarget.value)}
                  onBlur={() => commitEdit(item())}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit(item());
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      cancelEdit(item());
                    }
                  }}
                />
              </Show>
              <Show
                when={confirmDeleteId() === item().id}
                fallback={
                  <button
                    class="checklist-delete"
                    title="Remove item"
                    tabindex="-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(item().id);
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                }
              >
                <span class="checklist-confirm">
                  <span class="checklist-confirm-text">Delete?</span>
                  <button
                    class="btn btn-danger btn-sm"
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(
                        e.currentTarget.closest(".checklist-item") as HTMLElement,
                        item().id
                      );
                    }}
                  >
                    Yes
                  </button>
                  <button
                    class="btn btn-cancel btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelDelete(item().id);
                    }}
                  >
                    No
                  </button>
                </span>
              </Show>
            </div>
          )}
        </Index>
      </div>
      <input
        ref={props.addInputRef}
        class="checklist-add-input"
        type="text"
        placeholder="Add checklist item…"
        value={newText()}
        onInput={(e) => setNewText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
      />
    </div>
  );
}
