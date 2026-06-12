import { createSignal, For, Show } from "solid-js";
import type { ChecklistItem } from "../types";

interface Props {
  items: ChecklistItem[];
  onAdd: (text: string) => void;
  onToggle: (itemId: string, done: boolean) => void;
  onRename: (itemId: string, text: string) => void;
  onDelete: (itemId: string) => void;
  onToggleAll: (done: boolean) => void;
  addInputRef?: (el: HTMLInputElement) => void;
}

/// Checklist in the card detail modal. Every change saves immediately via the
/// parent's handlers (optimistic local update + API call). Items are
/// keyboard-first: tabindex=0, ↑↓ to move, Space toggles, Enter edits,
/// Delete/Backspace removes (focus moves to a neighbor).
export default function ChecklistSection(props: Props) {
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");
  const [newText, setNewText] = createSignal("");

  const doneCount = () => props.items.filter((i) => i.done).length;
  const allDone = () => props.items.length > 0 && doneCount() === props.items.length;

  // Items are re-created in the DOM after an optimistic update, so focus by
  // id on the next frame instead of holding on to the old element.
  const focusItem = (id: string) =>
    requestAnimationFrame(() => {
      (
        document.querySelector(`[data-checklist-item-id="${id}"]`) as HTMLElement | null
      )?.focus();
    });

  const toggleItem = (item: ChecklistItem) => {
    props.onToggle(item.id, !item.done);
    focusItem(item.id);
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

  const deleteItem = (el: HTMLElement, itemId: string) => {
    const sibling = (el.nextElementSibling ?? el.previousElementSibling) as HTMLElement | null;
    props.onDelete(itemId);
    if (sibling?.classList.contains("checklist-item")) {
      const sibId = sibling.dataset.checklistItemId;
      if (sibId) focusItem(sibId);
    }
  };

  const handleItemKeyDown = (e: KeyboardEvent, item: ChecklistItem) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const el = e.currentTarget as HTMLElement;
    if (e.key === " ") {
      e.preventDefault();
      toggleItem(item);
    } else if (e.key === "Enter") {
      e.preventDefault();
      startEdit(item);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteItem(el, item.id);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      (el.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      (el.previousElementSibling as HTMLElement | null)?.focus();
    }
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
        <For each={props.items}>
          {(item) => (
            <div
              class="checklist-item"
              classList={{ "checklist-item--done": item.done }}
              tabindex="0"
              data-checklist-item-id={item.id}
              onKeyDown={(e) => handleItemKeyDown(e, item)}
            >
              <input
                type="checkbox"
                class="checklist-checkbox"
                tabindex="-1"
                checked={item.done}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleItem(item)}
              />
              <Show
                when={editingId() === item.id}
                fallback={
                  <span class="checklist-text" onClick={() => startEdit(item)}>
                    {item.text}
                  </span>
                }
              >
                <input
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  class="checklist-edit-input"
                  type="text"
                  value={editValue()}
                  onInput={(e) => setEditValue(e.currentTarget.value)}
                  onBlur={() => commitEdit(item)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit(item);
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      cancelEdit(item);
                    }
                  }}
                />
              </Show>
              <button
                class="checklist-delete"
                title="Remove item"
                tabindex="-1"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteItem(e.currentTarget.closest(".checklist-item") as HTMLElement, item.id);
                }}
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
