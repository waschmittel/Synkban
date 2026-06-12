import { For, Show, createSignal, createEffect, onCleanup, type JSX } from "solid-js";
import { focusTrap } from "../focusTrap";
import { dialogKeys } from "../dialogKeys";
import { handleRovingArrow } from "../rovingFocus";

interface Props<T extends { id: string }> {
  title: string;
  items: T[];
  loading: boolean;
  emptyText: string;
  /// Item row class — also the e2e/CSS selector (`archive-card-item`,
  /// `archive-board-item`) and the ↑↓ navigation target.
  itemClass: string;
  /// Class for the Restore button (cards use `btn-primary`, boards don't).
  restoreClass?: string;
  renderItem: (item: T) => JSX.Element;
  onClose: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

/// Archive panel shared by archived cards (Board page) and archived boards
/// (Home page). Owns everything both adapters used to duplicate: the overlay +
/// modal frame, loading/empty states, auto-focus of the first row once loading
/// finishes, ↑↓ roving focus between rows, the inline "Delete permanently?"
/// confirmation (Yes auto-focused so Enter confirms), Escape-to-close, and
/// focusTrap wiring. Adapters supply only the row content and the API calls.
export default function ArchivePanel<T extends { id: string }>(props: Props<T>) {
  const [confirmDeleteId, setConfirmDeleteId] = createSignal<string | null>(null);
  let overlayRef!: HTMLDivElement;

  // Focus the first row as soon as loading finishes (or the modal container
  // when the archive is empty) so ↑↓ work without an initial click.
  createEffect(() => {
    if (props.loading) return;
    requestAnimationFrame(() => {
      const first = overlayRef.querySelector<HTMLElement>(`.${props.itemClass}`);
      if (first) first.focus();
      else overlayRef.querySelector<HTMLElement>(".archive-modal")?.focus();
    });
  });

  // Escape and ↑↓ are owned via dialogKeys so they work even before the
  // first-row auto-focus lands (next animation frame). The element-level
  // stopPropagation still shields the page's global shortcuts from all other
  // keys while focus is inside the modal.
  onCleanup(
    dialogKeys((e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        return;
      }
      if (handleRovingArrow(e, overlayRef, `.${props.itemClass}`)) {
        e.stopPropagation();
      }
    })
  );

  return (
    <div
      class="archive-overlay archive-modal-overlay"
      ref={(el) => { overlayRef = el; onCleanup(focusTrap(el)); }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div class="archive-modal" tabindex="-1">
        <div class="archive-modal-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
          <span>{props.title}</span>
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
          <Show when={!props.loading && props.items.length === 0}>
            <p class="archive-empty">{props.emptyText}</p>
          </Show>
          <For each={props.items}>
            {(item) => (
              <div class={props.itemClass} tabindex="0">
                {props.renderItem(item)}
                <div class="archive-card-actions">
                  <Show
                    when={confirmDeleteId() === item.id}
                    fallback={
                      <>
                        <button
                          class={props.restoreClass ?? "btn btn-sm"}
                          onClick={() => props.onRestore(item.id)}
                        >
                          Restore
                        </button>
                        <button
                          class="btn btn-danger btn-sm"
                          onClick={() => setConfirmDeleteId(item.id)}
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
                        props.onDelete(item.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Yes
                    </button>
                    <button class="btn btn-cancel btn-sm" onClick={() => setConfirmDeleteId(null)}>
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
