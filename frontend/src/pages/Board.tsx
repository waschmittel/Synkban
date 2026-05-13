import {
  createResource,
  createSignal,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { useParams } from "@solidjs/router";
import { api } from "../api";
import type { Card as CardType } from "../types";
import List from "../components/List";
import AddForm from "../components/AddForm";
import CardDetail from "../components/CardDetail";
import ShortcutHelp from "../components/ShortcutHelp";
import { useLabelContext } from "../LabelContext";

const BOARD_COLORS = [
  "#0079bf", "#026aa7", "#5ba4cf", "#29cce5",
  "#b3d9ff", "#519839", "#4bbf6b", "#d29034",
  "#f5a623", "#eb5a46", "#cd5a91", "#89609e",
  "#172b4d", "#838c91", "#7a6652", "#344563",
];

function isInInput(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.contentEditable === "true" ||
    !!el.closest(".modal-overlay") ||
    !!el.closest(".label-drawer") ||
    !!el.closest(".shortcut-help-overlay")
  );
}

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const lc = useLabelContext();

  const [board, { refetch }] = createResource(
    () => params.id,
    (id) => api.getBoard(id)
  );
  const [selectedCard, setSelectedCard] = createSignal<CardType | null>(null);
  const [showHelp, setShowHelp] = createSignal(false);
  const [lastFocusedCardId, setLastFocusedCardId] = createSignal<string | null>(null);
  const [showColorPicker, setShowColorPicker] = createSignal(false);

  // Label panel state
  const [newLabelName, setNewLabelName] = createSignal("");
  const [editingLabelId, setEditingLabelId] = createSignal<string | null>(null);
  const [editingLabelName, setEditingLabelName] = createSignal("");

  let lastMtime = 0;
  onMount(() => {
    lc.setHasBoard(true);

    const pollId = setInterval(async () => {
      try {
        const { mtime } = await api.checkChanges();
        if (mtime !== lastMtime) {
          lastMtime = mtime;
          refetch();
        }
      } catch { /* ignore */ }
    }, 15000);

    const handleGlobalKey = (e: KeyboardEvent) => {
      if (isInInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
      } else if (e.key === "Escape") {
        if (showHelp()) {
          setShowHelp(false);
        } else if (showColorPicker()) {
          setShowColorPicker(false);
        } else {
          lc.close();
          const focused = document.activeElement as HTMLElement | null;
          if (focused?.classList.contains("card")) focused.blur();
        }
      } else if (e.key === "g") {
        e.preventDefault();
        lc.toggle();
      } else if (e.key === "l") {
        e.preventDefault();
        const trigger = document.querySelector(
          ".add-list-wrapper .add-trigger"
        ) as HTMLElement | null;
        trigger?.click();
      } else if (e.key === "n" || e.key === "c") {
        e.preventDefault();
        const focused = document.activeElement;
        const list =
          focused?.closest(".list") ?? document.querySelector(".list");
        const trigger = list?.querySelector(".add-trigger") as HTMLElement | null;
        trigger?.click();
      } else if (e.key === "e") {
        const focused = document.activeElement;
        if (focused?.classList.contains("card")) {
          e.preventDefault();
          (focused as HTMLElement).click();
        }
      } else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key) && !e.shiftKey) {
        const focused = document.activeElement;
        if (!focused || !focused.classList.contains("card")) {
          e.preventDefault();
          const lists = document.querySelectorAll(".list");
          if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            const firstList = lists[0];
            const firstCard = firstList?.querySelector(".card") as HTMLElement | null;
            if (firstCard) firstCard.focus();
            else (firstList?.querySelector(".add-trigger") as HTMLElement | null)?.focus();
          } else {
            const lastList = lists[lists.length - 1];
            const cards = lastList?.querySelectorAll(".card");
            const lastCard = cards?.[cards.length - 1] as HTMLElement | null;
            if (lastCard) lastCard.focus();
            else (lastList?.querySelector(".add-trigger") as HTMLElement | null)?.focus();
          }
        }
      }
    };

    const handleToggleShortcuts = () => setShowHelp((v) => !v);

    document.addEventListener("keydown", handleGlobalKey);
    document.addEventListener(
      "toggle-shortcuts",
      handleToggleShortcuts as EventListener
    );

    onCleanup(() => {
      lc.setHasBoard(false);
      lc.close();
      clearInterval(pollId);
      document.removeEventListener("keydown", handleGlobalKey);
      document.removeEventListener(
        "toggle-shortcuts",
        handleToggleShortcuts as EventListener
      );
    });
  });

  const handleAddList = async (title: string) => {
    await api.createList(params.id, title);
    refetch();
  };

  const handleAddCard = async (listId: string, title: string) => {
    await api.createCard(listId, title);
    refetch();
  };

  const handleDeleteCard = async (cardId: string) => {
    await api.deleteCard(cardId);
    if (lastFocusedCardId() === cardId) setLastFocusedCardId(null);
    refetch();
  };

  const handleDeleteList = async (listId: string) => {
    await api.deleteList(listId);
    refetch();
  };

  const handleDropCard = async (
    cardId: string,
    targetListId: string,
    position: number
  ) => {
    await api.updateCard(cardId, { list_id: targetListId, position });
    refetch();
  };

  const handleMoveCard = async (
    cardId: string,
    targetListId: string,
    position: number
  ) => {
    await api.updateCard(cardId, { list_id: targetListId, position });
    refetch();
    // Restore focus after refetch redraws
    requestAnimationFrame(() => {
      (document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null)?.focus();
    });
  };

  const handleCardClick = (card: CardType) => {
    setLastFocusedCardId(card.id);
    setSelectedCard(card);
  };

  const handleCardSave = async (
    id: string,
    title: string,
    description: string,
    labelIds: string[]
  ) => {
    await api.updateCard(id, { title, description, label_ids: labelIds });
    setSelectedCard(null);
    restoreFocus();
    refetch();
  };

  const handleModalClose = () => {
    setSelectedCard(null);
    restoreFocus();
  };

  const restoreFocus = () => {
    const cardId = lastFocusedCardId();
    if (cardId) {
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-card-id="${cardId}"]`
        ) as HTMLElement | null;
        el?.focus();
      });
    }
  };

  const handleListDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("application/list-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const container = e.currentTarget as HTMLElement;
    const listElements = Array.from(
      container.querySelectorAll(".list:not(.list-dragging)")
    );

    let insertBefore: Element | null = null;
    for (const el of listElements) {
      const box = el.getBoundingClientRect();
      if (e.clientX < box.left + box.width / 2) {
        insertBefore = el;
        break;
      }
    }

    let placeholder = document.querySelector(".list-drop-placeholder");
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "list-drop-placeholder";
    }

    if (insertBefore) {
      container.insertBefore(placeholder, insertBefore);
    } else {
      const addWrapper = container.querySelector(".add-list-wrapper");
      if (addWrapper) {
        container.insertBefore(placeholder, addWrapper);
      } else {
        container.appendChild(placeholder);
      }
    }
  };

  const handleListDrop = async (e: DragEvent) => {
    const listId = e.dataTransfer?.getData("application/list-id");
    if (!listId) return;
    e.preventDefault();
    document
      .querySelectorAll(".list-drop-placeholder")
      .forEach((el) => el.remove());

    const container = e.currentTarget as HTMLElement;
    const listElements = Array.from(
      container.querySelectorAll(".list:not(.list-dragging)")
    );

    const dropX = e.clientX;
    let insertIndex = listElements.length;
    for (let i = 0; i < listElements.length; i++) {
      const box = listElements[i].getBoundingClientRect();
      if (dropX < box.left + box.width / 2) {
        insertIndex = i;
        break;
      }
    }

    const positions = listElements.map(
      (el) => parseFloat((el as HTMLElement).dataset.listPosition || "0")
    );

    let position: number;
    if (insertIndex === 0) {
      position = (positions[0] ?? 1) / 2;
    } else if (insertIndex >= positions.length) {
      position = (positions[positions.length - 1] ?? 0) + 1;
    } else {
      position = (positions[insertIndex - 1] + positions[insertIndex]) / 2;
    }

    await api.updateList(listId, { position });
    refetch();
  };

  // --- Board color ---

  const handleSetBoardColor = async (color: string | null) => {
    const b = board();
    if (!b) return;
    await api.updateBoard(b.id, b.title, color);
    refetch();
    setShowColorPicker(false);
  };

  // --- Label management ---

  const handleCreateLabel = async (e: Event) => {
    e.preventDefault();
    const name = newLabelName().trim();
    if (!name) return;
    await api.createLabel(params.id, name);
    setNewLabelName("");
    refetch();
  };

  const handleDeleteLabel = async (labelId: string) => {
    await api.deleteLabel(labelId);
    refetch();
  };

  const startEditLabel = (labelId: string, currentName: string) => {
    setEditingLabelId(labelId);
    setEditingLabelName(currentName);
  };

  const handleUpdateLabel = async (labelId: string) => {
    const name = editingLabelName().trim();
    if (!name) {
      setEditingLabelId(null);
      return;
    }
    await api.updateLabel(labelId, name);
    setEditingLabelId(null);
    refetch();
  };

  const drawerInputKeyDown = (e: KeyboardEvent, onEnter: () => void) => {
    if (e.key === "Escape") { e.stopPropagation(); lc.close(); }
    if (e.key === "Enter") { e.preventDefault(); onEnter(); }
  };

  const wrapSelection = (input: HTMLInputElement, marker: string) => {
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
  };

  const labelInputKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      wrapSelection(e.currentTarget as HTMLInputElement, "**");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      e.preventDefault();
      wrapSelection(e.currentTarget as HTMLInputElement, "*");
    }
  };

  return (
    <div
      class="board-page"
      style={board()?.color ? { "background-color": board()!.color } : {}}
      onClick={() => showColorPicker() && setShowColorPicker(false)}
    >
      <Show when={board()} fallback={<div class="loading">Loading...</div>}>
        {(b) => (
          <>
            <div class="board-title-bar">
              <h2>{b().title}</h2>
              <div class="board-color-area" onClick={(e) => e.stopPropagation()}>
                <button
                  class="board-color-btn"
                  classList={{ "board-color-btn--active": showColorPicker() }}
                  onClick={() => setShowColorPicker((v) => !v)}
                  title="Board color"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.236 2.636 7.855 6.356 9.312C9.203 21.088 10 20.018 10 18.773v-1.12c-1.988.398-2.773-.506-3.084-1.154C6.664 15.956 6.232 15.665 5.8 15.4c-.388-.235-.04-.379.072-.367.574.08 1.028.558 1.39 1.086.27.397.566.784 1.004.784.452 0 .706-.123.852-.25.25-2.11 2.43-2.703 2.43-2.703s-1.548-.552-1.548-3v-.53C10 8.72 11.28 7 12 7s2 1.72 2 3.42v.53c0 2.448-1.548 3-1.548 3s2.18.592 2.43 2.703c.146.127.4.25.852.25.438 0 .734-.387 1.004-.784.362-.528.816-1.006 1.39-1.086.112-.012.46.132.072.367-.432.265-.864.556-1.116 1.099C16.773 17.147 15.988 18.051 14 17.653v1.12c0 1.245.797 2.315 1.644 2.539C19.364 19.855 22 16.236 22 12c0-5.523-4.477-10-10-10z" />
                  </svg>
                </button>
                <Show when={showColorPicker()}>
                  <div class="board-color-dropdown">
                    <div class="board-color-grid">
                      <For each={BOARD_COLORS}>
                        {(color) => (
                          <button
                            class="board-color-swatch"
                            classList={{ "board-color-swatch--active": b().color === color }}
                            style={{ "background-color": color }}
                            onClick={() => handleSetBoardColor(color)}
                            title={color}
                          >
                            <Show when={b().color === color}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                    <button
                      class="board-color-reset"
                      onClick={() => handleSetBoardColor(null)}
                    >
                      Reset to default
                    </button>
                  </div>
                </Show>
              </div>
            </div>
            <div
              class="lists-container"
              onDragOver={handleListDragOver}
              onDrop={handleListDrop}
            >
              <For each={b().lists}>
                {(list) => (
                  <List
                    list={list}
                    labels={b().labels}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteList={handleDeleteList}
                    onCardClick={handleCardClick}
                    onDropCard={handleDropCard}
                    onMoveCard={handleMoveCard}
                  />
                )}
              </For>
              <div class="add-list-wrapper">
                <AddForm
                  placeholder="List title..."
                  buttonText="Add list"
                  onAdd={handleAddList}
                />
              </div>
            </div>

            {/* Right-side label drawer */}
            <div class="label-drawer" classList={{ "label-drawer--open": lc.isOpen() }}>
              <div class="label-drawer-header">
                <span>Labels</span>
                <button class="label-drawer-close" onClick={lc.close} title="Close">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div class="label-drawer-list">
                <For
                  each={b().labels}
                  fallback={
                    <p class="label-drawer-empty">
                      No labels yet. Create one below.
                    </p>
                  }
                >
                  {(label) => (
                    <div class="label-drawer-item">
                      <Show
                        when={editingLabelId() === label.id}
                        fallback={
                          <>
                            <span
                              class="label-drawer-swatch"
                              style={{ "background-color": label.color }}
                            />
                            <span
                              class="label-drawer-name"
                              innerHTML={label.name.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>")}
                              onClick={() => startEditLabel(label.id, label.name)}
                              title="Click to rename"
                            />
                            <button
                              class="label-drawer-delete"
                              onClick={() => handleDeleteLabel(label.id)}
                              title="Delete label"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </>
                        }
                      >
                        <span
                          class="label-drawer-swatch"
                          style={{ "background-color": label.color }}
                        />
                        <input
                          ref={(el) => requestAnimationFrame(() => el.focus())}
                          class="label-drawer-edit-input"
                          type="text"
                          value={editingLabelName()}
                          onInput={(e) => setEditingLabelName(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            labelInputKeyDown(e);
                            if (e.key === "Enter") handleUpdateLabel(label.id);
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditingLabelId(null);
                            }
                          }}
                          onBlur={() => handleUpdateLabel(label.id)}
                        />
                      </Show>
                    </div>
                  )}
                </For>
              </div>

              <form class="label-drawer-form" onSubmit={handleCreateLabel}>
                <input
                  type="text"
                  placeholder="New label name… (**bold** *italic*)"
                  value={newLabelName()}
                  onInput={(e) => setNewLabelName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    labelInputKeyDown(e);
                    drawerInputKeyDown(e, () => { /* submit via form */ });
                    if (e.key === "Escape") { e.stopPropagation(); lc.close(); }
                  }}
                  class="label-drawer-input"
                />
                <button type="submit" class="btn btn-primary btn-sm">
                  Add
                </button>
              </form>
            </div>

            {/* Backdrop */}
            <Show when={lc.isOpen()}>
              <div class="label-drawer-backdrop" onClick={lc.close} />
            </Show>
          </>
        )}
      </Show>

      <Show when={selectedCard()}>
        {(card) => (
          <CardDetail
            card={card()}
            boardLabels={board()?.labels ?? []}
            onSave={handleCardSave}
            onClose={handleModalClose}
          />
        )}
      </Show>

      <Show when={showHelp()}>
        <ShortcutHelp onClose={() => setShowHelp(false)} />
      </Show>
    </div>
  );
}
