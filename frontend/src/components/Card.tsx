import { For, Show } from "solid-js";
import type { Card as CardType, Label } from "../types";

interface Props {
  card: CardType;
  labels: Label[];
  onDelete: (id: string) => void;
  onClick: (card: CardType) => void;
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

  const handleKeyDown = (e: KeyboardEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onClick(props.card);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      props.onDelete(props.card.id);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      let next = el.nextElementSibling as HTMLElement | null;
      while (next && !next.classList.contains("card")) {
        next = next.nextElementSibling as HTMLElement | null;
      }
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      let prev = el.previousElementSibling as HTMLElement | null;
      while (prev && !prev.classList.contains("card")) {
        prev = prev.previousElementSibling as HTMLElement | null;
      }
      prev?.focus();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const currentList = el.closest(".list") as HTMLElement | null;
      const nextList = currentList?.nextElementSibling as HTMLElement | null;
      if (nextList?.classList.contains("list")) {
        const firstCard = nextList.querySelector(".card") as HTMLElement | null;
        firstCard ? firstCard.focus() : (nextList as HTMLElement).focus();
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const currentList = el.closest(".list") as HTMLElement | null;
      const prevList = currentList?.previousElementSibling as HTMLElement | null;
      if (prevList?.classList.contains("list")) {
        const firstCard = prevList.querySelector(".card") as HTMLElement | null;
        firstCard ? firstCard.focus() : (prevList as HTMLElement).focus();
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
      <Show when={cardLabels().length > 0}>
        <div class="card-labels">
          <For each={cardLabels()}>
            {(label) => (
              <span
                class="card-label-chip"
                style={{ "background-color": label.color }}
                title={label.name}
              >
                {label.name}
              </span>
            )}
          </For>
        </div>
      </Show>
      <div class="card-content">
        <span class="card-title">{props.card.title}</span>
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
