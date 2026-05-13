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

  const handleCardSave = async (id: string, title: string, description: string) => {
    await api.updateCard(id, { title, description });
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
            onSave={handleCardSave}
            onClose={() => setSelectedCard(null)}
          />
        )}
      </Show>
    </div>
  );
}
