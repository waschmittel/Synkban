import { createSignal, createResource, createEffect, untrack, For, Show, onMount, onCleanup } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "../api";
import type { Board } from "../types";
import ShortcutHelp from "../components/ShortcutHelp";
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
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);
  const [pendingFocusBoardId, setPendingFocusBoardId] = createSignal<string | null>(null);
  let lastMtime = 0;

  // Restore focus to a reordered board after the resource re-renders.
  createEffect(() => {
    boards();
    const id = untrack(pendingFocusBoardId);
    if (!id) return;
    setPendingFocusBoardId(null);
    requestAnimationFrame(() => {
      (document.querySelector(`[data-board-id="${id}"]`) as HTMLElement | null)?.focus();
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

  const openArchive = async () => {
    setShowArchive(true);
    setArchiveLoading(true);
    try {
      const boards = await api.listArchivedBoards();
      setArchivedBoards(boards);
    } finally {
      setArchiveLoading(false);
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(".archive-board-item");
        if (first) first.focus();
        else document.querySelector<HTMLElement>(".archive-modal")?.focus();
      });
    }
  };

  onMount(() => {
    api.listArchivedBoards().then(boards => setArchivedBoards(boards));

    const pollId = setInterval(async () => {
      try {
        const { mtime } = await api.checkChanges();
        if (mtime !== lastMtime) {
          // Reorder flush refetches when it drains; skipping here (without
          // updating lastMtime) lets the next poll pick the change up.
          if (reorderInFlight || queuedReorderIds) return;
          lastMtime = mtime;
          refetch();
          if (showArchive()) {
            const boards = await api.listArchivedBoards();
            setArchivedBoards(boards);
          }
        }
      } catch { /* ignore poll errors */ }
    }, 15000);

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
      { key: "Escape", canFire: () => showArchive(), handler: () => { setShowArchive(false); setConfirmDeleteId(null); } },
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
        return true;
      },
    });

    const handleToggleShortcuts = () => setShowHelp((v) => !v);
    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    onCleanup(() => {
      clearInterval(pollId);
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
    setConfirmDeleteId(null);
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
        <div class="board-grid">
          <For each={boards()}>
            {(board) => (
              <A
                href={`/board/${board.id}`}
                class="board-card"
                data-board-id={board.id}
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
        <div
          class="archive-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowArchive(false); setConfirmDeleteId(null); } }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") { setShowArchive(false); setConfirmDeleteId(null); }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const items = Array.from(document.querySelectorAll<HTMLElement>(".archive-board-item"));
              if (items.length === 0) return;
              const curIdx = items.indexOf(document.activeElement as HTMLElement);
              let nextIdx: number;
              if (curIdx < 0) {
                nextIdx = e.key === "ArrowDown" ? 0 : items.length - 1;
              } else {
                nextIdx = e.key === "ArrowDown"
                  ? Math.min(curIdx + 1, items.length - 1)
                  : Math.max(curIdx - 1, 0);
              }
              items[nextIdx]?.focus();
            }
          }}
        >
          <div class="archive-modal" tabindex="-1" onClick={(e) => e.stopPropagation()}>
            <div class="archive-modal-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="21 8 21 21 3 21 3 8" />
                <rect x="1" y="3" width="22" height="5" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              <span>Archived Boards</span>
              <button class="modal-close" onClick={() => { setShowArchive(false); setConfirmDeleteId(null); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="archive-modal-body">
              <Show when={archiveLoading()}>
                <div class="archive-empty">Loading…</div>
              </Show>
              <Show when={!archiveLoading() && archivedBoards().length === 0}>
                <div class="archive-empty">No archived boards</div>
              </Show>
              <For each={archivedBoards()}>
                  {(board) => (
                    <div class="archive-board-item" tabindex="0">
                      <div class="archive-board-color" style={board.color ? { background: board.color } : {}} />
                      <span class="archive-card-title">{board.title}</span>
                      <div class="archive-card-actions">
                        <Show when={confirmDeleteId() === board.id} fallback={
                          <>
                            <button class="btn btn-sm" onClick={() => handleRestore(board.id)}>Restore</button>
                            <button class="btn btn-sm btn-danger" onClick={() => setConfirmDeleteId(board.id)}>Delete</button>
                          </>
                        }>
                          <span class="archive-confirm-text">Delete permanently?</span>
                          <button class="btn btn-sm btn-danger" onClick={() => handleDeleteArchived(board.id)}>Yes</button>
                          <button class="btn btn-sm" onClick={() => setConfirmDeleteId(null)}>No</button>
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
