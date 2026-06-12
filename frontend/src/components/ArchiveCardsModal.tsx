import { For, Show, createSignal, onCleanup } from "solid-js";
import type { Card } from "../types";
import { renderTitle } from "./Card";
import { focusTrap } from "../focusTrap";

interface Props {
  cards: Card[];
  loading: boolean;
  onClose: () => void;
  onRestore: (cardId: string) => void;
  onDelete: (cardId: string) => void;
}

/// Modal listing a board's archived cards. Each row has Restore + Delete
/// (with inline "Delete permanently?" confirmation). Arrow keys navigate
/// between rows; Escape closes.
export default function ArchiveCardsModal(props: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);

  return (
    <div
      class="archive-overlay archive-modal-overlay"
      ref={(el) => onCleanup(focusTrap(el))}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") props.onClose();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = Array.from(
            (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".archive-card-item")
          );
          if (items.length === 0) return;
          const idx = items.indexOf(
            (document.activeElement?.closest(".archive-card-item") ?? null) as HTMLElement
          );
          const next = e.key === "ArrowDown"
            ? (idx < 0 ? 0 : Math.min(idx + 1, items.length - 1))
            : (idx < 0 ? items.length - 1 : Math.max(idx - 1, 0));
          items[next].focus();
        }
      }}
    >
      <div class="archive-modal" tabindex="-1">
        <div class="archive-modal-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          <span>Archived Cards</span>
          <button class="modal-close" onClick={props.onClose} title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="archive-modal-body">
          <Show when={props.loading}>
            <p class="archive-empty">Loading…</p>
          </Show>
          <Show when={!props.loading && props.cards.length === 0}>
            <p class="archive-empty">No archived cards.</p>
          </Show>
          <For each={props.cards}>
            {(card) => (
              <div class="archive-card-item" tabindex="0">
                <span class="archive-card-title" innerHTML={renderTitle(card.title)} />
                <div class="archive-card-actions">
                  <Show
                    when={confirmDeleteId() === card.id}
                    fallback={
                      <>
                        <button
                          class="btn btn-primary btn-sm"
                          onClick={() => props.onRestore(card.id)}
                        >
                          Restore
                        </button>
                        <button
                          class="btn btn-danger btn-sm"
                          onClick={() => setConfirmDeleteId(card.id)}
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
                      onClick={() => {
                        props.onDelete(card.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Yes
                    </button>
                    <button
                      class="btn btn-cancel btn-sm"
                      onClick={() => setConfirmDeleteId(null)}
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
  );
}
