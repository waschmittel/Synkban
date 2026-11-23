import {
  createResource,
  createSignal,
  createEffect,
  batch,
  createMemo,
  untrack,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";
import { useParams, useNavigate, useBeforeLeave, A } from "@solidjs/router";
import {
  api,
  clearActionError,
  errorMessage,
  isNetworkError,
  isNotFoundError,
  reportActionError,
} from "../api";
import type { Board, BoardDetail, BoardMode, Card as CardType, ChecklistItem, Draft } from "../types";
import List from "../components/List";
import AddForm from "../components/AddForm";
import CardDetail, { type CardDetailControl } from "../components/CardDetail";
import NotesView from "../components/NotesView";
import type { SideKey } from "../components/Card";
import ShortcutHelp, { helpContextOf, type HelpContext } from "../components/ShortcutHelp";
import LabelDrawer from "../components/LabelDrawer";
import ArchivePanel from "../components/ArchivePanel";
import NetworkBanner from "../components/NetworkBanner";
import WarningBanner from "../components/WarningBanner";
import { renderTitle } from "../components/Card";
import FilterBar from "../components/FilterBar";
import BoardColorPicker from "../components/BoardColorPicker";
import { createConfirm } from "../confirm";
import { useBoardHeader } from "../BoardHeaderContext";
import { useLabelDrawer } from "../LabelDrawerContext";
import { crossListInsertPosition, listDropPosition, moveToBottom } from "../positions";
import { adjacentList, listOfCard, pickCard, resolveSelection } from "../notesView";
import { cardMatchesFilter as filterCard, type DueFilter } from "../filter";
import { findLabel, parseQuickAdd } from "../quickAdd";
import { focusAdjacentList, focusListEntry, isHorizontalNavigation, resetPreferredRow } from "../listFocus";
import { draftCard } from "../cardContent";
import { isTypingIn, isInUiOverlay } from "../boardInput";
import { recordLastBoard } from "../settings";
import { createFocusRestoration } from "../focusRestoration";
import {
  trackBoardView,
  restoreBoardView,
  restoreBoardScroll,
  recordBoardFilter,
  rememberedFilter,
  forgetBoardViews,
  lastFocusedCard,
  notesCardFor,
  rememberNotesCard,
} from "../boardView";
import { startChangePoller } from "../changePoller";
import { registerShortcuts, type ShortcutDef } from "../shortcutRouter";
import { tip } from "../platform";

export default function BoardPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const header = useBoardHeader();
  const drawer = useLabelDrawer();

  let lastValidBoardId: string | null = null;
  const [board, { refetch }] = createResource<BoardDetail, string>(
    () => params.id,
    async (id, { value }) => {
      try {
        const res = await api.getBoard(id);
        lastValidBoardId = id;
        return res;
      } catch (err) {
        if (value && value.id === id && lastValidBoardId === id && isNetworkError(err)) {
          return value;
        }
        if (!isNetworkError(err)) lastValidBoardId = null;
        throw err;
      }
    }
  );
  const focus = createFocusRestoration(board);
  const confirm = createConfirm();

  // All active boards in Home-screen order (position ASC) — drives the bottom
  // dock and Ctrl+Arrow board cycling.
  let hasLoadedBoards = false;
  const [allBoards, { refetch: refetchBoards }] = createResource<Board[]>(
    async (_, { value }) => {
      try {
        const res = await api.listBoards();
        hasLoadedBoards = true;
        return res;
      } catch (err) {
        if (value && hasLoadedBoards && isNetworkError(err)) return value;
        if (!isNetworkError(err)) hasLoadedBoards = false;
        throw err;
      }
    }
  );
  const boardList = () => (allBoards.error ? [] : allBoards() ?? []);
  // Steps requested before the list is (re)loaded run once it is: a quick '.'
  // right after opening a board must not be dropped. A failed load drops them.
  const [pendingCycle, setPendingCycle] = createSignal(0);
  const cycleBoard = (dir: 1 | -1) =>
    batch(() => {
      if (allBoards.error) refetchBoards();
      setPendingCycle((n) => n + dir);
    });
  createEffect(() => {
    const steps = pendingCycle();
    if (!steps || allBoards.loading) return;
    setPendingCycle(0);
    const list = untrack(boardList);
    if (list.length < 2) return;
    const idx = list.findIndex((b) => b.id === untrack(() => params.id));
    if (idx < 0) return;
    const next = (((idx + steps) % list.length) + list.length) % list.length;
    navigate(`/board/${list[next].id}`);
  });

  const [selectedCard, setSelectedCard] = createSignal<CardType | null>(null);
  /// The open card (modal or Notes pane) while it has unsaved edits.
  const [dirtyCardId, setDirtyCardId] = createSignal<string | null>(null);
  const trackDirty = (id: string) => (d: boolean) =>
    setDirtyCardId((cur) => (d ? id : cur === id ? null : cur));
  const [warnings, setWarnings] = createSignal<string[]>([]);
  const refreshWarnings = () =>
    api.getWarnings().then((r) => setWarnings(r.warnings)).catch(() => {});
  const [showHelp, setShowHelp] = createSignal(false);
  const [helpContext, setHelpContext] = createSignal<HelpContext>("board");
  const toggleHelp = () => {
    if (!showHelp()) setHelpContext(helpContextOf(document.activeElement, notes()));
    setShowHelp((v) => !v);
  };
  const [showColorPicker, setShowColorPicker] = createSignal(false);

  // Archive state
  const [showArchive, setShowArchive] = createSignal(false);
  const [archivedCards, setArchivedCards] = createSignal<CardType[]>([]);
  const [archiveLoading, setArchiveLoading] = createSignal(false);
  const [archiveError, setArchiveError] = createSignal<string | null>(null);

  const retryBoard = () => {
    clearActionError();
    focus.capturePending();
    refetch();
    refetchBoards();
    refreshWarnings();
  };

  // Filter state
  const [showFilterBar, setShowFilterBar] = createSignal(false);
  const [filterText, setFilterText] = createSignal("");
  const [filterLabelIds, setFilterLabelIds] = createSignal<string[]>([]);
  const [filterDue, setFilterDue] = createSignal<DueFilter>(null);

  // List rename state
  const [renamingListId, setRenamingListId] = createSignal<string | null>(null);

  // --- Board mode (ADR-0022) ---
  // Applied from board.json once per visit (not on polls, so a toggle on
  // another device can't flip the screen mid-edit); toggling writes it back.
  const [mode, setMode] = createSignal<BoardMode>("kanban");
  const notes = () => mode() === "notes";
  const [activeListId, setActiveListId] = createSignal<string | null>(null);
  const [notesCardId, setNotesCardId] = createSignal<string | null>(null);
  const [removed, setRemoved] = createSignal(false);
  let notesIndex = 0; // index of the selected card, picks a replacement when it vanishes
  let lastPaneCard: CardType | undefined;
  let pane: CardDetailControl | undefined;
  const allLists = () => (board.error ? [] : board()?.lists ?? []);
  const paneCard = createMemo(() => {
    const id = notesCardId();
    if (!id) return undefined;
    const card = allLists().flatMap((l) => l.cards).find((c) => c.id === id);
    if (card) lastPaneCard = card;
    return card ?? (lastPaneCard?.id === id ? lastPaneCard : undefined);
  });
  const paneDirty = () => notes() && !!paneCard() && !!pane?.dirty();
  /// True when leaving the pane's card is fine (clean, saved or discarded).
  const confirmLeavePane = async () => !paneDirty() || (await pane!.confirmLeave());

  const focusMasterCard = (cardId: string | null) => {
    const q = (sel: string) => document.querySelector<HTMLElement>(`.notes-master ${sel}`);
    (
      (cardId && q(`.card[data-card-id="${cardId}"]`)) ||
      q(".card") ||
      q(".add-trigger") ||
      pageEl
    )?.focus();
  };

  const selectNotes = (listId: string | null, cardId: string | null) => {
    batch(() => {
      setActiveListId(listId);
      setNotesCardId(cardId);
      setRemoved(false);
    });
    const list = allLists().find((l) => l.id === listId);
    notesIndex = Math.max(0, list?.cards.findIndex((c) => c.id === cardId) ?? 0);
    if (listId) rememberNotesCard(params.id, listId, cardId);
    if (cardId) focus.setLastFocused(cardId);
  };

  /// Entering Notes: the card focused on the board (either mode) wins, then
  /// the first list with its last shown card.
  const enterNotes = () => {
    const lists = allLists();
    const focused = lastFocusedCard(params.id);
    const holder = listOfCard(lists, focused);
    const list = holder ?? lists[0];
    selectNotes(list?.id ?? null, holder ? focused : pickCard(list, list && notesCardFor(params.id, list.id)));
  };

  const switchMode = async (next: BoardMode) => {
    const b = board();
    if (!b || next === mode() || !(await confirmLeavePane())) return;
    const cardId = notesCardId();
    setMode(next);
    if (next === "notes") {
      enterNotes();
      requestAnimationFrame(() => focusMasterCard(notesCardId()));
    } else if (cardId) focus.preserve(cardId);
    api.updateBoard(b.id, { mode: next }).catch((err) => reportActionError(err, "Could not save view mode"));
  };

  /// Enter (`focusDescription`) goes on to the description; a click keeps the
  /// focus on the card, so the arrows go on working.
  const selectNotesCard = async (card: CardType, focusDescription: boolean) => {
    if (card.id !== notesCardId()) {
      if (!(await confirmLeavePane())) return focusMasterCard(notesCardId());
      selectNotes(card.list_id, card.id);
    }
    // Synchronously: keys typed right after Enter must land in the editor.
    // (The pane for a new card mounts within `selectNotes`.)
    if (focusDescription) pane?.focusDescription();
    else focusMasterCard(card.id);
  };

  /// Clean pane: focusing a card (arrows, Tab) shows it. Dirty: focus just
  /// moves; Enter/click asks first.
  const handleNotesFocus = (card: CardType) => {
    if (card.id !== notesCardId() && !paneDirty()) selectNotes(card.list_id, card.id);
  };

  const selectNotesList = async (listId: string, focusCard = false) => {
    if (listId !== activeListId()) {
      const list = filteredLists().find((l) => l.id === listId);
      const cardId = pickCard(list, notesCardFor(params.id, listId));
      if (cardId !== notesCardId() && !(await confirmLeavePane())) return focusMasterCard(notesCardId());
      selectNotes(listId, cardId);
    }
    // Synchronously (Solid has patched the DOM): a fast next key must find the
    // focus on the new list, not on <body>. The rAF covers a late mount (and
    // leaves alone a focus the user has moved on meanwhile).
    if (focusCard) {
      focusMasterCard(notesCardId());
      requestAnimationFrame(() => document.activeElement === document.body && focusMasterCard(notesCardId()));
    }
  };

  const handleSideKey = (card: CardType, dir: -1 | 1, kind: SideKey) => {
    const lists = allLists();
    if (kind === "moveList") return moveListByKey(card.list_id, dir < 0 ? "left" : "right");
    const adj = adjacentList(lists, card.list_id, dir);
    if (!adj) return;
    if (kind === "focus") return selectNotesList(adj.id, true);
    const idx = lists.find((l) => l.id === card.list_id)?.cards.findIndex((c) => c.id === card.id) ?? 0;
    handleMoveCard(card.id, adj.id, crossListInsertPosition(adj.cards.map((c) => c.position), idx));
  };

  /// A card dropped on a list tab goes to the bottom of that list.
  const handleDropOnList = async (cardId: string, listId: string) => {
    const target = allLists().find((l) => l.id === listId);
    if (!target || target.cards.some((c) => c.id === cardId)) return;
    const last = target.cards[target.cards.length - 1];
    try {
      await api.updateCard(cardId, { list_id: listId, position: last ? moveToBottom(last.position) : 1 });
      refetch();
    } catch (err) {
      reportActionError(err, "Could not move card");
    }
  };

  // Keep the selection valid across refetches (moves, archives, deletions,
  // other devices): see `resolveSelection`.
  createEffect(() => {
    if (!notes() || board.error) return;
    const b = board();
    if (!b || b.id !== params.id) return;
    untrack(() => {
      const sel = resolveSelection(
        b.lists,
        { listId: activeListId(), cardId: notesCardId(), index: notesIndex },
        paneDirty(),
      );
      if (sel.removed) setRemoved(true);
      else if (sel.listId !== activeListId() || sel.cardId !== notesCardId() || removed())
        selectNotes(sel.listId, sel.cardId);
      else notesIndex = Math.max(0, b.lists.find((l) => l.id === sel.listId)?.cards.findIndex((c) => c.id === sel.cardId) ?? 0);
    });
  });

  // Unsaved pane edits survive neither navigation (dock, `,`/`.`, `b`) nor
  // closing the window without asking.
  useBeforeLeave((e) => {
    if (e.defaultPrevented || !paneDirty()) return;
    e.preventDefault();
    pane!.confirmLeave().then((ok) => ok && e.retry(true));
  });
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (paneDirty()) e.preventDefault();
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  onCleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));

  createEffect(() => {
    // Reading an errored resource throws; bail out before touching board().
    const color = (board.error ? undefined : board()?.color) ?? "#0079bf";
    document.documentElement.style.setProperty("--board-color", color);
  });

  createEffect(() => {
    const b = board.error ? undefined : board();
    header.setTitle(b && b.id === params.id ? b.title : "");
  });

  // Remember each board's active card and scroll offsets while switching
  // boards (ADR-0021). `shownId` is the board whose DOM is rendered: the
  // resource keeps the old board on screen until the new one has loaded.
  let pageEl!: HTMLDivElement;
  const shownId = () => (board.error ? undefined : board()?.id);
  // `restoredFor` is the board the view signals (filter) currently belong to.
  let restoredFor: string | undefined;
  let restoring = false;
  createEffect(() => {
    const id = shownId();
    if (!id || id !== params.id) return;
    if (id === restoredFor) {
      // Refetch (card dialog closed, poll): new list nodes start scrolled to top.
      restoreBoardScroll(pageEl, id);
      return;
    }
    restoredFor = id;
    const b = board();
    batch(() => {
      setMode(b?.mode ?? "kanban");
      setNotesCardId(null);
      setActiveListId(null);
      setRemoved(false);
    });
    if (notes()) enterNotes();
    reopenDraft(id);
    const f = rememberedFilter(id, b?.labels.map((l) => l.id) ?? []);
    restoring = true;
    batch(() => {
      setShowFilterBar(f?.open ?? false);
      setFilterText(f?.text ?? "");
      setFilterLabelIds(f?.labelIds ?? []);
      setFilterDue(f?.due ?? null);
    });
    // After the filtered lists have rendered, so offsets aren't clamped.
    queueMicrotask(() => {
      restoring = false;
      if (shownId() === id && params.id === id) restoreBoardView(pageEl, id);
    });
  });
  // Crash safety (ADR-0024): the one draft of this board reopens its card,
  // if nobody changed the card since; otherwise it's dropped. Read once at
  // mount by the CardDetail it opens.
  let pendingDraft: Draft | null = null;
  const takeDraft = (cardId: string) => {
    const d = pendingDraft?.card_id === cardId ? pendingDraft : undefined;
    if (d) pendingDraft = null;
    return d;
  };
  const reopenDraft = async (id: string) => {
    let draft: Draft | null;
    try {
      draft = await api.getDraft();
    } catch {
      return;
    }
    const b = board();
    if (!draft || draft.board_id !== id || !b || b.id !== id || params.id !== id) return;
    const card = draftCard(draft, b.lists.flatMap((l) => l.cards));
    if (!card) return void api.deleteDraft(draft.card_id).catch(() => {});
    if (selectedCard() || paneDirty()) return;
    pendingDraft = draft;
    if (notes()) {
      // Already shown (remembered card): remount the pane to start from the draft.
      if (notesCardId() === card.id) {
        selectNotes(card.list_id, null);
        await Promise.resolve();
      }
      selectNotes(card.list_id, card.id);
      focusMasterCard(card.id);
    } else {
      focus.setLastFocused(card.id);
      setSelectedCard(card);
    }
  };
  createEffect(() => {
    const f = { open: showFilterBar(), text: filterText(), labelIds: filterLabelIds(), due: filterDue() };
    if (restoredFor) recordBoardFilter(restoredFor, f);
  });
  // Forget views of boards that are gone.
  createEffect(() => {
    const list = allBoards.error ? undefined : allBoards();
    if (list) forgetBoardViews(list.map((b) => b.id));
  });

  // The dock scrolls once there are more boards than fit the window, so the
  // dot for the board you're actually on has to be brought back into it.
  createEffect(() => {
    params.id;
    boardList();
    document
      .querySelector(".board-dock-dot--active")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  });

  // Remember the last board that actually loaded, for the "open last used
  // board on startup" preference. Stale ids (deleted/archived boards) are
  // filtered out server-side by GET /api/settings, so no clearing here.
  createEffect(() => {
    if (board.error) return;
    if (board()) recordLastBoard(params.id);
  });

  onMount(() => {
    clearActionError();
    const stopTracking = trackBoardView(pageEl, shownId);
    header.setIsOnBoard(true);
    const loadedBoard = () => (board.error ? undefined : board());
    header.setControls({
      left: () => (
        <Show when={loadedBoard()}>
          <div class="board-mode-switch" role="group" aria-label="View">
            <button
              class="board-mode-btn"
              classList={{ "board-mode-btn--active": !notes() }}
              aria-pressed={!notes()}
              onClick={() => switchMode("kanban")}
              title={tip("Board view", "V")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="5" height="16" rx="1" />
                <rect x="10" y="4" width="5" height="11" rx="1" />
                <rect x="17" y="4" width="4" height="7" rx="1" />
              </svg>
              Board
            </button>
            <button
              class="board-mode-btn"
              classList={{ "board-mode-btn--active": notes() }}
              aria-pressed={notes()}
              onClick={() => switchMode("notes")}
              title={tip("Notes view", "V")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
                <line x1="12" y1="9" x2="18" y2="9" />
                <line x1="12" y1="13" x2="18" y2="13" />
              </svg>
              Notes
            </button>
          </div>
          <button
            class="header-btn board-filter-btn"
            classList={{ "header-btn--active": showFilterBar() || isFiltering() }}
            onClick={() => setShowFilterBar((v) => !v)}
            title={tip("Filter cards", "F")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter
          </button>
        </Show>
      ),
      right: () => (
        <Show when={loadedBoard()}>
          {(b) => (
            <>
              <button
                class="header-btn header-btn--icon board-archive-btn"
                onClick={openArchive}
                title={tip("View archived cards", "A")}
                aria-label="View archived cards"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
              </button>
              <BoardColorPicker
                open={showColorPicker()}
                currentColor={b().color}
                onToggle={() => setShowColorPicker((v) => !v)}
                onSelect={handleSetBoardColor}
                onPreview={(c) => document.documentElement.style.setProperty("--board-color", c)}
              />
            </>
          )}
        </Show>
      ),
    });
    refreshWarnings();

    // Watch only this board's mtime so quiet boards don't trigger refetch when
    // another board changes. Falls back to the global mtime if the server
    // doesn't (yet) provide the per-board map.
    const stopPoller = startChangePoller({
      select: (r) => r.boards?.[params.id] ?? r.mtime,
      onChange: () => {
        focus.capturePending();
        refetch();
        if (allBoards.error || !allBoards()) refetchBoards();
        refreshWarnings();
      },
    });

    // An already-open form has no trigger to click (and may have lost focus
    // without closing), so the shortcut re-focuses its input instead.
    const openOrFocusAdd = (scope: Element | null | undefined) => {
      const input = scope?.querySelector<HTMLElement>(".add-form input");
      if (input) {
        input.focus();
        return;
      }
      scope?.querySelector<HTMLElement>(".add-trigger")?.click();
    };
    const triggerAddList = () => {
      openOrFocusAdd(document.querySelector(".add-list-wrapper"));
    };
    const triggerAddCard = () => {
      // The list holding the focus, else the one with an open form, else the first.
      const list =
        document.activeElement?.closest(".list:not(.list--collapsed)") ??
        document.querySelector(".list:has(.add-form)") ??
        document.querySelector(".list:not(.list--collapsed)");
      openOrFocusAdd(list);
    };
    const navigateArrow = (e: KeyboardEvent) => {
      const focused = document.activeElement as HTMLElement | null;
      const isCard = focused?.classList.contains("card");
      const isCardListTrigger =
        focused?.classList.contains("add-trigger") &&
        !!focused.closest(".list") &&
        !focused.closest(".add-list-wrapper");

      if (notes() && !isCard) {
        // One list on screen: the arrows start from the selected card, and
        // ←/→ on the add trigger switch tabs like they do on a card.
        e.preventDefault();
        if (isCardListTrigger && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          const adj = adjacentList(allLists(), activeListId(), e.key === "ArrowLeft" ? -1 : 1);
          if (adj) selectNotesList(adj.id, true);
          return;
        }
        if (isCardListTrigger && e.key === "ArrowUp") {
          const cards = document.querySelectorAll<HTMLElement>(".notes-master .card");
          return cards[cards.length - 1]?.focus();
        }
        if (!isCardListTrigger) focusMasterCard(notesCardId());
      } else if (!isCard && !isCardListTrigger) {
        e.preventDefault();
        const lists = document.querySelectorAll(".list");
        if (e.key === "ArrowDown" || e.key === "ArrowRight") focusListEntry(lists[0]);
        else focusListEntry(lists[lists.length - 1], true);
      } else if (isCardListTrigger) {
        const currentList = focused!.closest(".list") as HTMLElement;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const adj = (e.key === "ArrowLeft"
            ? currentList.previousElementSibling
            : currentList.nextElementSibling) as HTMLElement | null;
          if (adj?.classList.contains("list")) focusAdjacentList(adj, null, e.key === "ArrowLeft");
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          resetPreferredRow();
          const cards = currentList.querySelectorAll<HTMLElement>(".card");
          cards[cards.length - 1]?.focus();
        }
      }
    };

    // ESC handlers are ordered: first matching `canFire` wins. Stack matches
    // the visual layering — help overlay above archive, above color picker, etc.
    const escDefs: ShortcutDef[] = [
      { key: "Escape", canFire: () => showHelp(), handler: () => setShowHelp(false) },
      { key: "Escape", canFire: () => showArchive(), handler: () => setShowArchive(false) },
      { key: "Escape", canFire: () => showColorPicker(), handler: () => setShowColorPicker(false) },
      // Fires when focus is outside the modal (e.g. on <body> after a dialog
      // closed). Ask CardDetail to close so its unsaved-changes guard runs —
      // closing directly here would discard dirty state without confirmation.
      {
        key: "Escape",
        canFire: () => !!selectedCard(),
        handler: () => document.dispatchEvent(new CustomEvent("request-card-close")),
      },
      { key: "Escape", canFire: () => !!renamingListId(), handler: () => setRenamingListId(null) },
      { key: "Escape", canFire: () => header.renaming(), handler: () => header.setRenaming(false) },
      // Notes: Esc from anywhere (pane background, title bar, …) brings the
      // keyboard back to the selected card — via the pane's guard, as Esc
      // inside it does. Already on a card: stay there.
      {
        key: "Escape",
        canFire: () => notes(),
        handler: () => {
          drawer.close();
          if (document.activeElement?.closest(".notes-master .card")) return;
          if (paneCard() && pane) pane.leave();
          else focusMasterCard(notesCardId());
        },
      },
      {
        key: "Escape",
        handler: () => {
          drawer.close();
        },
      },
    ];

    const arrowDefs: ShortcutDef[] = (["ArrowLeft", "ArrowRight"] as const).map((key) => ({
      // Shift+Alt+Left/Right: reorder list from focused add-trigger.
      // Card.tsx handles the same shortcut for focused cards (with stopPropagation).
      key, shift: true, alt: true,
      handler: (e) => {
        const focused = document.activeElement as HTMLElement | null;
        const list = focused?.closest?.(".list") as HTMLElement | null;
        if (list) {
          e.preventDefault();
          moveListByKey(list.dataset.listId!, key === "ArrowLeft" ? "left" : "right");
        }
      },
    }));

    const navDefs: ShortcutDef[] = (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"] as const).map(
      (key) => ({ key, shift: false, alt: false, ctrl: false, meta: false, handler: navigateArrow }),
    );

    // ',' / 'j' (prev) and '.' / 'k' (next): cycle boards in Home order (wraps).
    const cycleDefs: ShortcutDef[] = ([",", "j", ".", "k"] as const).map((key) => ({
      key, ctrl: false, shift: false, alt: false, meta: false,
      handler: (e) => { e.preventDefault(); cycleBoard(key === "," || key === "j" ? -1 : 1); },
    }));

    const noMods = { ctrl: false, meta: false, alt: false } as const;
    const dispose = registerShortcuts(
      [
        ...escDefs,
        ...arrowDefs,
        { key: "?", ...noMods, handler: (e) => { e.preventDefault(); toggleHelp(); } },
        { key: "f", ...noMods, handler: (e) => { e.preventDefault(); setShowFilterBar((v) => !v); } },
        { key: "g", ...noMods, handler: (e) => { e.preventDefault(); drawer.toggle(); } },
        { key: "l", ...noMods, handler: (e) => { e.preventDefault(); triggerAddList(); } },
        { key: "n", ...noMods, handler: (e) => { e.preventDefault(); triggerAddCard(); } },
        {
          // Collapse / expand the list holding the focus (board view only).
          key: "c", ...noMods,
          canFire: () => !notes(),
          handler: (e) => {
            const list = document.activeElement?.closest<HTMLElement>(".lists-container .list");
            if (!list) return;
            e.preventDefault();
            handleToggleCollapse(list.dataset.listId!, !list.classList.contains("list--collapsed"));
          },
        },
        {
          key: "e", ...noMods,
          canFire: () => !!(document.activeElement?.classList.contains("card")),
          handler: (e) => {
            e.preventDefault();
            const el = document.activeElement as HTMLElement;
            const card = notes() && allLists().flatMap((l) => l.cards).find((c) => c.id === el.dataset.cardId);
            if (card) selectNotesCard(card, true);
            else el.click();
          },
        },
        {
          key: "r", ...noMods,
          handler: (e) => {
            const focused = document.activeElement as HTMLElement | null;
            const list = focused?.closest?.(".list") as HTMLElement | null;
            if (list) {
              e.preventDefault();
              setRenamingListId(list.dataset.listId ?? null);
            }
          },
        },
        {
          key: "a", ...noMods,
          handler: (e) => {
            e.preventDefault();
            if (showArchive()) setShowArchive(false);
            else openArchive();
          },
        },
        { key: "Backspace", ...noMods, handler: (e) => e.preventDefault() },
        { key: "b", ...noMods, handler: (e) => { e.preventDefault(); navigate("/"); } },
        { key: "v", ...noMods, handler: (e) => { e.preventDefault(); switchMode(notes() ? "kanban" : "notes"); } },
        ...cycleDefs,
        ...navDefs,
      ],
      // Confirm dialogs swallow ALL shortcuts as a global guard.
      { baseCanFire: (e) => !isTypingIn(e.target) && !isInUiOverlay(e.target) && !confirm.isOpen() },
    );

    const handleToggleShortcuts = () => toggleHelp();
    const handleCommitRename = () => commitRename();
    const handleDocClick = (e: MouseEvent) => {
      if (showColorPicker() && !(e.target as HTMLElement | null)?.closest(".board-color-area")) {
        setShowColorPicker(false);
      }
    };

    const handleFocusIn = () => {
      if (!isHorizontalNavigation()) resetPreferredRow();
    };

    document.addEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
    document.addEventListener("commit-board-rename", handleCommitRename as EventListener);
    document.addEventListener("click", handleDocClick);
    document.addEventListener("focusin", handleFocusIn);

    onCleanup(() => {
      header.setIsOnBoard(false);
      header.setTitle("");
      header.setRenaming(false);
      header.setControls(null);
      drawer.close();
      stopPoller();
      stopTracking();
      dispose();
      document.removeEventListener("toggle-shortcuts", handleToggleShortcuts as EventListener);
      document.removeEventListener("commit-board-rename", handleCommitRename as EventListener);
      document.removeEventListener("click", handleDocClick);
      document.removeEventListener("focusin", handleFocusIn);
      resetPreferredRow();
      document.documentElement.style.setProperty("--board-color", "#0079bf");
    });
  });

  const commitRename = async () => {
    if (!header.renaming()) return;
    const name = header.renameValue().trim();
    const b = board();
    header.setRenaming(false);
    if (name && b && name !== b.title) {
      try {
        await api.updateBoard(b.id, { title: name });
        refetch();
        refetchBoards();
      } catch (err) {
        reportActionError(err, "Could not rename board");
      }
    }
  };

  // --- Archive ---

  const handleArchiveCard = async (cardId: string) => {
    if (cardId === notesCardId() && !(await confirmLeavePane())) return;
    if (!await confirm.ask({ message: "Archive this card?", confirmLabel: "Archive" })) return;
    const el = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
    let neighborId: string | null = null;
    if (el) {
      let sibling = el.nextElementSibling as HTMLElement | null;
      while (sibling && !sibling.classList.contains("card")) sibling = sibling.nextElementSibling as HTMLElement | null;
      if (!sibling) {
        sibling = el.previousElementSibling as HTMLElement | null;
        while (sibling && !sibling.classList.contains("card")) sibling = sibling.previousElementSibling as HTMLElement | null;
      }
      neighborId = sibling?.dataset.cardId ?? null;
    }
    try {
      await api.archiveCard(cardId);
      if (neighborId) {
        focus.setLastFocused(neighborId);
        focus.preserve(neighborId);
      } else {
        focus.setLastFocused(null);
      }
      refetch();
    } catch (err) {
      reportActionError(err, "Could not archive card");
    }
  };

  const openArchive = async () => {
    setArchiveError(null);
    setArchiveLoading(true);
    setShowArchive(true);
    try {
      setArchivedCards(await api.getArchivedCards(params.id));
    } catch (err) {
      setArchiveError(errorMessage(err, "Could not load archived cards."));
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleRestoreCard = async (cardId: string) => {
    const card = archivedCards().find((c) => c.id === cardId);
    const lists = board()?.lists ?? [];
    // Only orphaned cards (original list gone) need a target list;
    // sending list_id for in-place cards would move them.
    const orphaned = !lists.some((l) => l.id === card?.list_id);
    if (orphaned && lists.length === 0) {
      const msg = "Cannot restore: this board has no lists. Create a list first.";
      setArchiveError(msg);
      reportActionError(new Error(msg));
      return;
    }
    try {
      setArchiveError(null);
      await api.restoreCard(cardId, orphaned ? lists[0].id : undefined);
    } catch (err) {
      const msg = `Restore failed: ${errorMessage(err)}`;
      setArchiveError(msg);
      reportActionError(err, "Restore failed");
      return;
    }
    setArchivedCards((prev) => prev.filter((c) => c.id !== cardId));
    refetch();
  };

  const handleDeleteArchivedCard = async (cardId: string) => {
    try {
      setArchiveError(null);
      await api.deleteCard(cardId);
      setArchivedCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch (err) {
      const msg = `Delete failed: ${errorMessage(err)}`;
      setArchiveError(msg);
      reportActionError(err, "Delete failed");
    }
  };

  // --- List / Card actions ---

  const handleAddList = async (title: string) => {
    try {
      const list = await api.createList(params.id, title);
      try { await refetch(); } catch { /* board error surfaces via resource */ }
      if (notes()) selectNotesList(list.id);
    } catch (err) {
      reportActionError(err, "Could not add list");
      throw err;
    }
  };

  /// `refocus` (Notes, Enter in the tab): the keyboard goes back to the selected
  /// card, and stays there across the refetch.
  const handleRenameList = async (listId: string, title: string, refocus = false) => {
    setRenamingListId(null);
    if (refocus) requestAnimationFrame(() => focusMasterCard(notesCardId()));
    const b = board();
    const list = b?.lists.find((l) => l.id === listId);
    const trimmed = title.trim();
    if (!list || !trimmed || trimmed === list.title) return;
    try {
      await api.updateList(listId, { title: trimmed });
      const cardId = notesCardId();
      if (refocus && cardId && document.activeElement?.closest(".notes-master")) focus.preserve(cardId);
      refetch();
    } catch (err) {
      reportActionError(err, "Could not rename list");
    }
  };

  const handleMoveList = async (listId: string, position: number) => {
    try {
      await api.updateList(listId, { position });
      refetch();
    } catch (err) {
      reportActionError(err, "Could not move list");
    }
  };

  // From the data, not the DOM: in Notes mode only one list is rendered.
  const moveListByKey = (listId: string, direction: "left" | "right") => {
    const lists = allLists();
    const idx = lists.findIndex((l) => l.id === listId);
    if (idx < 0) return;
    if (direction === "left" && idx <= 0) return;
    if (direction === "right" && idx >= lists.length - 1) return;
    const otherPositions = lists.filter((_, i) => i !== idx).map((l) => l.position);
    const insertAt = direction === "left" ? idx - 1 : idx + 1;
    handleMoveList(listId, listDropPosition(otherPositions, insertAt));
  };

  /// Quick-add (`#label`, `due:`): unknown labels are created first (the
  /// server reuses a same-named one, ADR-0014).
  const handleAddCard = async (listId: string, text: string) => {
    const q = parseQuickAdd(text, board()?.labels ?? []);
    try {
      const created = await Promise.all(q.newLabels.map((n) => api.createLabel(params.id, n)));
      const label_ids = [...new Set([...q.labels, ...created].map((l) => l.id))];
      const card = await api.createCard(listId, q.title || text, { label_ids, due_date: q.due });
      if (!notes()) {
        focus.preserve(card.id);
        refetch();
        return;
      }
      // Notes: straight on to the new card's description.
      try { await refetch(); } catch { /* board error surfaces via resource */ }
      selectNotesCard(card, true);
    } catch (err) {
      reportActionError(err, "Could not add card");
      throw err;
    }
  };

  /// Board view: a list as a narrow strip. Focus stays on the toggled list.
  const handleToggleCollapse = async (listId: string, collapsed: boolean) => {
    try {
      await api.updateList(listId, { collapsed });
      try { await refetch(); } catch { /* surfaces via resource */ }
      requestAnimationFrame(() => {
        const list = document.querySelector(`.lists-container .list[data-list-id="${listId}"]`);
        list?.querySelector<HTMLElement>(collapsed ? ".list-expand" : ".list-title")?.focus();
      });
    } catch (err) {
      reportActionError(err, "Could not update list");
    }
  };

  const handleDeleteList = async (listId: string) => {
    if (paneCard()?.list_id === listId && !(await confirmLeavePane())) return;
    const b = board();
    const list = b?.lists.find((l) => l.id === listId);
    if (list && list.cards.length > 0) {
      const ok = await confirm.ask({
        message: `Delete "${list.title}" and archive its ${list.cards.length} card${list.cards.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
      });
      if (!ok) return;
    }
    try {
      await api.deleteList(listId);
      refetch();
    } catch (err) {
      reportActionError(err, "Could not delete list");
    }
  };

  const handleDropCard = async (cardId: string, targetListId: string, position: number) => {
    try {
      await api.updateCard(cardId, { list_id: targetListId, position });
      refetch();
    } catch (err) {
      reportActionError(err, "Could not move card");
    }
  };

  const handleMoveCard = async (cardId: string, targetListId: string, position: number) => {
    focus.preserve(cardId);
    try {
      await api.updateCard(cardId, { list_id: targetListId, position });
      refetch();
    } catch (err) {
      reportActionError(err, "Could not move card");
    }
  };

  const handleCardClick = (card: CardType) => {
    focus.setLastFocused(card.id);
    setSelectedCard(card);
  };

  // Invariant for both close paths: the modal only unmounts after refetch()
  // resolves, so board() already reflects the modal's writes. Closing first
  // would let an immediate re-open snapshot a stale card (empty description,
  // missing checklist items) from the still-refetching resource.
  const handleCardSave = async (
    id: string,
    title: string,
    description: string,
    labelIds: string[],
    dueDate: string | null,
    checklist: ChecklistItem[]
  ) => {
    await api.updateCard(id, { title, description, label_ids: labelIds, due_date: dueDate, checklist });
    try { await refetch(); } catch { /* board error surfaces via resource */ }
    setSelectedCard(null);
    focus.preserve(id);
  };

  /// Notes pane: Save writes and stays (ADR-0022).
  const handlePaneSave = async (
    id: string,
    title: string,
    description: string,
    labelIds: string[],
    dueDate: string | null,
    checklist: ChecklistItem[]
  ) => {
    await api.updateCard(id, { title, description, label_ids: labelIds, due_date: dueDate, checklist });
    try { await refetch(); } catch { /* board error surfaces via resource */ }
  };

  /// Notes pane: bring back a card archived elsewhere, into the active list.
  const handlePaneRestore = async () => {
    const id = notesCardId();
    if (!id) return false;
    try {
      await api.restoreCard(id, activeListId() ?? undefined);
      return true;
    } catch (err) {
      reportActionError(err, "Restore failed");
      return false;
    }
  };

  const handleModalClose = async () => {
    const cardId = focus.lastFocused();
    // Attachment edits save immediately inside the modal; refetch so card
    // badges (and an immediate re-open) reflect them without waiting for the
    // next poll. (Checklist edits persist via Save, not on close.)
    try { await refetch(); } catch { /* board error surfaces via resource */ }
    setSelectedCard(null);
    if (cardId) focus.preserve(cardId);
  };

  // --- List drag ---

  const handleListDragOver = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("application/list-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const container = e.currentTarget as HTMLElement;
    const listElements = Array.from(
      container.querySelectorAll(".list:not(.list-dragging)")
    );

    let insertBefore: Element | null = null;
    for (const el of listElements) {
      const box = el.getBoundingClientRect();
      if (e.clientX < box.left + box.width / 2) {
        insertBefore = el;
        break;
      }
    }

    let placeholder = document.querySelector(".list-drop-placeholder");
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "list-drop-placeholder";
    }

    if (insertBefore) {
      container.insertBefore(placeholder, insertBefore);
    } else {
      const addWrapper = container.querySelector(".add-list-wrapper");
      if (addWrapper) {
        container.insertBefore(placeholder, addWrapper);
      } else {
        container.appendChild(placeholder);
      }
    }
  };

  const handleListDrop = async (e: DragEvent) => {
    const listId = e.dataTransfer?.getData("application/list-id");
    if (!listId) return;
    e.preventDefault();
    document.querySelectorAll(".list-drop-placeholder").forEach((el) => el.remove());

    const container = e.currentTarget as HTMLElement;
    const listElements = Array.from(
      container.querySelectorAll(".list:not(.list-dragging)")
    );

    const dropX = e.clientX;
    let insertIndex = listElements.length;
    for (let i = 0; i < listElements.length; i++) {
      const box = listElements[i].getBoundingClientRect();
      if (dropX < box.left + box.width / 2) {
        insertIndex = i;
        break;
      }
    }

    const positions = listElements.map(
      (el) => parseFloat((el as HTMLElement).dataset.listPosition || "0")
    );
    const position = listDropPosition(positions, insertIndex);

    try {
      await api.updateList(listId, { position });
      refetch();
    } catch (err) {
      reportActionError(err, "Could not move list");
    }
  };

  // --- Board color ---

  const handleSetBoardColor = async (color: string | null) => {
    const b = board();
    if (!b) return;
    try {
      await api.updateBoard(b.id, { color });
      refetch();
      refetchBoards();
      setShowColorPicker(false);
    } catch (err) {
      document.documentElement.style.setProperty("--board-color", b.color ?? "#0079bf");
      reportActionError(err, "Could not change board color");
    }
  };

  // --- Label management ---

  const handleCreateLabel = async (name: string) => {
    try {
      const label = await api.createLabel(params.id, name);
      refetch();
      return label;
    } catch (err) {
      reportActionError(err, "Could not create label");
      throw err;
    }
  };

  const handleDeleteLabel = async (labelId: string) => {
    try {
      await api.deleteLabel(labelId);
      refetch();
    } catch (err) {
      reportActionError(err, "Could not delete label");
    }
  };

  const handleReorderLabels = async (ids: string[]) => {
    try {
      await api.reorderLabels(params.id, ids);
      await refetch();
    } catch (err) {
      reportActionError(err, "Could not reorder labels");
      throw err;
    }
  };

  /// Renaming onto another label's name (case, spaces, dashes aside) merges
  /// the two, after asking: the server relabels every card (ADR-0014).
  const handleUpdateLabel = async (labelId: string, name: string) => {
    const labels = board()?.labels ?? [];
    const from = labels.find((l) => l.id === labelId);
    const into = findLabel(labels.filter((l) => l.id !== labelId), name);
    if (from && into) {
      const n = allLists().reduce((s, l) => s + l.cards.filter((c) => c.label_ids.includes(labelId)).length, 0);
      const strip = (s: string) => s.replace(/\*+/g, "");
      const cards = n === 1 ? "1 card" : `${n} cards`;
      const ok = await confirm.ask({
        message: `Merge “${strip(from.name)}” into “${strip(into.name)}”? “${strip(from.name)}” is deleted and its ${cards} (and archived ones) get “${strip(name)}” instead. This can't be undone.`,
        confirmLabel: "Merge labels",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      // The server merges only with the flag (409 for a clash we didn't see).
      await api.updateLabel(labelId, { name, merge: !!(from && into) });
      refetch();
    } catch (err) {
      reportActionError(err, "Rename failed");
    }
  };

  const handleChangeLabelColor = async (labelId: string, color: string) => {
    try {
      await api.updateLabel(labelId, { color });
      refetch();
    } catch (err) {
      reportActionError(err, "Color change failed");
    }
  };

  // --- Filter ---

  const toggleFilterLabel = (labelId: string) => {
    setFilterLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId]
    );
  };

  const clearFilters = () => {
    setFilterText("");
    setFilterLabelIds([]);
    setFilterDue(null);
  };

  const isFiltering = () => !!filterText() || filterLabelIds().length > 0 || !!filterDue();

  const filteredCards = (cards: CardType[]) => {
    if (!isFiltering()) return cards;
    return cards.filter((c) => filterCard(c, filterText(), filterLabelIds(), filterDue()));
  };
  const filteredLists = createMemo(() =>
    allLists().map((l) => (isFiltering() ? { ...l, cards: filteredCards(l.cards) } : l)),
  );

  return (
    <div
      ref={pageEl}
      class="board-page"
      tabindex="-1"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target === e.currentTarget || target.classList.contains("lists-container")) {
          const cardId = focus.lastFocused();
          if (cardId) {
            const card = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null;
            if (card) { card.focus(); return; }
          }
          (e.currentTarget as HTMLElement).focus();
        }
      }}
    >
      <NetworkBanner onRetry={retryBoard} suppressWhen={!!board.error} />
      <WarningBanner warnings={warnings()} />
      <Show
        when={!board.error}
        fallback={
          <Show
            when={isNotFoundError(board.error)}
            fallback={
              <div class="board-error" role="alert">
                <h2>{isNetworkError(board.error) ? "Cannot reach the server" : "Could not load board"}</h2>
                <p>
                  {isNetworkError(board.error)
                    ? "Could not load this board. Check your connection and that Synkban is running."
                    : errorMessage(board.error, "Could not load this board.")}
                </p>
                <div class="board-error-actions">
                  <button type="button" class="btn btn-primary board-error-retry" onClick={retryBoard}>
                    Retry
                  </button>
                  <A href="/" class="board-error-home">Back to boards</A>
                </div>
              </div>
            }
          >
            <div class="board-error">
              <h2>Board not found</h2>
              <p>This board may have been deleted, or the link is no longer valid.</p>
              <A href="/" class="board-error-home">Back to boards</A>
            </div>
          </Show>
        }
      >
      <Show when={board()} fallback={<div class="loading">Loading...</div>}>
        {(b) => (
          <>
            <Show when={showFilterBar()}>
              <FilterBar
                text={filterText()}
                labelIds={filterLabelIds()}
                due={filterDue()}
                onDueChange={setFilterDue}
                boardLabels={b().labels}
                onTextChange={setFilterText}
                onToggleLabel={toggleFilterLabel}
                onClear={clearFilters}
                onClose={() => setShowFilterBar(false)}
                autofocus={!restoring}
              />
            </Show>
            <Show
              when={!notes()}
              fallback={
                <NotesView
                  boardId={b().id}
                  lists={b().lists}
                  filtered={filteredLists()}
                  filtering={isFiltering()}
                  labels={b().labels}
                  activeListId={activeListId()}
                  selectedCardId={paneCard() ? notesCardId() : null}
                  dirtyCardId={dirtyCardId()}
                  renamingListId={renamingListId()}
                  onSelectList={(id) => selectNotesList(id)}
                  onCardClick={(card, byKey) => selectNotesCard(card, !!byKey)}
                  onCardFocus={handleNotesFocus}
                  onSideKey={handleSideKey}
                  onDropOnList={handleDropOnList}
                  onAddList={handleAddList}
                  onAddCard={handleAddCard}
                  onArchiveCard={handleArchiveCard}
                  onDeleteList={handleDeleteList}
                  onDropCard={handleDropCard}
                  onMoveCard={handleMoveCard}
                  onMoveList={handleMoveList}
                  onRequestRename={setRenamingListId}
                  onRenameList={handleRenameList}
                  onRenameCancel={() => {
                    setRenamingListId(null);
                    requestAnimationFrame(() => focusMasterCard(notesCardId()));
                  }}
                  detail={
                    <Show when={paneCard() ? notesCardId() : null} keyed>
                      {(id) => (
                        <CardDetail
                          onDirtyChange={trackDirty(id)}
                          boardId={b().id}
                          draft={takeDraft(id)}
                          variant="pane"
                          card={paneCard()!}
                          removed={removed()}
                          boardLabels={b().labels}
                          onCreateLabel={handleCreateLabel}
                          onSave={handlePaneSave}
                          onClose={() => focusMasterCard(notesCardId())}
                          onRestore={handlePaneRestore}
                          onAttachmentsChanged={() => refetch()}
                          onToggleHelp={() => toggleHelp()}
                          control={(c) => (pane = c)}
                        />
                      )}
                    </Show>
                  }
                />
              }
            >
            <div
              class="lists-container"
              onDragOver={handleListDragOver}
              onDrop={handleListDrop}
            >
              <For each={b().lists}>
                {(list) => {
                  const filtered = () =>
                    isFiltering() ? { ...list, cards: filteredCards(list.cards) } : list;
                  return (
                    <List
                      list={filtered()}
                      total={list.cards.length}
                      onToggleCollapse={handleToggleCollapse}
                      labels={b().labels}
                      renamingListId={renamingListId()}
                      onAddCard={handleAddCard}
                      onArchiveCard={handleArchiveCard}
                      onDeleteList={handleDeleteList}
                      onCardClick={handleCardClick}
                      onDropCard={handleDropCard}
                      onMoveCard={handleMoveCard}
                      onMoveList={handleMoveList}
                      onRequestRename={setRenamingListId}
                      onRenameList={handleRenameList}
                    />
                  );
                }}
              </For>
              <div class="add-list-wrapper">
                <AddForm
                  placeholder="List title..."
                  buttonText="Add list"
                  shortcut="L"
                  draftKey={`list:${params.id}`}
                  onAdd={handleAddList}
                />
              </div>
            </div>
            </Show>

            <LabelDrawer
              open={drawer.isOpen()}
              labels={b().labels}
              onClose={drawer.close}
              onCreate={handleCreateLabel}
              onRename={handleUpdateLabel}
              onChangeColor={handleChangeLabelColor}
              onDelete={handleDeleteLabel}
              onReorder={handleReorderLabels}
            />
          </>
        )}
      </Show>

      <Show when={selectedCard()}>
        {(card) => (
          <CardDetail
            card={card()}
            boardId={params.id}
            draft={takeDraft(card().id)}
            boardLabels={(board.error ? undefined : board()?.labels) ?? []}
            onCreateLabel={handleCreateLabel}
            onSave={handleCardSave}
            onClose={handleModalClose}
            onToggleHelp={() => toggleHelp()}
          />
        )}
      </Show>

      <confirm.Render />

      <Show when={showArchive()}>
        <ArchivePanel
          title="Archived Cards"
          items={archivedCards()}
          loading={archiveLoading()}
          error={archiveError()}
          onRetry={openArchive}
          emptyText="No archived cards."
          itemClass="archive-card-item"
          restoreClass="btn btn-primary btn-sm"
          renderItem={(card) => (
            <span class="archive-card-title" innerHTML={renderTitle(card.title)} />
          )}
          onClose={() => setShowArchive(false)}
          onRestore={handleRestoreCard}
          onDelete={handleDeleteArchivedCard}
        />
      </Show>

      <Show when={showHelp()}>
        <ShortcutHelp context={helpContext()} onClose={() => setShowHelp(false)} />
      </Show>
      </Show>

      <Show when={boardList().length > 1}>
        <nav class="board-dock" aria-label="Switch board">
          <For each={boardList()}>
            {(bd) => (
              <button
                class="board-dock-dot"
                classList={{ "board-dock-dot--active": bd.id === params.id }}
                style={{ "--dot-color": bd.color ?? "#0079bf" }}
                data-board-id={bd.id}
                title={tip(bd.title, ", / .")}
                aria-label={bd.title}
                aria-current={bd.id === params.id ? "true" : undefined}
                onClick={() => navigate(`/board/${bd.id}`)}
              />
            )}
          </For>
        </nav>
      </Show>
    </div>
  );
}
