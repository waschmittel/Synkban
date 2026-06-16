import { createSignal, createResource, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "../api";
import type { Board } from "../types";
import ShortcutHelp from "../components/ShortcutHelp";
import ArchivePanel from "../components/ArchivePanel";
import { startChangePoller } from "../changePoller";
import { registerShortcuts, type ShortcutDef } from "../shortcutRouter";
import { isTypingIn } from "../boardInput";
import { createConfirm } from "../confirm";

export default function Home() {
  const [boards, { refetch, mutate }] = createResource(() => api.listBoards());
  const [archivedBoards, setArchivedBoards] = createSignal<Board[]>([]);
  const [archiveLoading, setArchiveLoading] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [showArchive, setShowArchive] = createSignal(false);
  const confirm = createConfirm();
  const [pendingFocusBoardId, setPendingFocusBoardId] = createSignal<string | null>(null);

  // Restore focus to a reordered board after the resource re-renders. The
  // optimistic mutate() AND the later refetch() each recreate the <For> DOM
  // nodes, so re-focus on every boards() change while a reorder is pending;
  // only clear the pending id once the reorder fully settles (otherwise the
  // refetch would land focus on a recreated node with no id left to target).
  createEffect(() => {
    boards();
    const id = pendingFocusBoardId();
    if (!id) return;
    requestAnimationFrame(() => {
      (document.querySelector(`[data-board-id="${id}"]`) as HTMLElement | null)?.focus();
      if (!reorderInFlight && !queuedReorderIds) setPendingFocusBoardId(null);
    });
  });

  // Reorders are applied optimistically via mutate() so rapid Shift+Arrow presses
  // compute from the latest order, and PUTs are serialized (latest order wins) so
  // the backend never renumbers concurrently. refetch() only runs once the queue
  // drains, so it can't clobber a newer optimistic order.
  let queuedReorderIds: string[] | null = null;
  let reorderInFlight = false;

  const flushReorder = async () => {
    if (reorderInFlight) return;
    reorderInFlight = true;
    try {
      while (queuedReorderIds) {
        const ids = queuedReorderIds;
        queuedReorderIds = null;
        try {
          await api.reorderBoards(ids);
        } catch { /* refetch below restores server truth */ }
      }
    } finally {
      reorderInFlight = false;
      refetch();
    }
  };

  const reorderBoardByKey = (key: string) => {
    const focused = document.activeElement as HTMLElement | null;
    if (!focused?.classList.contains("board-card")) return false;
    const boardId = focused.getAttribute("data-board-id");
    const list = boards();
    if (!boardId || !list) return false;
    const idx = list.findIndex((b) => b.id === boardId);
    if (idx < 0) return false;

    const grid = document.querySelector(".board-grid") as HTMLElement | null;
    let cols = 1;
    if (grid) cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;

    let newIdx = idx;
    switch (key) {
      case "ArrowRight": newIdx = Math.min(idx + 1, list.length - 1); break;
      case "ArrowLeft":  newIdx = Math.max(idx - 1, 0); break;
      case "ArrowDown":  newIdx = Math.min(idx + cols, list.length - 1); break;
      case "ArrowUp":    newIdx = Math.max(idx - cols, 0); break;
      default: return false;
    }
    if (newIdx === idx) return true;

    const reordered = [...list];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(newIdx, 0, moved);
    setPendingFocusBoardId(boardId);
    mutate(reordered);
    queuedReorderIds = reordered.map((b) => b.id);
    flushReorder();
    return true;
  };

  // --- Drag & drop reordering (native HTML5 DnD) ---
  // Module-scoped (not a signal) so dragover/drop on the grid can read it
  // synchronously without reactive churn. The grid only acts on board drags.
  let draggingBoardId: string | null = null;
  // Floating insertion bar, positioned in the grid gap (not glued to a card
  // edge). Coords are relative to the `.board-grid` (which is position:relative).
  const [dropLine, setDropLine] = createSignal<
    { left: number; top: number; width: number } | null
  >(null);
  const GAP_HALF = 5; // half of the 10px list gap

  const clearDropMarkers = () => {
    setDropLine(null);
    document
      .querySelectorAll(".board-drop-before, .board-drop-after")
      .forEach((el) => el.classList.remove("board-drop-before", "board-drop-after"));
  };

  // Real board cards in DOM order, excluding the one being dragged and the
  // "add board" tile.
  const boardCardsInOrder = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        ".board-card[data-board-id]:not(.board-dragging)"
      )
    );

  // Insertion index for the vertical list: insert before the first card whose
  // vertical midpoint the cursor is above.
  const dropIndexAt = (cards: HTMLElement[], y: number) => {
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return cards.length;
  };

  const handleBoardDragStart = (e: DragEvent, boardId: string) => {
    draggingBoardId = boardId;
    e.dataTransfer!.setData("application/board-id", boardId);
    e.dataTransfer!.effectAllowed = "move";
    const el = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => el.classList.add("board-dragging"));
  };

  const handleBoardDragEnd = (e: DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove("board-dragging");
    clearDropMarkers();
    draggingBoardId = null;
  };

  const handleGridDragOver = (e: DragEvent) => {
    if (!draggingBoardId) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    const cards = boardCardsInOrder();
    const idx = dropIndexAt(cards, e.clientY);
    clearDropMarkers();
    const gridRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (idx < cards.length) {
      const target = cards[idx];
      target.classList.add("board-drop-before");
      const r = target.getBoundingClientRect();
      setDropLine({
        left: r.left - gridRect.left,
        top: r.top - gridRect.top - GAP_HALF,
        width: r.width,
      });
    } else {
      const last = cards[cards.length - 1];
      if (!last) return;
      last.classList.add("board-drop-after");
      const r = last.getBoundingClientRect();
      setDropLine({
        left: r.left - gridRect.left,
        top: r.bottom - gridRect.top + GAP_HALF,
        width: r.width,
      });
    }
  };

  const handleGridDrop = (e: DragEvent) => {
    if (!draggingBoardId) return;
    e.preventDefault();
    const cards = boardCardsInOrder();
    const idx = dropIndexAt(cards, e.clientY);
    const beforeId = idx < cards.length ? cards[idx].getAttribute("data-board-id") : null;
    reorderBoardByDrop(draggingBoardId, beforeId);
    clearDropMarkers();
    draggingBoardId = null;
  };

  // Reorder the data array by inserting `boardId` before `beforeId` (or at the
  // end when null). Shares the optimistic mutate + serialized PUT queue with
  // the keyboard path so rapid drag/key mixes never race the backend.
  const reorderBoardByDrop = (boardId: string, beforeId: string | null) => {
    const list = boards();
    if (!list) return;
    const moved = list.find((b) => b.id === boardId);
    if (!moved) return;
    const reordered = list.filter((b) => b.id !== boardId);
    const at = beforeId ? reordered.findIndex((b) => b.id === beforeId) : -1;
    reordered.splice(at < 0 ? reordered.length : at, 0, moved);
    if (reordered.every((b, i) => b.id === list[i].id)) return;
    setPendingFocusBoardId(boardId);
    mutate(reordered);
    queuedReorderIds = reordered.map((b) => b.id);
    flushReorder();
  };

  const openArchive = async () => {
    setArchiveLoading(true);
    setShowArchive(true);
    try {
      setArchivedBoards(await api.listArchivedBoards());
    } finally {
      setArchiveLoading(false);
    }
  };

  onMount(() => {
    api.listArchivedBoards().then(boards => setArchivedBoards(boards));

    // Reorder flush refetches when it drains; skipping the tick (without
    // consuming the mtime) lets the next poll pick the change up.
    const stopPoller = startChangePoller({
      shouldSkip: () => reorderInFlight || !!queuedReorderIds,
      onChange: async () => {
        refetch();
        if (showArchive()) {
          setArchivedBoards(await api.listArchivedBoards());
        }
      },
    });

    const navigateGrid = (e: KeyboardEvent) => {
      e.preventDefault();
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".board-card, .add-board, .add-board-form"));
      if (cards.length === 0) return;
      const currentIdx = cards.indexOf(document.activeElement as HTMLElement);

      const grid = document.querySelector(".board-grid") as HTMLElement | null;
      let cols = 1;
      if (grid) {
        cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
      }

      let nextIdx: number;
      if (currentIdx < 0) {
        nextIdx = (e.key === "ArrowUp" || e.key === "ArrowLeft") ? cards.length - 1 : 0;
      } else {
        switch (e.key) {
          case "ArrowRight": nextIdx = Math.min(currentIdx + 1, cards.length - 1); break;
          case "ArrowLeft": nextIdx = Math.max(currentIdx - 1, 0); break;
          case "ArrowDown": nextIdx = Math.min(currentIdx + cols, cards.length - 1); break;
          case "ArrowUp": nextIdx = Math.max(currentIdx - cols, 0); break;
          default: return;
        }
      }
      cards[nextIdx]?.focus();
    };

    const archiveFocusedBoard = (e: KeyboardEvent) => {
      const focused = document.activeElement as HTMLElement;
      if (focused?.classList.contains("board-card")) {
        const boardId = focused.getAttribute("data-board-id");
        if (boardId) {
          e.preventDefault();
          handleArchive(boardId);
        }
      }
    };

    const noMods = { ctrl: false, meta: false, alt: false } as const;
    const arrowDirs = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"] as const;

    const defs: ShortcutDef[] = [
      { key: "Escape", canFire: () => showArchive(), handler: () => setShowArchive(false) },
      { key: "Escape", canFire: () => showHelp(), handler: () => setShowHelp(false) },
      { key: "Escape", canFire: () => adding(), handler: () => close() },
      { key: "n", ...noMods, handler: (e) => { e.preventDefault(); setAdding(true); } },
      {
        key: "a", ...noMods,
        handler: (e) => {
          e.preventDefault();
          if (showArchive()) setShowArchive(false);
          else openArchive();
        },
      },
      { key: "?", ...noMods, handler: (e) => { e.preventDefault(); setShowHelp((v) => !v); } },
      { key: "Delete", ...noMods, handler: archiveFocusedBoard },
      { key: "Backspace", ...noMods, handler: archiveFocusedBoard },
      ...arrowDirs.map<ShortcutDef>((key) => ({
        key, shift: true, ...noMods,
        handler: (e) => { e.preventDefault(); reorderBoardByKey(key); },
      })),
      ...arrowDirs.map<ShortcutDef>((key) => ({
        key, shift: false, ...noMods, handler: navigateGrid,
      })),
    ];

    // Home page only guards typing surfaces and its two overlays — no `filter-bar`,
    // `label-drawer`, or board-level modals on this page.
    const dispose = registerShortcuts(defs, {
      baseCanFire: (e) => {
        const t = e.target as HTMLElement | null;
        if (isTypingIn(t)) return false;
        if (t?.closest?.(".shortcut-help-overlay")) return false;
        if (t?.closest?.(".archive-modal-overlay")) return false;
        if (confirm.isOpen()) return false;
        return true;
      },
    });

    const handleToggleShortcuts = () => setShowHelp((v) => !v);
    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    onCleanup(() => {
      stopPoller();
      dispose();
      document.removeEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    });
  });

  const [newTitle, setNewTitle] = createSignal("");
  const [adding, setAdding] = createSignal(false);

  const close = () => {
    setAdding(false);
    setNewTitle("");
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const title = newTitle().trim();
    if (!title) return;
    await api.createBoard(title);
    close();
    refetch();
  };

  const handleArchive = async (id: string) => {
    const title = getBoardTitle(id);
    const ok = await confirm.ask({
      message: `Archive "${title}"?`,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    await api.archiveBoard(id);
    refetch();
    const boards = await api.listArchivedBoards();
    setArchivedBoards(boards);
  };

  const handleRestore = async (id: string) => {
    await api.restoreBoard(id);
    setArchivedBoards((prev) => prev.filter((b) => b.id !== id));
    refetch();
  };

  const handleDeleteArchived = async (id: string) => {
    await api.deleteBoard(id);
    setArchivedBoards((prev) => prev.filter((b) => b.id !== id));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const getBoardTitle = (id: string): string => {
    const b = boards()?.find(b => b.id === id);
    return b?.title ?? "this board";
  };

  return (
    <div class="home">
      <div class="home-header">
        <h2>Your Boards</h2>
        <button
          class={`board-archive-toggle ${showArchive() ? "board-archive-toggle--active" : ""}`}
          onClick={() => { if (showArchive()) { setShowArchive(false); } else { openArchive(); } }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          Archive
          <Show when={archivedBoards().length > 0}>
            <span> ({archivedBoards().length})</span>
          </Show>
        </button>
      </div>
      <Show
        when={boards() && (boards()!.length > 0 || adding())}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <p>No boards yet</p>
            <button class="btn btn-primary" onClick={() => setAdding(true)}>
              Create your first board
            </button>
          </div>
        }
      >
        <div class="board-grid" onDragOver={handleGridDragOver} onDrop={handleGridDrop}>
          <Show when={dropLine()}>
            {(line) => (
              <div
                class="board-drop-line"
                style={{
                  left: `${line().left}px`,
                  top: `${line().top}px`,
                  width: `${line().width}px`,
                }}
              />
            )}
          </Show>
          <For each={boards()}>
            {(board) => (
              <A
                href={`/board/${board.id}`}
                class="board-card"
                data-board-id={board.id}
                draggable={true}
                onDragStart={(e) => handleBoardDragStart(e, board.id)}
                onDragEnd={handleBoardDragEnd}
                style={board.color ? { "background": board.color } : {}}
              >
                <span class="board-card-link">{board.title}</span>
                <button
                  class="board-card-delete"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleArchive(board.id); }}
                  title="Archive board"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                </button>
              </A>
            )}
          </For>
          <Show
            when={adding()}
            fallback={
              <button class="board-card add-board" onClick={() => setAdding(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Create new board</span>
              </button>
            }
          >
            <form class="board-card add-board-form" onSubmit={handleCreate} onKeyDown={handleKeyDown}>
              <input
                ref={(el) => requestAnimationFrame(() => el.focus())}
                type="text"
                placeholder="Board title..."
                value={newTitle()}
                onInput={(e) => setNewTitle(e.currentTarget.value)}
              />
              <div class="add-board-actions">
                <button type="submit" class="btn btn-primary">
                  Add
                </button>
                <button type="button" class="btn" onClick={close}>
                  Cancel
                </button>
              </div>
            </form>
          </Show>
        </div>
      </Show>

      <confirm.Render />

      {/* Archived boards panel */}
      <Show when={showArchive()}>
        <ArchivePanel
          title="Archived Boards"
          items={archivedBoards()}
          loading={archiveLoading()}
          emptyText="No archived boards"
          itemClass="archive-board-item"
          renderItem={(board) => (
            <>
              <div class="archive-board-color" style={board.color ? { background: board.color } : {}} />
              <span class="archive-card-title">{board.title}</span>
            </>
          )}
          onClose={() => setShowArchive(false)}
          onRestore={handleRestore}
          onDelete={handleDeleteArchived}
        />
      </Show>

      <Show when={showHelp()}>
        <ShortcutHelp onClose={() => setShowHelp(false)} />
      </Show>
    </div>
  );
}
