import { For } from "solid-js";
import type { Card as CardType, ListWithCards } from "../types";
import Card from "./Card";
import AddForm from "./AddForm";

interface Props {
  list: ListWithCards;
  onAddCard: (listId: string, title: string) => void;
  onDeleteCard: (cardId: string) => void;
  onDeleteList: (listId: string) => void;
  onCardClick: (card: CardType) => void;
  onDropCard: (
    cardId: string,
    targetListId: string,
    position: number
  ) => void;
}

export default function List(props: Props) {
  const handleDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("application/card-id")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const container = e.currentTarget as HTMLElement;
      const cardElements = container.querySelectorAll(
        ".cards-container .card:not(.dragging)"
      );
      const afterElement = getDragAfterElement(cardElements, e.clientY);
      const dragging = document.querySelector(".card.dragging");

      if (dragging) {
        const cardsContainer = container.querySelector(".cards-container")!;
        if (afterElement) {
          cardsContainer.insertBefore(dragging, afterElement);
        } else {
          cardsContainer.appendChild(dragging);
        }
      }
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const cardId = e.dataTransfer?.getData("application/card-id");
    if (!cardId) return;

    const container = (e.currentTarget as HTMLElement).querySelector(
      ".cards-container"
    )!;
    const cardElements = Array.from(
      container.querySelectorAll(".card:not(.dragging)")
    );
    const dragging = container.querySelector(".card.dragging");

    let position: number;
    if (!dragging) return;

    const allCards = Array.from(container.querySelectorAll(".card"));
    const dragIndex = allCards.indexOf(dragging);

    const prevCard = allCards[dragIndex - 1] as HTMLElement | undefined;
    const nextCard = allCards[dragIndex + 1] as HTMLElement | undefined;

    const prevPos = prevCard
      ? parseFloat(prevCard.dataset.cardPosition || "0")
      : 0;
    const nextPos = nextCard
      ? parseFloat(nextCard.dataset.cardPosition || "0")
      : prevPos + 2;

    position = (prevPos + nextPos) / 2;

    props.onDropCard(cardId, props.list.id, position);
  };

  const handleListDragStart = (e: DragEvent) => {
    e.dataTransfer!.setData("application/list-id", props.list.id);
    e.dataTransfer!.effectAllowed = "move";
    (e.currentTarget as HTMLElement).classList.add("list-dragging");
  };

  const handleListDragEnd = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("list-dragging");
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
        <h3 class="list-title">{props.list.title}</h3>
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
            <Card card={card} onDelete={props.onDeleteCard} onClick={props.onCardClick} />
          )}
        </For>
      </div>
      <AddForm
        placeholder="Card title..."
        buttonText="Add card"
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
