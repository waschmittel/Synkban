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

  // Label panel state (rendered in drawer, managed by context)
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
        } else {
          lc.close();
          const focused = document.activeElement as HTMLElement | null;
          if (focused?.classList.contains("card")) focused.blur();
        }
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

  return (
    <div class="board-page">
      <Show when={board()} fallback={<div class="loading">Loading...</div>}>
        {(b) => (
          <>
            <div class="board-title-bar">
              <h2>{b().title}</h2>
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

            {/* Right-side label drawer — always rendered for CSS transition */}
            <div class="label-drawer" classList={{ "label-drawer--open": lc.isOpen() }}>
              <div class="label-drawer-header">
                <span>Labels</span>
                <button class="label-drawer-close" onClick={lc.close} title="Close">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
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
                              onClick={() =>
                                startEditLabel(label.id, label.name)
                              }
                              title="Click to rename"
                            >
                              {label.name}
                            </span>
                            <button
                              class="label-drawer-delete"
                              onClick={() => handleDeleteLabel(label.id)}
                              title="Delete label"
                            >
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                              >
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
                          onInput={(e) =>
                            setEditingLabelName(e.currentTarget.value)
                          }
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

              <form class="label-drawer-form" onSubmit={handleCreateLabel}>
                <input
                  type="text"
                  placeholder="New label name…"
                  value={newLabelName()}
                  onInput={(e) => setNewLabelName(e.currentTarget.value)}
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
