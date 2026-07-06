import type { ParentProps } from "solid-js";
import { createSignal, Show } from "solid-js";
import { A } from "@solidjs/router";
import { BoardHeaderProvider, useBoardHeader } from "./BoardHeaderContext";
import { LabelDrawerProvider, useLabelDrawer } from "./LabelDrawerContext";
import SettingsDialog from "./components/SettingsDialog";

function AppHeader(props: { onOpenSettings: () => void }) {
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
            <button
              class="app-logo app-logo--board"
              onClick={() => {
                header.setRenameValue(header.title());
                header.setRenaming(true);
              }}
              title="Click to rename"
            >
              {header.title()}
            </button>
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
        <Show when={!header.isOnBoard()}>
          <button
            class="btn-header-settings"
            onClick={props.onOpenSettings}
            title="Settings"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Show>
      </div>
    </header>
  );
}

export default function App(props: ParentProps) {
  // Rendered as a sibling of the header, not inside it — the header is the
  // Electron window drag region and must not contain the overlay.
  const [showSettings, setShowSettings] = createSignal(false);

  return (
    <BoardHeaderProvider>
      <LabelDrawerProvider>
        <div class="app">
          <AppHeader onOpenSettings={() => setShowSettings(true)} />
          <main class="app-main">{props.children}</main>
          <Show when={showSettings()}>
            <SettingsDialog onClose={() => setShowSettings(false)} />
          </Show>
        </div>
      </LabelDrawerProvider>
    </BoardHeaderProvider>
  );
}
