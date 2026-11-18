import { For, Show } from "solid-js";
import type { Card as CardType, Label, ListWithCards } from "../types";
import Card, { type SideKey } from "./Card";
import AddForm from "./AddForm";
import QuickAddPreview from "./QuickAddPreview";
import { parseQuickAdd } from "../quickAdd";
import { tip } from "../platform";
import { focusAdjacentList } from "../listFocus";

interface Props {
  list: ListWithCards;
  labels: Label[];
  renamingListId: string | null;
  onAddCard: (listId: string, title: string) => void | Promise<void>;
  onArchiveCard: (cardId: string) => void;
  onDeleteList: (listId: string) => void;
  onCardClick: (card: CardType, byKey?: boolean) => void;
  onDropCard: (cardId: string, targetListId: string, position: number) => void;
  onMoveCard: (cardId: string, targetListId: string, position: number) => void;
  onMoveList: (listId: string, position: number) => void;
  onRequestRename: (listId: string | null) => void;
  onRenameList: (listId: string, title: string) => void;
  /// Notes mode (ADR-0022): the card shown in the detail pane.
  selectedCardId?: string | null;
  onSideKey?: (card: CardType, dir: -1 | 1, kind: SideKey) => void;
  /// Notes mode: the tab is the list's title (and rename/delete).
  hideHeader?: boolean;
  /// Hint shown when the list has no (matching) cards.
  emptyText?: string;
  /// Cards before filtering (the header shows "shown/total" while filtering).
  total?: number;
  /// Board view: collapse to a narrow strip / expand again.
  onToggleCollapse?: (listId: string, collapsed: boolean) => void;
}

export default function List(props: Props) {
  // Enter/Esc settle a rename; the blur from the input unmounting mustn't commit again.
  let settled = false;
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

  const count = () => {
    const n = props.list.cards.length;
    return props.total !== undefined && props.total !== n ? `${n}/${props.total}` : `${n}`;
  };
  const maxPosition = () => props.list.cards.reduce((m, c) => Math.max(m, c.position), 0);
  const collapsed = () => props.list.collapsed && !props.hideHeader;

  return (
    <Show when={!collapsed()} fallback={
      <div
        class="list list--collapsed"
        draggable={true}
        onDragStart={handleListDragStart}
        onDragEnd={handleListDragEnd}
        // A card dropped on the strip goes to the end of the list.
        onDragOver={(e) => {
          if (!e.dataTransfer?.types.includes("application/card-id")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          e.currentTarget.classList.add("list--drop");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("list--drop")}
        onDrop={(e) => {
          e.currentTarget.classList.remove("list--drop");
          const cardId = e.dataTransfer?.getData("application/card-id");
          if (!cardId) return;
          e.preventDefault();
          document.querySelector(".drop-placeholder")?.remove();
          props.onDropCard(cardId, props.list.id, maxPosition() + 1);
        }}
        data-list-id={props.list.id}
        data-list-position={props.list.position}
        data-max-position={maxPosition()}
      >
        <button
          class="list-expand"
          aria-expanded="false"
          title={tip(`Expand “${props.list.title}”`, "C")}
          onClick={() => props.onToggleCollapse?.(props.list.id, false)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            e.stopPropagation();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") return;
            const list = e.currentTarget.closest(".list");
            const adj = e.key === "ArrowLeft" ? list?.previousElementSibling : list?.nextElementSibling;
            if (adj?.classList.contains("list")) focusAdjacentList(adj, null, e.key === "ArrowLeft");
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="list-count">{count()}</span>
          <span class="list-collapsed-title">{props.list.title}</span>
        </button>
      </div>
    }>
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
      <Show when={!props.hideHeader}>
      <div class="list-header">
        <Show
          when={props.renamingListId === props.list.id}
          fallback={
            <>
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
              title={tip("Click or press Enter to rename", "R")}
            >
              {props.list.title}
            </h3>
            <span class="list-count" title="Cards">{count()}</span>
            </>
          }
        >
          <input
            ref={(el) => {
              settled = false;
              requestAnimationFrame(() => { el.focus(); el.select(); });
            }}
            class="list-title-input"
            type="text"
            value={props.list.title}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                settled = true;
                props.onRenameList(props.list.id, e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                settled = true;
                props.onRequestRename(null);
              }
            }}
            onBlur={(e) => !settled && props.onRenameList(props.list.id, e.currentTarget.value)}
          />
        </Show>
        <Show when={props.onToggleCollapse}>
          <button
            class="list-collapse"
            title={tip("Collapse list", "C")}
            aria-expanded="true"
            onClick={() => props.onToggleCollapse!(props.list.id, true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </Show>
        <button
          class="list-delete"
          title="Delete list"
          onClick={() => props.onDeleteList(props.list.id)}
        >
          &times;
        </button>
      </div>
      </Show>
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
              selected={props.selectedCardId === card.id}
              onSideKey={props.onSideKey}
            />
          )}
        </For>
        <Show when={props.emptyText && props.list.cards.length === 0}>
          <p class="list-empty">{props.emptyText}</p>
        </Show>
      </div>
      <AddForm
        placeholder="Card title… #label due:fri"
        buttonText="Add card"
        shortcut="N"
        draftKey={`card:${props.list.id}`}
        onAdd={(title) => props.onAddCard(props.list.id, title)}
        valid={(v) => !!parseQuickAdd(v, props.labels).title}
        preview={(v) => <QuickAddPreview text={v} labels={props.labels} />}
      />
    </div>
    </Show>
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
