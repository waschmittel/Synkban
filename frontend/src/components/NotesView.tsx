import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import type { Card as CardType, Label, ListWithCards } from "../types";
import List from "./List";
import AddForm from "./AddForm";
import type { SideKey } from "./Card";
import { tip } from "../platform";

interface Props {
  boardId: string;
  /// All lists (tabs, counts) and the same lists filtered (master content).
  lists: ListWithCards[];
  filtered: ListWithCards[];
  filtering: boolean;
  labels: Label[];
  activeListId: string | null;
  selectedCardId: string | null;
  /// The card with unsaved edits (dot on it and on its list's tab).
  dirtyCardId: string | null;
  renamingListId: string | null;
  /// The detail pane (a `CardDetail` in pane variant), or nothing selected.
  detail: JSX.Element;
  onSelectList: (listId: string) => void;
  onCardClick: (card: CardType, byKey?: boolean) => void;
  onCardFocus: (card: CardType) => void;
  onSideKey: (card: CardType, dir: -1 | 1, kind: SideKey) => void;
  onDropOnList: (cardId: string, listId: string) => void;
  onAddList: (title: string) => void;
  onAddCard: (listId: string, title: string) => void;
  onArchiveCard: (cardId: string) => void;
  onDeleteList: (listId: string) => void;
  onDropCard: (cardId: string, targetListId: string, position: number) => void;
  onMoveCard: (cardId: string, targetListId: string, position: number) => void;
  onMoveList: (listId: string, position: number) => void;
  onRequestRename: (listId: string | null) => void;
  /// `refocus`: Enter in the tab, the keyboard goes back to the cards.
  onRenameList: (listId: string, title: string, refocus?: boolean) => void;
  /// Esc in the tab's rename input.
  onRenameCancel: () => void;
}

/// Notes mode (ADR-0022): lists as tabs, the active list's cards as the
/// master column (the board's own `List`/`Card`), the selected card beside it.
export default function NotesView(props: Props) {
  let tabsEl!: HTMLElement;
  const [dropListId, setDropListId] = createSignal<string | null>(null);
  const active = () => props.filtered.find((l) => l.id === props.activeListId);
  const dirtyListId = () =>
    props.dirtyCardId ? props.lists.find((l) => l.cards.some((c) => c.id === props.dirtyCardId))?.id : undefined;
  const count = (list: ListWithCards) => {
    const shown = props.filtered.find((l) => l.id === list.id)?.cards.length ?? 0;
    return props.filtering ? `${shown}/${list.cards.length}` : `${list.cards.length}`;
  };

  // Many lists scroll the strip: keep the active tab in view.
  createEffect(() => {
    const id = props.activeListId;
    requestAnimationFrame(() =>
      tabsEl
        ?.querySelector<HTMLElement>(`.notes-tab[data-list-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
  });

  const isCardDrag = (e: DragEvent) => !!e.dataTransfer?.types.includes("application/card-id");

  return (
    <div class="notes-view">
      <nav class="notes-tabs" ref={tabsEl} aria-label="Lists">
        <For each={props.lists}>
          {(list) => {
            const isActive = () => list.id === props.activeListId;
            const renaming = () => props.renamingListId === list.id;
            // Enter/Esc settle the rename; the blur from the input unmounting mustn't commit again.
            let settled = false;
            return (
              <div
                class="notes-tab"
                classList={{
                  "notes-tab--active": isActive(),
                  "notes-tab--drop": list.id === dropListId(),
                }}
                role="tab"
                aria-selected={isActive()}
                data-list-id={list.id}
                onDragOver={(e) => {
                  if (!isCardDrag(e)) return;
                  e.preventDefault();
                  e.dataTransfer!.dropEffect = "move";
                  setDropListId(list.id);
                }}
                onDragLeave={() => setDropListId((id) => (id === list.id ? null : id))}
                onDrop={(e) => {
                  setDropListId(null);
                  const cardId = e.dataTransfer?.getData("application/card-id");
                  if (!cardId) return;
                  e.preventDefault();
                  props.onDropOnList(cardId, list.id);
                }}
              >
                <Show
                  when={renaming()}
                  fallback={
                    <button
                      class="notes-tab-btn"
                      // The active tab is the list title: clicking it renames, as on the board.
                      title={isActive() ? tip(`${list.title} · click to rename`, "R") : tip(list.title, "← / →")}
                      onClick={() => (isActive() ? props.onRequestRename(list.id) : props.onSelectList(list.id))}
                      onKeyDown={(e) => {
                        if (isActive() && (e.key === "Enter" || e.key === "F2" || e.key === "r")) {
                          e.preventDefault();
                          e.stopPropagation();
                          props.onRequestRename(list.id);
                        }
                      }}
                    >
                      <Show when={dirtyListId() === list.id}>
                        <span class="dirty-dot" title="Unsaved changes in this list" />
                      </Show>
                      <span class="notes-tab-title">{list.title}</span>
                      <span class="notes-tab-count">{count(list)}</span>
                    </button>
                  }
                >
                  <input
                    ref={(el) => {
                      settled = false;
                      requestAnimationFrame(() => { el.focus(); el.select(); });
                    }}
                    class="list-title-input notes-tab-input"
                    type="text"
                    value={list.title}
                    size={Math.max(8, list.title.length + 1)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        settled = true;
                        props.onRenameList(list.id, e.currentTarget.value, true);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        settled = true;
                        props.onRenameCancel();
                      }
                    }}
                    onBlur={(e) => !settled && props.onRenameList(list.id, e.currentTarget.value)}
                  />
                </Show>
                <Show when={isActive() && !renaming()}>
                  <button class="notes-tab-delete" title="Delete list" onClick={() => props.onDeleteList(list.id)}>
                    &times;
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
        <div class="add-list-wrapper">
          <AddForm
            placeholder="List title..."
            buttonText="Add list"
            shortcut="L"
            draftKey={`list:${props.boardId}`}
            onAdd={props.onAddList}
          />
        </div>
      </nav>
      <div class="notes-body">
        <Show
          when={active() || props.selectedCardId}
          fallback={
            <div class="notes-placeholder">
              <b>No lists yet</b>
              <span>Notes live in lists. Press <kbd>L</kbd> to add one.</span>
            </div>
          }
        >
          <div
            class="notes-master"
            onFocusIn={(e) => {
              const id = (e.target as HTMLElement).closest<HTMLElement>(".card[data-card-id]")?.dataset.cardId;
              const card = active()?.cards.find((c) => c.id === id);
              if (card) props.onCardFocus(card);
            }}
          >
            <Show when={active()}>
              {(list) => (
                <List
                  list={list()}
                  hideHeader
                  labels={props.labels}
                  renamingListId={props.renamingListId}
                  selectedCardId={props.selectedCardId}
                  emptyText={props.filtering ? "No matching cards." : "No cards in this list."}
                  onSideKey={props.onSideKey}
                  onAddCard={props.onAddCard}
                  onArchiveCard={props.onArchiveCard}
                  onDeleteList={props.onDeleteList}
                  onCardClick={props.onCardClick}
                  onDropCard={props.onDropCard}
                  onMoveCard={props.onMoveCard}
                  onMoveList={props.onMoveList}
                  onRequestRename={props.onRequestRename}
                  onRenameList={props.onRenameList}
                />
              )}
            </Show>
          </div>
          <div class="notes-detail-slot">
            <Show
              when={props.selectedCardId}
              fallback={
                <div class="notes-placeholder">
                  <b>No card selected</b>
                  <span>Select a card or press <kbd>N</kbd>.</span>
                </div>
              }
            >
              {props.detail}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
