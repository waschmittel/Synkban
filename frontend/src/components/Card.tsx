import { For, Show } from "solid-js";
import type { Card as CardType, Label } from "../types";

interface Props {
  card: CardType;
  labels: Label[];
  onDelete: (id: string) => void;
  onClick: (card: CardType) => void;
  onMove: (cardId: string, targetListId: string, position: number) => void;
}

export function renderTitle(title: string): string {
  return title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

export default function Card(props: Props) {
  const handleDragStart = (e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer!.setData("application/card-id", props.card.id);
    e.dataTransfer!.setData("application/source-list", props.card.list_id);
    e.dataTransfer!.effectAllowed = "move";
    const el = e.target as HTMLElement;
    requestAnimationFrame(() => el.classList.add("dragging"));
  };

  const handleDragEnd = (e: DragEvent) => {
    (e.target as HTMLElement).classList.remove("dragging");
    document.querySelectorAll(".drop-placeholder").forEach((el) => el.remove());
  };

  const focusAddTrigger = (list: Element | null) => {
    const trigger = list?.querySelector(".add-trigger") as HTMLElement | null;
    trigger?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const el = e.currentTarget as HTMLElement;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onClick(props.card);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      props.onDelete(props.card.id);
      return;
    }

    const currentList = el.closest(".list") as HTMLElement | null;

    if (e.shiftKey) {
      // Move card
      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Find next visible card sibling
        let next = el.nextElementSibling as HTMLElement | null;
        while (next && !next.classList.contains("card")) next = next.nextElementSibling as HTMLElement | null;
        if (!next) return;
        // Position: between next and next.next
        let afterNext = next.nextElementSibling as HTMLElement | null;
        while (afterNext && !afterNext.classList.contains("card")) afterNext = afterNext.nextElementSibling as HTMLElement | null;
        const p1 = parseFloat(next.dataset.cardPosition || "0");
        const p2 = afterNext ? parseFloat(afterNext.dataset.cardPosition || "0") : p1 + 2;
        props.onMove(props.card.id, props.card.list_id, (p1 + p2) / 2);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        let prev = el.previousElementSibling as HTMLElement | null;
        while (prev && !prev.classList.contains("card")) prev = prev.previousElementSibling as HTMLElement | null;
        if (!prev) return;
        let beforePrev = prev.previousElementSibling as HTMLElement | null;
        while (beforePrev && !beforePrev.classList.contains("card")) beforePrev = beforePrev.previousElementSibling as HTMLElement | null;
        const p1 = beforePrev ? parseFloat(beforePrev.dataset.cardPosition || "0") : 0;
        const p2 = parseFloat(prev.dataset.cardPosition || "0");
        props.onMove(props.card.id, props.card.list_id, (p1 + p2) / 2);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const nextList = currentList?.nextElementSibling as HTMLElement | null;
        if (!nextList?.classList.contains("list")) return;
        const targetListId = nextList.dataset.listId!;
        const cards = nextList.querySelectorAll(".card");
        const lastCard = cards[cards.length - 1] as HTMLElement | null;
        const pos = lastCard ? parseFloat(lastCard.dataset.cardPosition || "0") + 1 : 1;
        props.onMove(props.card.id, targetListId, pos);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const prevList = currentList?.previousElementSibling as HTMLElement | null;
        if (!prevList?.classList.contains("list")) return;
        const targetListId = prevList.dataset.listId!;
        const cards = prevList.querySelectorAll(".card");
        const lastCard = cards[cards.length - 1] as HTMLElement | null;
        const pos = lastCard ? parseFloat(lastCard.dataset.cardPosition || "0") + 1 : 1;
        props.onMove(props.card.id, targetListId, pos);
        return;
      }
    }

    // Navigation (no shift)
    if (e.key === "ArrowDown") {
      e.preventDefault();
      let next = el.nextElementSibling as HTMLElement | null;
      while (next && !next.classList.contains("card")) next = next.nextElementSibling as HTMLElement | null;
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      let prev = el.previousElementSibling as HTMLElement | null;
      while (prev && !prev.classList.contains("card")) prev = prev.previousElementSibling as HTMLElement | null;
      prev?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextList = currentList?.nextElementSibling as HTMLElement | null;
      if (nextList?.classList.contains("list")) {
        const firstCard = nextList.querySelector(".card") as HTMLElement | null;
        firstCard ? firstCard.focus() : focusAddTrigger(nextList);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevList = currentList?.previousElementSibling as HTMLElement | null;
      if (prevList?.classList.contains("list")) {
        const firstCard = prevList.querySelector(".card") as HTMLElement | null;
        firstCard ? firstCard.focus() : focusAddTrigger(prevList);
      }
    }
  };

  const cardLabels = () =>
    props.labels.filter((l) => props.card.label_ids?.includes(l.id));

  const hasDescription = () => !!props.card.description;

  return (
    <div
      class="card"
      tabindex="0"
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => props.onClick(props.card)}
      onKeyDown={handleKeyDown}
      data-card-id={props.card.id}
      data-card-position={props.card.position}
    >
      <div class="card-main">
        <Show when={cardLabels().length > 0}>
          <div class="card-labels">
            <For each={cardLabels()}>
              {(label) => (
                <span
                  class="card-label-chip"
                  style={{ "background-color": label.color }}
                  title={label.name}
                  innerHTML={renderTitle(label.name)}
                />
              )}
            </For>
          </div>
        </Show>
        <div class="card-content">
          <span class="card-title" innerHTML={renderTitle(props.card.title)} />
          <Show when={hasDescription()}>
            <div class="card-badges">
              <span class="card-badge" title="Has description">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="17" y1="10" x2="3" y2="10" />
                  <line x1="21" y1="6" x2="3" y2="6" />
                  <line x1="21" y1="14" x2="3" y2="14" />
                  <line x1="17" y1="18" x2="3" y2="18" />
                </svg>
              </span>
            </div>
          </Show>
        </div>
      </div>
      <div class="card-actions">
        <button
          class="card-edit"
          onClick={(e) => {
            e.stopPropagation();
            props.onClick(props.card);
          }}
          title="Edit card"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        </button>
        <button
          class="card-delete"
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete(props.card.id);
          }}
          title="Delete card"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
