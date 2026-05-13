import { createResource, createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { useParams } from "@solidjs/router";
import { api } from "../api";
import type { Card as CardType } from "../types";
import List from "../components/List";
import AddForm from "../components/AddForm";
import CardDetail from "../components/CardDetail";

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const [board, { refetch }] = createResource(
    () => params.id,
    (id) => api.getBoard(id)
  );
  const [selectedCard, setSelectedCard] = createSignal<CardType | null>(null);
  const [showLabelPanel, setShowLabelPanel] = createSignal(false);
  const [newLabelName, setNewLabelName] = createSignal("");
  const [editingLabelId, setEditingLabelId] = createSignal<string | null>(null);
  const [editingLabelName, setEditingLabelName] = createSignal("");

  let lastMtime = 0;
  onMount(() => {
    const id = setInterval(async () => {
      try {
        const { mtime } = await api.checkChanges();
        if (mtime !== lastMtime) {
          lastMtime = mtime;
          refetch();
        }
      } catch { /* ignore poll errors */ }
    }, 15000);
    onCleanup(() => clearInterval(id));
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

  const handleCardClick = (card: CardType) => {
    setSelectedCard(card);
  };

  const handleCardSave = async (id: string, title: string, description: string, labelIds: string[]) => {
    await api.updateCard(id, { title, description, label_ids: labelIds });
    setSelectedCard(null);
    refetch();
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
    document.querySelectorAll(".list-drop-placeholder").forEach((el) => el.remove());

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
    if (!name) return;
    await api.updateLabel(labelId, name);
    setEditingLabelId(null);
    refetch();
  };

  return (
    <div class="board-page">
      <Show when={board()} fallback={<div class="loading">Loading...</div>}>
        {(b) => (
          <>
            <div class="board-title-bar">
              <h2>{b().title}</h2>
              <div class="board-kbd-hint">
                <span><kbd>↑↓</kbd> navigate cards</span>
                <span><kbd>←→</kbd> switch list</span>
                <span><kbd>Enter</kbd> open card</span>
                <span><kbd>Del</kbd> delete card</span>
              </div>
              <button
                class="btn btn-board-labels"
                onClick={() => setShowLabelPanel((v) => !v)}
                title="Manage labels"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
                Labels
              </button>
              <Show when={showLabelPanel()}>
                <div class="label-panel">
                  <div class="label-panel-header">
                    <span>Board Labels</span>
                    <button class="label-panel-close" onClick={() => setShowLabelPanel(false)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <div class="label-panel-list">
                    <For each={b().labels} fallback={<p class="label-panel-empty">No labels yet</p>}>
                      {(label) => (
                        <div class="label-panel-item">
                          <Show
                            when={editingLabelId() === label.id}
                            fallback={
                              <>
                                <span
                                  class="label-panel-swatch"
                                  style={{ "background-color": label.color }}
                                />
                                <span
                                  class="label-panel-name"
                                  onClick={() => startEditLabel(label.id, label.name)}
                                  title="Click to rename"
                                >
                                  {label.name}
                                </span>
                                <button
                                  class="label-panel-delete"
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
                            <input
                              ref={(el) => requestAnimationFrame(() => el.focus())}
                              class="label-panel-edit-input"
                              type="text"
                              value={editingLabelName()}
                              onInput={(e) => setEditingLabelName(e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleUpdateLabel(label.id);
                                if (e.key === "Escape") setEditingLabelId(null);
                              }}
                              onBlur={() => handleUpdateLabel(label.id)}
                            />
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                  <form class="label-panel-form" onSubmit={handleCreateLabel}>
                    <input
                      type="text"
                      placeholder="New label name..."
                      value={newLabelName()}
                      onInput={(e) => setNewLabelName(e.currentTarget.value)}
                      class="label-panel-input"
                    />
                    <button type="submit" class="btn btn-primary btn-sm">Add</button>
                  </form>
                </div>
              </Show>
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
          </>
        )}
      </Show>
      <Show when={selectedCard()}>
        {(card) => (
          <CardDetail
            card={card()}
            boardLabels={board()?.labels ?? []}
            onSave={handleCardSave}
            onClose={() => setSelectedCard(null)}
          />
        )}
      </Show>
    </div>
  );
}
