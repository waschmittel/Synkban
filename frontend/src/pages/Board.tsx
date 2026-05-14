import {
  createResource,
  createSignal,
  createEffect,
  untrack,
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
import { renderTitle } from "../components/Card";

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
    !!el.closest(".shortcut-help-overlay") ||
    !!el.closest(".archive-overlay") ||
    !!el.closest(".filter-bar")
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
  const [pendingFocusCardId, setPendingFocusCardId] = createSignal<string | null>(null);

  // Archive state
  const [confirmArchiveCardId, setConfirmArchiveCardId] = createSignal<string | null>(null);
  const [showArchive, setShowArchive] = createSignal(false);
  const [archivedCards, setArchivedCards] = createSignal<CardType[]>([]);
  const [archiveLoading, setArchiveLoading] = createSignal(false);
  const [confirmDeleteCardId, setConfirmDeleteCardId] = createSignal<string | null>(null);
  const [confirmDeleteListId, setConfirmDeleteListId] = createSignal<string | null>(null);

  // Board rename state
  const [showRename, setShowRename] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal("");

  // Filter state
  const [showFilterBar, setShowFilterBar] = createSignal(false);
  const [filterText, setFilterText] = createSignal("");
  const [filterLabelIds, setFilterLabelIds] = createSignal<string[]>([]);

  // Restore focus to a moved card after board resource re-renders.
  createEffect(() => {
    board(); // only dependency — fires after DOM update from refetch
    const cardId = untrack(pendingFocusCardId); // read without tracking
    if (!cardId) return;
    setPendingFocusCardId(null);
    requestAnimationFrame(() => {
      (document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null)?.focus();
    });
  });

  // Sync --board-color CSS variable to header and body.
  createEffect(() => {
    const color = board()?.color ?? "#0079bf";
    document.documentElement.style.setProperty("--board-color", color);
  });

  createEffect(() => {
    const b = board();
    if (b) lc.setBoardTitle(b.title);
  });

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
          // Preserve focused card across refetch-triggered DOM recreation
          const focused = document.activeElement as HTMLElement | null;
          const cardId = focused?.dataset.cardId;
          if (cardId) setPendingFocusCardId(cardId);
          refetch();
        }
      } catch { /* ignore */ }
    }, 15000);

    const handleGlobalKey = (e: KeyboardEvent) => {
      if (isInInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Block global shortcuts when confirm dialog is open
      if (confirmArchiveCardId() || confirmDeleteListId()) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
      } else if (e.key === "Escape") {
        if (showHelp()) {
          setShowHelp(false);
        } else if (showArchive()) {
          setShowArchive(false);
        } else if (showColorPicker()) {
          setShowColorPicker(false);
        } else if (selectedCard()) {
          handleModalClose();
        } else if (showRename()) {
          cancelRename();
        } else {
          lc.close();
          const focused = document.activeElement as HTMLElement | null;
          if (focused?.classList.contains("card")) {
            const boardEl = document.querySelector(".board-page") as HTMLElement | null;
            boardEl?.focus();
          }
        }
      } else if (e.key === "f") {
        e.preventDefault();
        setShowFilterBar((v) => !v);
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
      } else if (e.key === "a") {
        e.preventDefault();
        if (showArchive()) {
          setShowArchive(false);
        } else {
          openArchive();
        }
      } else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key) && !e.shiftKey) {
        const focused = document.activeElement as HTMLElement | null;
        const isCard = focused?.classList.contains("card");
        const isCardListTrigger =
          focused?.classList.contains("add-trigger") &&
          !!focused.closest(".list") &&
          !focused.closest(".add-list-wrapper");

        if (!isCard && !isCardListTrigger) {
          e.preventDefault();
          const lists = document.querySelectorAll(".list");
          if (e.key === "ArrowDown" || e.key === "ArrowRight") {
            const firstList = lists[0];
            const firstCard = firstList?.querySelector<HTMLElement>(".card");
            if (firstCard) firstCard.focus();
            else firstList?.querySelector<HTMLElement>(".add-trigger")?.focus();
          } else {
            const lastList = lists[lists.length - 1];
            const cards = lastList?.querySelectorAll<HTMLElement>(".card");
            const lastCard = cards?.[cards.length - 1];
            if (lastCard) lastCard.focus();
            else lastList?.querySelector<HTMLElement>(".add-trigger")?.focus();
          }
        } else if (isCardListTrigger) {
          const currentList = focused!.closest(".list") as HTMLElement;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const adj = (e.key === "ArrowLeft"
              ? currentList.previousElementSibling
              : currentList.nextElementSibling) as HTMLElement | null;
            if (adj?.classList.contains("list")) {
              if (e.key === "ArrowRight") {
                const first = adj.querySelector<HTMLElement>(".card");
                first ? first.focus() : adj.querySelector<HTMLElement>(".add-trigger")?.focus();
              } else {
                const cards = adj.querySelectorAll<HTMLElement>(".card");
                const last = cards[cards.length - 1];
                last ? last.focus() : adj.querySelector<HTMLElement>(".add-trigger")?.focus();
              }
            }
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            const cards = currentList.querySelectorAll<HTMLElement>(".card");
            cards[cards.length - 1]?.focus();
          }
        }
      }
    };

    const handleToggleShortcuts = () => setShowHelp((v) => !v);
    const handleStartRename = () => startRename();

    document.addEventListener("keydown", handleGlobalKey);
    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    document.addEventListener("start-board-rename", handleStartRename as EventListener);

    onCleanup(() => {
      lc.setHasBoard(false);
      lc.setBoardTitle("");
      lc.close();
      clearInterval(pollId);
      document.removeEventListener("keydown", handleGlobalKey);
      document.removeEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
      document.removeEventListener("start-board-rename", handleStartRename as EventListener);
      document.documentElement.style.setProperty("--board-color", "#0079bf");
    });
  });

  // --- Board rename ---

  const startRename = () => {
    setRenameValue(board()?.title ?? "");
    setShowRename(true);
  };

  const commitRename = async () => {
    const name = renameValue().trim();
    const b = board();
    if (name && b && name !== b.title) {
      await api.updateBoard(b.id, { title: name });
      refetch();
    }
    setShowRename(false);
  };

  const cancelRename = () => setShowRename(false);

  // --- Archive ---

  const handleArchiveCard = (cardId: string) => {
    setConfirmArchiveCardId(cardId);
  };

  const confirmArchive = async () => {
    const id = confirmArchiveCardId();
    if (!id) return;
    await api.archiveCard(id);
    if (lastFocusedCardId() === id) setLastFocusedCardId(null);
    setConfirmArchiveCardId(null);
    refetch();
  };

  const openArchive = async () => {
    setArchiveLoading(true);
    setShowArchive(true);
    try {
      const cards = await api.getArchivedCards(params.id);
      setArchivedCards(cards);
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleRestoreCard = async (cardId: string) => {
    const firstListId = board()?.lists[0]?.id;
    await api.restoreCard(cardId, firstListId);
    setArchivedCards((prev) => prev.filter((c) => c.id !== cardId));
    refetch();
  };

  const handleDeleteArchivedCard = async (cardId: string) => {
    await api.deleteCard(cardId);
    setArchivedCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  // --- List / Card actions ---

  const handleAddList = async (title: string) => {
    await api.createList(params.id, title);
    refetch();
  };

  const handleAddCard = async (listId: string, title: string) => {
    const card = await api.createCard(listId, title);
    setPendingFocusCardId(card.id);
    refetch();
  };

  const handleDeleteList = (listId: string) => {
    const b = board();
    const list = b?.lists.find((l) => l.id === listId);
    if (list && list.cards.length > 0) {
      setConfirmDeleteListId(listId);
    } else {
      doDeleteList(listId);
    }
  };

  const doDeleteList = async (listId: string) => {
    setConfirmDeleteListId(null);
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
    setPendingFocusCardId(cardId);
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
    labelIds: string[],
    dueDate: string | null
  ) => {
    await api.updateCard(id, { title, description, label_ids: labelIds, due_date: dueDate });
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

  // --- List drag ---

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
    await api.updateBoard(b.id, { color });
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

  const toggleFilterLabel = (labelId: string) => {
    setFilterLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId]
    );
  };

  const cardMatchesFilter = (card: CardType): boolean => {
    const text = filterText().toLowerCase();
    const labelIds = filterLabelIds();
    if (text) {
      const titleMatch = card.title.toLowerCase().includes(text);
      const descMatch = card.description.toLowerCase().includes(text);
      if (!titleMatch && !descMatch) return false;
    }
    if (labelIds.length > 0) {
      if (!card.label_ids?.some((id) => labelIds.includes(id))) return false;
    }
    return true;
  };

  const isFiltering = () => !!filterText() || filterLabelIds().length > 0;

  const filteredCards = (cards: CardType[]) => {
    if (!isFiltering()) return cards;
    return cards.filter(cardMatchesFilter);
  };

  return (
    <div
      class="board-page"
      tabindex="-1"
      onClick={(e) => {
        if (showColorPicker()) setShowColorPicker(false);
        const target = e.target as HTMLElement;
        if (target === e.currentTarget || target.classList.contains("lists-container") || target.classList.contains("board-title-bar")) {
          const cardId = lastFocusedCardId();
          if (cardId) {
            const card = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
            if (card) { card.focus(); return; }
          }
          (e.currentTarget as HTMLElement).focus();
        }
      }}
    >
      <Show when={board()} fallback={<div class="loading">Loading...</div>}>
        {(b) => (
          <>
            <div class="board-title-bar">
              <Show when={showRename()}>
                <input
                  class="board-title-input"
                  type="text"
                  ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
                  value={renameValue()}
                  onInput={(e) => setRenameValue(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                  }}
                  onBlur={commitRename}
                />
              </Show>
              <button
                class="board-filter-btn"
                classList={{ "board-filter-btn--active": showFilterBar() || isFiltering() }}
                onClick={() => setShowFilterBar((v) => !v)}
                title="Filter cards (F)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filter
              </button>
              <button
                class="board-archive-btn"
                onClick={openArchive}
                title="View archived cards"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
                Archive
              </button>
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
            <Show when={showFilterBar()}>
              <div class="filter-bar">
                <div class="filter-input-wrapper">
                  <input
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    class="filter-text-input"
                    type="text"
                    placeholder="Filter cards..."
                    value={filterText()}
                    onInput={(e) => setFilterText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        if (!filterText() && filterLabelIds().length === 0) {
                          setShowFilterBar(false);
                        } else {
                          setFilterText("");
                          setFilterLabelIds([]);
                        }
                      }
                    }}
                  />
                  <Show when={isFiltering()}>
                    <button
                      class="filter-input-clear"
                      onClick={() => { setFilterText(""); setFilterLabelIds([]); }}
                      title="Clear all filters"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </Show>
                </div>
                <Show when={b().labels.length > 0}>
                  <div class="filter-labels">
                    <For each={b().labels}>
                      {(label) => {
                        const active = () => filterLabelIds().includes(label.id);
                        return (
                          <button
                            class="filter-label-chip"
                            classList={{ "filter-label-chip--active": active() }}
                            style={{ "--label-color": label.color }}
                            onClick={() => toggleFilterLabel(label.id)}
                          >
                            <span class="filter-label-dot" style={{ "background-color": label.color }} />
                            <span innerHTML={renderTitle(label.name)} />
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
            <div
              class="lists-container"
              onDragOver={handleListDragOver}
              onDrop={handleListDrop}
            >
              <For each={b().lists}>
                {(list) => {
                  const filtered = () =>
                    isFiltering()
                      ? { ...list, cards: filteredCards(list.cards) }
                      : list;
                  return (
                    <List
                      list={filtered()}
                      labels={b().labels}
                      onAddCard={handleAddCard}
                      onArchiveCard={handleArchiveCard}
                      onDeleteList={handleDeleteList}
                      onCardClick={handleCardClick}
                      onDropCard={handleDropCard}
                      onMoveCard={handleMoveCard}
                    />
                  );
                }}
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
            onToggleFilter={() => setShowFilterBar((v) => !v)}
            onToggleHelp={() => setShowHelp((v) => !v)}
          />
        )}
      </Show>

      {/* Archive confirmation dialog */}
      <Show when={confirmArchiveCardId()}>
        <div
          class="unsaved-overlay archive-overlay"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { e.preventDefault(); setConfirmArchiveCardId(null); }
            if (e.key === "Enter") { e.preventDefault(); (document.activeElement as HTMLElement | null)?.click(); }
          }}
        >
          <div class="unsaved-dialog">
            <p>Archive this card?</p>
            <div class="unsaved-dialog-actions">
              <button
                ref={(el) => requestAnimationFrame(() => el.focus())}
                class="btn btn-primary"
                onClick={confirmArchive}
              >
                Archive
              </button>
              <button
                class="btn btn-cancel"
                onClick={() => setConfirmArchiveCardId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* List delete confirmation */}
      <Show when={confirmDeleteListId()}>
        <div
          class="unsaved-overlay archive-overlay"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { e.preventDefault(); setConfirmDeleteListId(null); }
            if (e.key === "Enter") { e.preventDefault(); (document.activeElement as HTMLElement | null)?.click(); }
          }}
        >
          <div class="unsaved-dialog">
            <p>Delete this list? Its cards will be archived.</p>
            <div class="unsaved-dialog-actions">
              <button
                ref={(el) => requestAnimationFrame(() => el.focus())}
                class="btn btn-primary"
                onClick={() => doDeleteList(confirmDeleteListId()!)}
              >
                Delete list
              </button>
              <button
                class="btn btn-cancel"
                onClick={() => setConfirmDeleteListId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Archive view modal */}
      <Show when={showArchive()}>
        <div
          class="archive-overlay archive-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowArchive(false); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setShowArchive(false);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const items = Array.from(
                (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".archive-card-item")
              );
              if (items.length === 0) return;
              const idx = items.indexOf((document.activeElement?.closest(".archive-card-item") ?? null) as HTMLElement);
              const next = e.key === "ArrowDown"
                ? (idx < 0 ? 0 : Math.min(idx + 1, items.length - 1))
                : (idx < 0 ? items.length - 1 : Math.max(idx - 1, 0));
              items[next].focus();
            }
          }}
        >
          <div class="archive-modal">
            <div class="archive-modal-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="21 8 21 21 3 21 3 8" />
                <rect x="1" y="3" width="22" height="5" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              <span>Archived Cards</span>
              <button class="modal-close" onClick={() => setShowArchive(false)} title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="archive-modal-body">
              <Show when={archiveLoading()}>
                <p class="archive-empty">Loading…</p>
              </Show>
              <Show when={!archiveLoading() && archivedCards().length === 0}>
                <p class="archive-empty">No archived cards.</p>
              </Show>
              <For each={archivedCards()}>
                {(card) => (
                  <div class="archive-card-item" tabindex="0">
                    <span class="archive-card-title" innerHTML={renderTitle(card.title)} />
                    <div class="archive-card-actions">
                      <Show
                        when={confirmDeleteCardId() === card.id}
                        fallback={
                          <>
                            <button
                              class="btn btn-primary btn-sm"
                              onClick={() => handleRestoreCard(card.id)}
                            >
                              Restore
                            </button>
                            <button
                              class="btn btn-danger btn-sm"
                              onClick={() => setConfirmDeleteCardId(card.id)}
                              title="Permanently delete"
                            >
                              Delete
                            </button>
                          </>
                        }
                      >
                        <span class="archive-confirm-text">Delete permanently?</span>
                        <button
                          class="btn btn-danger btn-sm"
                          ref={(el) => requestAnimationFrame(() => el.focus())}
                          onClick={() => { handleDeleteArchivedCard(card.id); setConfirmDeleteCardId(null); }}
                        >
                          Yes
                        </button>
                        <button
                          class="btn btn-cancel btn-sm"
                          onClick={() => setConfirmDeleteCardId(null)}
                        >
                          No
                        </button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show when={showHelp()}>
        <ShortcutHelp onClose={() => setShowHelp(false)} />
      </Show>
    </div>
  );
}
