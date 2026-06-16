import { For, Show } from "solid-js";
import type { Card as CardType, Label, ListWithCards } from "../types";
import Card from "./Card";
import AddForm from "./AddForm";

interface Props {
  list: ListWithCards;
  labels: Label[];
  renamingListId: string | null;
  onAddCard: (listId: string, title: string) => void;
  onArchiveCard: (cardId: string) => void;
  onDeleteList: (listId: string) => void;
  onCardClick: (card: CardType) => void;
  onDropCard: (cardId: string, targetListId: string, position: number) => void;
  onMoveCard: (cardId: string, targetListId: string, position: number) => void;
  onMoveList: (listId: string, position: number) => void;
  onRequestRename: (listId: string | null) => void;
  onRenameList: (listId: string, title: string) => void;
}

export default function List(props: Props) {
  const handleDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("application/card-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const container = e.currentTarget as HTMLElement;
    const cardsContainer = container.querySelector(".cards-container")!;
    const cardElements = cardsContainer.querySelectorAll(
      ".card:not(.dragging)"
    );
    const afterElement = getDragAfterElement(cardElements, e.clientY);

    let placeholder = document.querySelector(".drop-placeholder");
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "drop-placeholder";
    }

    if (afterElement) {
      cardsContainer.insertBefore(placeholder, afterElement);
    } else {
      cardsContainer.appendChild(placeholder);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const cardId = e.dataTransfer?.getData("application/card-id");
    if (!cardId) return;

    const container = (e.currentTarget as HTMLElement).querySelector(
      ".cards-container"
    )!;
    const placeholder = container.querySelector(".drop-placeholder");
    if (!placeholder) return;

    const allElements = Array.from(container.children);
    const idx = allElements.indexOf(placeholder);

    let prevCard: HTMLElement | null = null;
    let nextCard: HTMLElement | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      const el = allElements[i] as HTMLElement;
      if (el.classList.contains("card") && !el.classList.contains("dragging")) {
        prevCard = el;
        break;
      }
    }
    for (let i = idx + 1; i < allElements.length; i++) {
      const el = allElements[i] as HTMLElement;
      if (el.classList.contains("card") && !el.classList.contains("dragging")) {
        nextCard = el;
        break;
      }
    }

    const prevPos = prevCard
      ? parseFloat(prevCard.dataset.cardPosition || "0")
      : 0;
    const nextPos = nextCard
      ? parseFloat(nextCard.dataset.cardPosition || "0")
      : prevPos + 2;

    placeholder.remove();
    props.onDropCard(cardId, props.list.id, (prevPos + nextPos) / 2);
  };

  const handleListDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData("application/list-id", props.list.id);
    e.dataTransfer!.effectAllowed = "move";
    const el = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => el.classList.add("list-dragging"));
  };

  const handleListDragEnd = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("list-dragging");
    document.querySelectorAll(".list-drop-placeholder").forEach((el) => el.remove());
  };

  return (
    <div
      class="list"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      draggable={true}
      onDragStart={handleListDragStart}
      onDragEnd={handleListDragEnd}
      data-list-id={props.list.id}
      data-list-position={props.list.position}
    >
      <div class="list-header">
        <Show
          when={props.renamingListId === props.list.id}
          fallback={
            <h3
              class="list-title"
              tabindex="0"
              onClick={() => props.onRequestRename(props.list.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "F2" || e.key === "r") {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onRequestRename(props.list.id);
                }
              }}
              title="Click or press Enter to rename"
            >
              {props.list.title}
            </h3>
          }
        >
          <input
            ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
            class="list-title-input"
            type="text"
            value={props.list.title}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                props.onRenameList(props.list.id, e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                props.onRequestRename(null);
              }
            }}
            onBlur={(e) => props.onRenameList(props.list.id, e.currentTarget.value)}
          />
        </Show>
        <button
          class="list-delete"
          onClick={() => props.onDeleteList(props.list.id)}
        >
          &times;
        </button>
      </div>
      <div class="cards-container">
        <For each={props.list.cards}>
          {(card) => (
            <Card
              card={card}
              labels={props.labels}
              onArchive={props.onArchiveCard}
              onClick={props.onCardClick}
              onMove={props.onMoveCard}
              onMoveList={props.onMoveList}
            />
          )}
        </For>
      </div>
      <AddForm
        placeholder="Card title..."
        buttonText="Add card"
        draftKey={`card:${props.list.id}`}
        onAdd={(title) => props.onAddCard(props.list.id, title)}
      />
    </div>
  );
}

function getDragAfterElement(
  elements: NodeListOf<Element>,
  y: number
): Element | null {
  let closest: { offset: number; element: Element | null } = {
    offset: Number.POSITIVE_INFINITY,
    element: null,
  };

  elements.forEach((child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > -closest.offset) {
      closest = { offset: -offset, element: child };
    }
  });

  return closest.element;
}
