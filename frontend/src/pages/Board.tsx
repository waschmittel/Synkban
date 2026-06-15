import {
  createResource,
  createSignal,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { useParams, useNavigate, A } from "@solidjs/router";
import { api } from "../api";
import type { Card as CardType } from "../types";
import List from "../components/List";
import AddForm from "../components/AddForm";
import CardDetail from "../components/CardDetail";
import ShortcutHelp from "../components/ShortcutHelp";
import LabelDrawer from "../components/LabelDrawer";
import ArchivePanel from "../components/ArchivePanel";
import { renderTitle } from "../components/Card";
import FilterBar from "../components/FilterBar";
import BoardColorPicker from "../components/BoardColorPicker";
import { createConfirm } from "../confirm";
import { useBoardHeader } from "../BoardHeaderContext";
import { useLabelDrawer } from "../LabelDrawerContext";
import { listDropPosition } from "../positions";
import { cardMatchesFilter as filterCard } from "../filter";
import { isTypingIn, isInUiOverlay } from "../boardInput";
import { createFocusRestoration } from "../focusRestoration";
import { startChangePoller } from "../changePoller";
import { registerShortcuts, type ShortcutDef } from "../shortcutRouter";

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const header = useBoardHeader();
  const drawer = useLabelDrawer();

  const [board, { refetch }] = createResource(
    () => params.id,
    (id) => api.getBoard(id)
  );
  const focus = createFocusRestoration(board);
  const confirm = createConfirm();

  // All active boards in Home-screen order (position ASC) — drives the bottom
  // dock and Ctrl+Arrow board cycling.
  const [allBoards, { refetch: refetchBoards }] = createResource(() => api.listBoards());
  const boardList = () => allBoards() ?? [];
  const cycleBoard = (dir: 1 | -1) => {
    const list = boardList();
    if (list.length < 2) return;
    const idx = list.findIndex((b) => b.id === params.id);
    if (idx < 0) return;
    const next = (idx + dir + list.length) % list.length;
    navigate(`/board/${list[next].id}`);
  };

  const [selectedCard, setSelectedCard] = createSignal<CardType | null>(null);
  const [showHelp, setShowHelp] = createSignal(false);
  const [showColorPicker, setShowColorPicker] = createSignal(false);

  // Archive state
  const [showArchive, setShowArchive] = createSignal(false);
  const [archivedCards, setArchivedCards] = createSignal<CardType[]>([]);
  const [archiveLoading, setArchiveLoading] = createSignal(false);

  // Filter state
  const [showFilterBar, setShowFilterBar] = createSignal(false);
  const [filterText, setFilterText] = createSignal("");
  const [filterLabelIds, setFilterLabelIds] = createSignal<string[]>([]);

  // List rename state
  const [renamingListId, setRenamingListId] = createSignal<string | null>(null);

  createEffect(() => {
    // Reading an errored resource throws; bail out before touching board().
    const color = (board.error ? undefined : board()?.color) ?? "#0079bf";
    document.documentElement.style.setProperty("--board-color", color);
  });

  createEffect(() => {
    if (board.error) return;
    const b = board();
    if (b) header.setTitle(b.title);
  });

  onMount(() => {
    header.setIsOnBoard(true);

    // Watch only this board's mtime so quiet boards don't trigger refetch when
    // another board changes. Falls back to the global mtime if the server
    // doesn't (yet) provide the per-board map.
    const stopPoller = startChangePoller({
      select: (r) => r.boards?.[params.id] ?? r.mtime,
      onChange: () => {
        focus.capturePending();
        refetch();
      },
    });

    const triggerAddList = () => {
      (document.querySelector(".add-list-wrapper .add-trigger") as HTMLElement | null)?.click();
    };
    const triggerAddCard = () => {
      const focused = document.activeElement;
      const list = focused?.closest(".list") ?? document.querySelector(".list");
      (list?.querySelector(".add-trigger") as HTMLElement | null)?.click();
    };
    const navigateArrow = (e: KeyboardEvent) => {
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
    };

    // ESC handlers are ordered: first matching `canFire` wins. Stack matches
    // the visual layering — help overlay above archive, above color picker, etc.
    const escDefs: ShortcutDef[] = [
      { key: "Escape", canFire: () => showHelp(), handler: () => setShowHelp(false) },
      { key: "Escape", canFire: () => showArchive(), handler: () => setShowArchive(false) },
      { key: "Escape", canFire: () => showColorPicker(), handler: () => setShowColorPicker(false) },
      // Fires when focus is outside the modal (e.g. on <body> after a dialog
      // closed). Ask CardDetail to close so its unsaved-changes guard runs —
      // closing directly here would discard dirty state without confirmation.
      {
        key: "Escape",
        canFire: () => !!selectedCard(),
        handler: () => document.dispatchEvent(new CustomEvent("request-card-close")),
      },
      { key: "Escape", canFire: () => !!renamingListId(), handler: () => setRenamingListId(null) },
      { key: "Escape", canFire: () => header.renaming(), handler: () => header.setRenaming(false) },
      {
        key: "Escape",
        handler: () => {
          drawer.close();
          const focused = document.activeElement as HTMLElement | null;
          if (focused?.classList.contains("card")) {
            (document.querySelector(".board-page") as HTMLElement | null)?.focus();
          }
        },
      },
    ];

    const arrowDefs: ShortcutDef[] = (["ArrowLeft", "ArrowRight"] as const).map((key) => ({
      // Shift+Alt+Left/Right: reorder list from focused add-trigger.
      // Card.tsx handles the same shortcut for focused cards (with stopPropagation).
      key, shift: true, alt: true,
      handler: (e) => {
        const focused = document.activeElement as HTMLElement | null;
        const list = focused?.closest?.(".list") as HTMLElement | null;
        if (list) {
          e.preventDefault();
          moveListByKey(list.dataset.listId!, key === "ArrowLeft" ? "left" : "right");
        }
      },
    }));

    const navDefs: ShortcutDef[] = (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"] as const).map(
      (key) => ({ key, shift: false, alt: false, ctrl: false, meta: false, handler: navigateArrow }),
    );

    // ',' / 'j' (prev) and '.' / 'k' (next): cycle boards in Home order (wraps).
    const cycleDefs: ShortcutDef[] = ([",", "j", ".", "k"] as const).map((key) => ({
      key, ctrl: false, shift: false, alt: false, meta: false,
      handler: (e) => { e.preventDefault(); cycleBoard(key === "," || key === "j" ? -1 : 1); },
    }));

    const noMods = { ctrl: false, meta: false, alt: false } as const;
    const dispose = registerShortcuts(
      [
        ...escDefs,
        ...arrowDefs,
        { key: "?", ...noMods, handler: (e) => { e.preventDefault(); setShowHelp((v) => !v); } },
        { key: "f", ...noMods, handler: (e) => { e.preventDefault(); setShowFilterBar((v) => !v); } },
        { key: "g", ...noMods, handler: (e) => { e.preventDefault(); drawer.toggle(); } },
        { key: "l", ...noMods, handler: (e) => { e.preventDefault(); triggerAddList(); } },
        { key: "n", ...noMods, handler: (e) => { e.preventDefault(); triggerAddCard(); } },
        { key: "c", ...noMods, handler: (e) => { e.preventDefault(); triggerAddCard(); } },
        {
          key: "e", ...noMods,
          canFire: () => !!(document.activeElement?.classList.contains("card")),
          handler: (e) => { e.preventDefault(); (document.activeElement as HTMLElement).click(); },
        },
        {
          key: "r", ...noMods,
          handler: (e) => {
            const focused = document.activeElement as HTMLElement | null;
            const list = focused?.closest?.(".list") as HTMLElement | null;
            if (list) {
              e.preventDefault();
              setRenamingListId(list.dataset.listId ?? null);
            }
          },
        },
        {
          key: "a", ...noMods,
          handler: (e) => {
            e.preventDefault();
            if (showArchive()) setShowArchive(false);
            else openArchive();
          },
        },
        { key: "Backspace", ...noMods, handler: (e) => e.preventDefault() },
        { key: "b", ...noMods, handler: (e) => { e.preventDefault(); navigate("/"); } },
        ...cycleDefs,
        ...navDefs,
      ],
      // Confirm dialogs swallow ALL shortcuts as a global guard.
      { baseCanFire: (e) => !isTypingIn(e.target) && !isInUiOverlay(e.target) && !confirm.isOpen() },
    );

    const handleToggleShortcuts = () => setShowHelp((v) => !v);
    const handleCommitRename = () => commitRename();

    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    document.addEventListener("commit-board-rename", handleCommitRename as EventListener);

    onCleanup(() => {
      header.setIsOnBoard(false);
      header.setTitle("");
      header.setRenaming(false);
      drawer.close();
      stopPoller();
      dispose();
      document.removeEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
      document.removeEventListener("commit-board-rename", handleCommitRename as EventListener);
      document.documentElement.style.setProperty("--board-color", "#0079bf");
    });
  });

  const commitRename = async () => {
    if (!header.renaming()) return;
    const name = header.renameValue().trim();
    const b = board();
    header.setRenaming(false);
    if (name && b && name !== b.title) {
      await api.updateBoard(b.id, { title: name });
      refetch();
      refetchBoards();
    }
  };

  // --- Archive ---

  const handleArchiveCard = async (cardId: string) => {
    if (!await confirm.ask({ message: "Archive this card?", confirmLabel: "Archive" })) return;
    const el = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
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
    await api.archiveCard(cardId);
    if (neighborId) {
      focus.setLastFocused(neighborId);
      focus.preserve(neighborId);
    } else {
      focus.setLastFocused(null);
    }
    refetch();
  };

  const openArchive = async () => {
    setArchiveLoading(true);
    setShowArchive(true);
    try {
      setArchivedCards(await api.getArchivedCards(params.id));
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleRestoreCard = async (cardId: string) => {
    const card = archivedCards().find((c) => c.id === cardId);
    const lists = board()?.lists ?? [];
    // Only orphaned cards (original list gone) need a target list;
    // sending list_id for in-place cards would move them.
    const orphaned = !lists.some((l) => l.id === card?.list_id);
    if (orphaned && lists.length === 0) {
      alert("Cannot restore: this board has no lists. Create a list first.");
      return;
    }
    try {
      await api.restoreCard(cardId, orphaned ? lists[0].id : undefined);
    } catch (err) {
      alert(`Restore failed: ${(err as Error).message}`);
      return;
    }
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
    focus.preserve(card.id);
    refetch();
  };

  const handleDeleteList = async (listId: string) => {
    const b = board();
    const list = b?.lists.find((l) => l.id === listId);
    if (list && list.cards.length > 0) {
      const ok = await confirm.ask({
        message: `Delete "${list.title}" and archive its ${list.cards.length} card${list.cards.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
      });
      if (!ok) return;
    }
    await api.deleteList(listId);
    refetch();
  };

  const handleDropCard = async (cardId: string, targetListId: string, position: number) => {
    await api.updateCard(cardId, { list_id: targetListId, position });
    refetch();
  };

  const handleMoveCard = async (cardId: string, targetListId: string, position: number) => {
    focus.preserve(cardId);
    await api.updateCard(cardId, { list_id: targetListId, position });
    refetch();
  };

  const handleCardClick = (card: CardType) => {
    focus.setLastFocused(card.id);
    setSelectedCard(card);
  };

  // Invariant for both close paths: the modal only unmounts after refetch()
  // resolves, so board() already reflects the modal's writes. Closing first
  // would let an immediate re-open snapshot a stale card (empty description,
  // missing checklist items) from the still-refetching resource.
  const handleCardSave = async (
    id: string,
    title: string,
    description: string,
    labelIds: string[],
    dueDate: string | null
  ) => {
    await api.updateCard(id, { title, description, label_ids: labelIds, due_date: dueDate });
    try { await refetch(); } catch { /* board error surfaces via resource */ }
    setSelectedCard(null);
    focus.preserve(id);
  };

  const handleModalClose = async () => {
    const cardId = focus.lastFocused();
    // Checklist/attachment edits save immediately inside the modal; refetch so
    // card badges (and an immediate re-open) reflect them without waiting for
    // the next poll.
    try { await refetch(); } catch { /* board error surfaces via resource */ }
    setSelectedCard(null);
    if (cardId) focus.preserve(cardId);
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
    refetchBoards();
    setShowColorPicker(false);
  };

  // --- Label management ---

  const handleCreateLabel = async (name: string) => {
    const label = await api.createLabel(params.id, name);
    refetch();
    return label;
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
          const cardId = focus.lastFocused();
          if (cardId) {
            const card = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
            if (card) { card.focus(); return; }
          }
          (e.currentTarget as HTMLElement).focus();
        }
      }}
    >
      <Show
        when={!board.error}
        fallback={
          <div class="board-error">
            <h2>Board not found</h2>
            <p>This board may have been deleted, or the link is no longer valid.</p>
            <A href="/" class="board-error-home">Back to boards</A>
          </div>
        }
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
                onPreview={(c) => document.documentElement.style.setProperty("--board-color", c)}
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
              open={drawer.isOpen()}
              labels={b().labels}
              onClose={drawer.close}
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
            onCreateLabel={handleCreateLabel}
            onSave={handleCardSave}
            onClose={handleModalClose}
            onToggleFilter={() => setShowFilterBar((v) => !v)}
            onToggleHelp={() => setShowHelp((v) => !v)}
          />
        )}
      </Show>

      <confirm.Render />

      <Show when={showArchive()}>
        <ArchivePanel
          title="Archived Cards"
          items={archivedCards()}
          loading={archiveLoading()}
          emptyText="No archived cards."
          itemClass="archive-card-item"
          restoreClass="btn btn-primary btn-sm"
          renderItem={(card) => (
            <span class="archive-card-title" innerHTML={renderTitle(card.title)} />
          )}
          onClose={() => setShowArchive(false)}
          onRestore={handleRestoreCard}
          onDelete={handleDeleteArchivedCard}
        />
      </Show>

      <Show when={showHelp()}>
        <ShortcutHelp onClose={() => setShowHelp(false)} />
      </Show>
      </Show>

      <Show when={boardList().length > 1}>
        <nav class="board-dock" aria-label="Switch board">
          <For each={boardList()}>
            {(bd) => (
              <button
                class="board-dock-dot"
                classList={{ "board-dock-dot--active": bd.id === params.id }}
                style={{ "--dot-color": bd.color ?? "#0079bf" }}
                data-board-id={bd.id}
                title={bd.title}
                aria-label={bd.title}
                aria-current={bd.id === params.id ? "true" : undefined}
                onClick={() => navigate(`/board/${bd.id}`)}
              />
            )}
          </For>
        </nav>
      </Show>
    </div>
  );
}
