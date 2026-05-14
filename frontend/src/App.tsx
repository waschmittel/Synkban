import type { ParentProps } from "solid-js";
import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { LabelProvider, useLabelContext } from "./LabelContext";

function AppHeader() {
  const lc = useLabelContext();

  return (
    <header class="app-header">
      <Show
        when={lc.hasBoard()}
        fallback={<A href="/" class="app-logo">Synkban</A>}
      >
        <A href="/" class="app-logo-home" title="Back to boards">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </A>
        <span
          class="app-logo app-logo--board"
          onClick={() => document.dispatchEvent(new CustomEvent("start-board-rename"))}
          title="Click to rename"
        >
          {lc.boardTitle()}
        </span>
      </Show>
      <div class="app-header-actions">
        <Show when={lc.hasBoard()}>
          <button
            class="btn-header-labels"
            classList={{ "btn-header-labels--active": lc.isOpen() }}
            onClick={lc.toggle}
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
    <LabelProvider>
      <div class="app">
        <AppHeader />
        <main class="app-main">{props.children}</main>
      </div>
    </LabelProvider>
  );
}
