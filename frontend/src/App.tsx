import type { ParentProps } from "solid-js";
import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { BoardHeaderProvider, useBoardHeader } from "./BoardHeaderContext";
import { LabelDrawerProvider, useLabelDrawer } from "./LabelDrawerContext";

function AppHeader() {
  const header = useBoardHeader();
  const drawer = useLabelDrawer();

  return (
    <header class="app-header">
      <Show
        when={header.isOnBoard()}
        fallback={<A href="/" class="app-logo">Synkban</A>}
      >
        <A href="/" class="app-logo-home" title="Back to boards">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </A>
        <Show
          when={header.renaming()}
          fallback={
            <span
              class="app-logo app-logo--board"
              onClick={() => {
                header.setRenameValue(header.title());
                header.setRenaming(true);
              }}
              title="Click to rename"
            >
              {header.title()}
            </span>
          }
        >
          <input
            class="header-rename-input"
            type="text"
            ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
            value={header.renameValue()}
            onInput={(e) => header.setRenameValue(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); document.dispatchEvent(new CustomEvent("commit-board-rename")); }
              if (e.key === "Escape") { e.preventDefault(); header.setRenaming(false); }
            }}
            onBlur={() => document.dispatchEvent(new CustomEvent("commit-board-rename"))}
          />
        </Show>
      </Show>
      <div class="app-header-actions">
        <Show when={header.isOnBoard()}>
          <button
            class="btn-header-labels"
            classList={{ "btn-header-labels--active": drawer.isOpen() }}
            onClick={drawer.toggle}
            title="Manage labels"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Labels
          </button>
        </Show>
        <button
          class="btn-header-shortcuts"
          onClick={() =>
            document.dispatchEvent(new CustomEvent("toggle-shortcuts"))
          }
          title="Keyboard shortcuts"
        >
          <kbd>?</kbd>
        </button>
      </div>
    </header>
  );
}

export default function App(props: ParentProps) {
  return (
    <BoardHeaderProvider>
      <LabelDrawerProvider>
        <div class="app">
          <AppHeader />
          <main class="app-main">{props.children}</main>
        </div>
      </LabelDrawerProvider>
    </BoardHeaderProvider>
  );
}
