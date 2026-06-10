import { For, Show } from "solid-js";
import type { Card as CardType, Label } from "../types";
import { crossListInsertPosition, listDropPosition, withinListMoveDown, withinListMoveUp } from "../positions";

interface Props {
  card: CardType;
  labels: Label[];
  onArchive: (id: string) => void;
  onClick: (card: CardType) => void;
  onMove: (cardId: string, targetListId: string, position: number) => void;
  onMoveList: (listId: string, position: number) => void;
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
      props.onArchive(props.card.id);
      return;
    }

    const currentList = el.closest(".list") as HTMLElement | null;

    // Shift+Alt+Left/Right: reorder list itself (preserve focus on the same card).
    if (e.shiftKey && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      e.stopPropagation();
      if (!currentList) return;
      const container = currentList.parentElement;
      if (!container) return;
      const lists = Array.from(container.querySelectorAll<HTMLElement>(".list"));
      const idx = lists.indexOf(currentList);
      if (e.key === "ArrowLeft" && idx <= 0) return;
      if (e.key === "ArrowRight" && idx >= lists.length - 1) return;
      const otherPositions = lists
        .filter((_, i) => i !== idx)
        .map((l) => parseFloat(l.dataset.listPosition || "0"));
      const insertAt = e.key === "ArrowLeft" ? idx - 1 : idx + 1;
      const newPos = listDropPosition(otherPositions, insertAt);
      props.onMoveList(currentList.dataset.listId!, newPos);
      return;
    }

    if (e.shiftKey) {
      // Move card
      if (e.key === "ArrowDown") {
        e.preventDefault();
        let next = el.nextElementSibling as HTMLElement | null;
        while (next && !next.classList.contains("card")) next = next.nextElementSibling as HTMLElement | null;
        if (!next) return;
        let afterNext = next.nextElementSibling as HTMLElement | null;
        while (afterNext && !afterNext.classList.contains("card")) afterNext = afterNext.nextElementSibling as HTMLElement | null;
        const nextPos = parseFloat(next.dataset.cardPosition || "0");
        const afterNextPos = afterNext ? parseFloat(afterNext.dataset.cardPosition || "0") : undefined;
        props.onMove(props.card.id, props.card.list_id, withinListMoveDown(nextPos, afterNextPos));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        let prev = el.previousElementSibling as HTMLElement | null;
        while (prev && !prev.classList.contains("card")) prev = prev.previousElementSibling as HTMLElement | null;
        if (!prev) return;
        let beforePrev = prev.previousElementSibling as HTMLElement | null;
        while (beforePrev && !beforePrev.classList.contains("card")) beforePrev = beforePrev.previousElementSibling as HTMLElement | null;
        const prevPos = parseFloat(prev.dataset.cardPosition || "0");
        const beforePrevPos = beforePrev ? parseFloat(beforePrev.dataset.cardPosition || "0") : undefined;
        props.onMove(props.card.id, props.card.list_id, withinListMoveUp(prevPos, beforePrevPos));
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const adjList = (e.key === "ArrowRight"
          ? currentList?.nextElementSibling
          : currentList?.previousElementSibling) as HTMLElement | null;
        if (!adjList?.classList.contains("list")) return;
        const targetListId = adjList.dataset.listId!;
        const curCards = Array.from(currentList!.querySelectorAll<HTMLElement>(".card"));
        const curIdx = curCards.indexOf(el);
        const adjPositions = Array.from(adjList.querySelectorAll<HTMLElement>(".card"))
          .map((c) => parseFloat(c.dataset.cardPosition || "0"));
        props.onMove(props.card.id, targetListId, crossListInsertPosition(adjPositions, curIdx));
        return;
      }
    }

    // Navigation (no shift)
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      let next = el.nextElementSibling as HTMLElement | null;
      while (next && !next.classList.contains("card")) next = next.nextElementSibling as HTMLElement | null;
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      let prev = el.previousElementSibling as HTMLElement | null;
      while (prev && !prev.classList.contains("card")) prev = prev.previousElementSibling as HTMLElement | null;
      prev?.focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      // stopPropagation: prevent doc-level navigateArrow from running after
      // we focus an add-trigger on an empty adjacent list, which would skip
      // ahead to the next list.
      e.stopPropagation();
      const adjList = (e.key === "ArrowRight"
        ? currentList?.nextElementSibling
        : currentList?.previousElementSibling) as HTMLElement | null;
      if (adjList?.classList.contains("list")) {
        const curCards = Array.from(currentList!.querySelectorAll<HTMLElement>(".card"));
        const curIdx = curCards.indexOf(el);
        const adjCards = adjList.querySelectorAll<HTMLElement>(".card");
        if (adjCards.length > 0) {
          adjCards[Math.min(curIdx, adjCards.length - 1)].focus();
        } else {
          focusAddTrigger(adjList);
        }
      }
    }
  };

  const cardLabels = () =>
    props.labels.filter((l) => props.card.label_ids?.includes(l.id));

  const hasDescription = () => !!props.card.description;
  const hasAttachments = () => (props.card.attachments?.length ?? 0) > 0;

  const getDueDateDisplay = () => {
    const dd = props.card.due_date;
    if (!dd) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const due = new Date(dd + "T00:00:00");
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return { text: `Overdue ${-diffDays}d`, cls: "due-badge--overdue" };
    if (diffDays === 0) return { text: "Today", cls: "due-badge--today" };
    if (diffDays === 1) return { text: "Tomorrow", cls: "due-badge--soon" };
    return { text: `in ${diffDays}d`, cls: "due-badge--future" };
  };

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
          <Show when={hasDescription() || hasAttachments() || getDueDateDisplay()}>
            <div class="card-badges">
              <Show when={getDueDateDisplay()}>
                {(dd) => (
                  <span class={`due-badge ${dd().cls}`} title={`Due: ${props.card.due_date}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    {dd().text}
                  </span>
                )}
              </Show>
              <Show when={hasDescription()}>
                <span class="card-badge" title="Has description">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="17" y1="10" x2="3" y2="10" />
                    <line x1="21" y1="6" x2="3" y2="6" />
                    <line x1="21" y1="14" x2="3" y2="14" />
                    <line x1="17" y1="18" x2="3" y2="18" />
                  </svg>
                </span>
              </Show>
              <Show when={hasAttachments()}>
                <span class="card-badge" title={`${props.card.attachments.length} attachment(s)`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  {props.card.attachments.length}
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <div class="card-actions">
        <button
          class="card-archive"
          onClick={(e) => {
            e.stopPropagation();
            props.onArchive(props.card.id);
          }}
          title="Archive card"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
