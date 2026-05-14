import { createSignal, createResource, For, Show, onMount, onCleanup } from "solid-js";
import { A } from "@solidjs/router";
import { api } from "../api";
import ShortcutHelp from "../components/ShortcutHelp";

export default function Home() {
  const [boards, { refetch }] = createResource(() => api.listBoards());
  const [showHelp, setShowHelp] = createSignal(false);
  let lastMtime = 0;
  onMount(() => {
    const pollId = setInterval(async () => {
      try {
        const { mtime } = await api.checkChanges();
        if (mtime !== lastMtime) {
          lastMtime = mtime;
          refetch();
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

      if (e.key === "n") {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
      } else if (e.key === "Escape") {
        if (showHelp()) {
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
          const href = focused.getAttribute("href");
          const boardId = href?.replace("/board/", "");
          if (boardId) {
            e.preventDefault();
            handleDelete(boardId);
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

  const handleDelete = async (id: string) => {
    await api.deleteBoard(id);
    refetch();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  return (
    <div class="home">
      <div class="home-header">
        <h2>Your Boards</h2>
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
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(board.id); }}
                  title="Delete board"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
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

      <Show when={showHelp()}>
        <ShortcutHelp onClose={() => setShowHelp(false)} />
      </Show>
    </div>
  );
}
