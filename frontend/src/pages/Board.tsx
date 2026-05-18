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
import { useParams, useNavigate } from "@solidjs/router";
import { api } from "../api";
import type { Card as CardType } from "../types";
import List from "../components/List";
import AddForm from "../components/AddForm";
import CardDetail from "../components/CardDetail";
import ShortcutHelp from "../components/ShortcutHelp";
import LabelDrawer from "../components/LabelDrawer";
import ArchiveCardsModal from "../components/ArchiveCardsModal";
import FilterBar from "../components/FilterBar";
import BoardColorPicker from "../components/BoardColorPicker";
import ConfirmDialog from "../components/ConfirmDialog";
import { useLabelContext } from "../LabelContext";
import { listDropPosition } from "../positions";
import { cardMatchesFilter as filterCard } from "../filter";
import { isInInput } from "../boardInput";

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
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
  const [confirmDeleteListId, setConfirmDeleteListId] = createSignal<string | null>(null);

  // Filter state
  const [showFilterBar, setShowFilterBar] = createSignal(false);
  const [filterText, setFilterText] = createSignal("");
  const [filterLabelIds, setFilterLabelIds] = createSignal<string[]>([]);

  // List rename state
  const [renamingListId, setRenamingListId] = createSignal<string | null>(null);

  // Restore focus to a moved card after board resource re-renders.
  createEffect(() => {
    board(); // only dependency — fires after DOM update from refetch
    const cardId = untrack(pendingFocusCardId);
    if (!cardId) return;
    setPendingFocusCardId(null);
    requestAnimationFrame(() => {
      (document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null)?.focus();
    });
  });

  createEffect(() => {
    const color = board()?.color ?? "#0079bf";
    document.documentElement.style.setProperty("--board-color", color);
  });

  createEffect(() => {
    const b = board();
    if (b) lc.setBoardTitle(b.title);
  });

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
      if (isInInput(e.target)) return;
      if (confirmArchiveCardId() || confirmDeleteListId()) return;

      // Shift+Alt+Left/Right: reorder list from focused add-trigger.
      // Card.tsx handles the same shortcut for focused cards (with stopPropagation).
      if (e.shiftKey && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const focused = document.activeElement as HTMLElement | null;
        const list = focused?.closest?.(".list") as HTMLElement | null;
        if (list) {
          e.preventDefault();
          moveListByKey(list.dataset.listId!, e.key === "ArrowLeft" ? "left" : "right");
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

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
        } else if (renamingListId()) {
          setRenamingListId(null);
        } else if (lc.renaming()) {
          lc.setRenaming(false);
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
        const list = focused?.closest(".list") ?? document.querySelector(".list");
        const trigger = list?.querySelector(".add-trigger") as HTMLElement | null;
        trigger?.click();
      } else if (e.key === "e") {
        const focused = document.activeElement;
        if (focused?.classList.contains("card")) {
          e.preventDefault();
          (focused as HTMLElement).click();
        }
      } else if (e.key === "r") {
        const focused = document.activeElement as HTMLElement | null;
        const list = focused?.closest?.(".list") as HTMLElement | null;
        if (list) {
          e.preventDefault();
          setRenamingListId(list.dataset.listId ?? null);
        }
      } else if (e.key === "a") {
        e.preventDefault();
        if (showArchive()) {
          setShowArchive(false);
        } else {
          openArchive();
        }
      } else if (e.key === "Backspace") {
        e.preventDefault();
      } else if (e.key === "b") {
        e.preventDefault();
        navigate("/");
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
    const handleCommitRename = () => commitRename();

    document.addEventListener("keydown", handleGlobalKey);
    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    document.addEventListener("commit-board-rename", handleCommitRename as EventListener);

    onCleanup(() => {
      lc.setHasBoard(false);
      lc.setBoardTitle("");
      lc.setRenaming(false);
      lc.close();
      clearInterval(pollId);
      document.removeEventListener("keydown", handleGlobalKey);
      document.removeEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
      document.removeEventListener("commit-board-rename", handleCommitRename as EventListener);
      document.documentElement.style.setProperty("--board-color", "#0079bf");
    });
  });

  const commitRename = async () => {
    if (!lc.renaming()) return;
    const name = lc.renameValue().trim();
    const b = board();
    lc.setRenaming(false);
    if (name && b && name !== b.title) {
      await api.updateBoard(b.id, { title: name });
      refetch();
    }
  };

  // --- Archive ---

  const handleArchiveCard = (cardId: string) => setConfirmArchiveCardId(cardId);

  const confirmArchive = async () => {
    const id = confirmArchiveCardId();
    if (!id) return;
    const el = document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null;
    let neighborId: string | null = null;
    if (el) {
      let sibling = el.nextElementSibling as HTMLElement | null;
      while (sibling && !sibling.classList.contains("card")) sibling = sibling.nextElementSibling as HTMLElement | null;
      if (!sibling) {
        sibling = el.previousElementSibling as HTMLElement | null;
        while (sibling && !sibling.classList.contains("card")) sibling = sibling.previousElementSibling as HTMLElement | null;
      }
      neighborId = sibling?.dataset.cardId ?? null;
    }
    await api.archiveCard(id);
    setConfirmArchiveCardId(null);
    if (neighborId) {
      setLastFocusedCardId(neighborId);
      setPendingFocusCardId(neighborId);
    } else {
      setLastFocusedCardId(null);
    }
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
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(".archive-card-item");
        if (first) first.focus();
        else document.querySelector<HTMLElement>(".archive-modal")?.focus();
      });
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

  const handleRenameList = async (listId: string, title: string) => {
    setRenamingListId(null);
    const b = board();
    const list = b?.lists.find((l) => l.id === listId);
    const trimmed = title.trim();
    if (!list || !trimmed || trimmed === list.title) return;
    await api.updateList(listId, { title: trimmed });
    refetch();
  };

  const handleMoveList = async (listId: string, position: number) => {
    await api.updateList(listId, { position });
    refetch();
  };

  const moveListByKey = (listId: string, direction: "left" | "right") => {
    const container = document.querySelector(".lists-container");
    if (!container) return;
    const lists = Array.from(container.querySelectorAll<HTMLElement>(".list"));
    const idx = lists.findIndex((el) => el.dataset.listId === listId);
    if (idx < 0) return;
    if (direction === "left" && idx <= 0) return;
    if (direction === "right" && idx >= lists.length - 1) return;
    const otherPositions = lists
      .filter((_, i) => i !== idx)
      .map((l) => parseFloat(l.dataset.listPosition || "0"));
    const insertAt = direction === "left" ? idx - 1 : idx + 1;
    handleMoveList(listId, listDropPosition(otherPositions, insertAt));
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

  const handleDropCard = async (cardId: string, targetListId: string, position: number) => {
    await api.updateCard(cardId, { list_id: targetListId, position });
    refetch();
  };

  const handleMoveCard = async (cardId: string, targetListId: string, position: number) => {
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
    // Refetch recreates card DOM; use pending mechanism so the createEffect
    // restores focus after the resource resolves.
    setPendingFocusCardId(id);
    refetch();
  };

  const handleModalClose = () => {
    const cardId = lastFocusedCardId();
    setSelectedCard(null);
    // Polling may fire between close and focus, so also use the pending
    // mechanism (the createEffect will re-focus once the resource resolves).
    if (cardId) {
      setPendingFocusCardId(cardId);
      requestAnimationFrame(() => {
        (document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null)?.focus();
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
    const position = listDropPosition(positions, insertIndex);

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

  const handleCreateLabel = async (name: string) => {
    await api.createLabel(params.id, name);
    refetch();
  };

  const handleDeleteLabel = async (labelId: string) => {
    await api.deleteLabel(labelId);
    refetch();
  };

  const handleUpdateLabel = async (labelId: string, name: string) => {
    await api.updateLabel(labelId, name);
    refetch();
  };

  // --- Filter ---

  const toggleFilterLabel = (labelId: string) => {
    setFilterLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId]
    );
  };

  const clearFilters = () => {
    setFilterText("");
    setFilterLabelIds([]);
  };

  const isFiltering = () => !!filterText() || filterLabelIds().length > 0;

  const filteredCards = (cards: CardType[]) => {
    if (!isFiltering()) return cards;
    return cards.filter((c) => filterCard(c, filterText(), filterLabelIds()));
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
              <BoardColorPicker
                open={showColorPicker()}
                currentColor={b().color}
                onToggle={() => setShowColorPicker((v) => !v)}
                onSelect={handleSetBoardColor}
              />
            </div>
            <Show when={showFilterBar()}>
              <FilterBar
                text={filterText()}
                labelIds={filterLabelIds()}
                boardLabels={b().labels}
                onTextChange={setFilterText}
                onToggleLabel={toggleFilterLabel}
                onClear={clearFilters}
                onClose={() => setShowFilterBar(false)}
              />
            </Show>
            <div
              class="lists-container"
              onDragOver={handleListDragOver}
              onDrop={handleListDrop}
            >
              <For each={b().lists}>
                {(list) => {
                  const filtered = () =>
                    isFiltering() ? { ...list, cards: filteredCards(list.cards) } : list;
                  return (
                    <List
                      list={filtered()}
                      labels={b().labels}
                      renamingListId={renamingListId()}
                      onAddCard={handleAddCard}
                      onArchiveCard={handleArchiveCard}
                      onDeleteList={handleDeleteList}
                      onCardClick={handleCardClick}
                      onDropCard={handleDropCard}
                      onMoveCard={handleMoveCard}
                      onMoveList={handleMoveList}
                      onRequestRename={setRenamingListId}
                      onRenameList={handleRenameList}
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

            <LabelDrawer
              open={lc.isOpen()}
              labels={b().labels}
              onClose={lc.close}
              onCreate={handleCreateLabel}
              onRename={handleUpdateLabel}
              onDelete={handleDeleteLabel}
            />
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

      <Show when={confirmArchiveCardId()}>
        <ConfirmDialog
          message="Archive this card?"
          confirmLabel="Archive"
          onConfirm={confirmArchive}
          onCancel={() => setConfirmArchiveCardId(null)}
        />
      </Show>

      <Show when={confirmDeleteListId()}>
        <ConfirmDialog
          message="Delete this list? Its cards will be archived."
          confirmLabel="Delete list"
          onConfirm={() => doDeleteList(confirmDeleteListId()!)}
          onCancel={() => setConfirmDeleteListId(null)}
        />
      </Show>

      <Show when={showArchive()}>
        <ArchiveCardsModal
          cards={archivedCards()}
          loading={archiveLoading()}
          onClose={() => setShowArchive(false)}
          onRestore={handleRestoreCard}
          onDelete={handleDeleteArchivedCard}
        />
      </Show>

      <Show when={showHelp()}>
        <ShortcutHelp onClose={() => setShowHelp(false)} />
      </Show>
    </div>
  );
}
