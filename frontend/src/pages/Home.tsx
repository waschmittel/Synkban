import { createSignal, createResource, For, Show, onMount, onCleanup } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "../api";
import type { Board } from "../types";
import ShortcutHelp from "../components/ShortcutHelp";

export default function Home() {
  const [boards, { refetch }] = createResource(() => api.listBoards());
  const [archivedBoards, { refetch: refetchArchived }] = createResource(() => api.listArchivedBoards());
  const [showHelp, setShowHelp] = createSignal(false);
  const [showArchive, setShowArchive] = createSignal(false);
  const [confirmArchiveId, setConfirmArchiveId] = createSignal<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);
  let lastMtime = 0;

  onMount(() => {
    const pollId = setInterval(async () => {
      try {
        const { mtime } = await api.checkChanges();
        if (mtime !== lastMtime) {
          lastMtime = mtime;
          refetch();
          if (showArchive()) refetchArchived();
        }
      } catch { /* ignore poll errors */ }
    }, 15000);

    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) return;
      if (target.closest?.(".shortcut-help-overlay")) return;
      if (target.closest?.(".archive-modal-overlay")) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShowArchive(false);
          setConfirmDeleteId(null);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
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
        return;
      }

      if (e.key === "n") {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === "a") {
        e.preventDefault();
        setShowArchive(v => !v);
        if (!showArchive()) refetchArchived();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
      } else if (e.key === "Escape") {
        if (confirmArchiveId()) {
          setConfirmArchiveId(null);
        } else if (showHelp()) {
          setShowHelp(false);
        } else if (adding()) {
          close();
        }
      } else if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
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
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const focused = document.activeElement as HTMLElement;
        if (focused?.classList.contains("board-card")) {
          const boardId = focused.getAttribute("data-board-id");
          if (boardId) {
            e.preventDefault();
            handleArchive(boardId);
          }
        }
      }
    };

    const handleToggleShortcuts = () => setShowHelp((v) => !v);

    document.addEventListener("keydown", handleKey);
    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    onCleanup(() => {
      clearInterval(pollId);
      document.removeEventListener("keydown", handleKey);
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

  const handleArchive = (id: string) => {
    setConfirmArchiveId(id);
  };

  const confirmArchive = async () => {
    const id = confirmArchiveId();
    if (!id) return;
    await api.archiveBoard(id);
    setConfirmArchiveId(null);
    refetch();
    if (showArchive()) refetchArchived();
  };

  const handleRestore = async (id: string) => {
    await api.restoreBoard(id);
    refetchArchived();
    refetch();
  };

  const handleDeleteArchived = async (id: string) => {
    await api.deleteBoard(id);
    setConfirmDeleteId(null);
    refetchArchived();
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
        <Show when={archivedBoards() && archivedBoards()!.length > 0}>
          <button
            class={`board-archive-toggle ${showArchive() ? "board-archive-toggle--active" : ""}`}
            onClick={() => { setShowArchive(v => !v); if (!showArchive()) refetchArchived(); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            Archive ({archivedBoards()!.length})
          </button>
        </Show>
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

      {/* Archive confirmation dialog */}
      <Show when={confirmArchiveId()}>
        <div class="unsaved-overlay" onClick={() => setConfirmArchiveId(null)} onKeyDown={(e) => { if (e.key === "Escape") setConfirmArchiveId(null); }}>
          <div class="unsaved-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Archive "{getBoardTitle(confirmArchiveId()!)}"?</p>
            <div class="unsaved-dialog-actions">
              <button
                class="btn btn-primary"
                ref={(el) => requestAnimationFrame(() => el.focus())}
                onClick={confirmArchive}
              >
                Archive
              </button>
              <button class="btn" onClick={() => setConfirmArchiveId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Archived boards panel */}
      <Show when={showArchive()}>
        <div class="archive-modal-overlay" onClick={() => { setShowArchive(false); setConfirmDeleteId(null); }} onKeyDown={(e) => { if (e.key === "Escape") { setShowArchive(false); setConfirmDeleteId(null); } }}>
          <div class="archive-modal" onClick={(e) => e.stopPropagation()}>
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
              <Show when={archivedBoards() && archivedBoards()!.length > 0} fallback={<div class="archive-empty">No archived boards</div>}>
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
              </Show>
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
