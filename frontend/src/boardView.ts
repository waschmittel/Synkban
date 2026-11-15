// Per-board view state (active card, filter, horizontal board scroll, per-list scroll),
// kept per tab in sessionStorage so switching boards (and reloading) isn't
// disorienting (ADR-0021). Not shared across tabs, gone when the tab closes.

import { isTypingIn } from "./boardInput";

export interface BoardFilter {
  open: boolean;
  text: string;
  labelIds: string[];
}

interface BoardView {
  card: string | null;
  filter: BoardFilter | null;
  x: number;
  lists: Record<string, number>;
}

const KEY = "synkban.boardViews";

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
const strs = (a: unknown): string[] =>
  Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];

/// Reads stored views, ignoring anything malformed (corrupt JSON, other
/// versions, hand edits) and a missing/blocked storage.
function load(): Map<string, BoardView> {
  const out = new Map<string, BoardView>();
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [id, r] of Object.entries<Record<string, unknown>>(raw)) {
      if (!r || typeof r !== "object") continue;
      const f = r.filter as Record<string, unknown> | null | undefined;
      const lists: Record<string, number> = {};
      if (r.lists && typeof r.lists === "object")
        for (const [l, y] of Object.entries(r.lists)) lists[l] = num(y);
      out.set(id, {
        card: typeof r.card === "string" ? r.card : null,
        filter:
          f && typeof f === "object"
            ? { open: f.open === true, text: typeof f.text === "string" ? f.text : "", labelIds: strs(f.labelIds) }
            : null,
        x: num(r.x),
        lists,
      });
    }
  } catch {
    /* unusable storage: start empty */
  }
  return out;
}

let views = load();

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(views)));
  } catch {
    /* quota/blocked: stay in-memory only */
  }
}

// Scroll events are frequent: coalesce writes, and flush when the page goes away.
let timer: ReturnType<typeof setTimeout> | undefined;
const persist = () => {
  timer ??= setTimeout(flushBoardViews, 250);
};
export function flushBoardViews() {
  clearTimeout(timer);
  timer = undefined;
  save();
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushBoardViews);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushBoardViews();
  });
}

const view = (boardId: string): BoardView => {
  let v = views.get(boardId);
  if (!v) views.set(boardId, (v = { card: null, filter: null, x: 0, lists: {} }));
  return v;
};

/// Test hooks: clear everything / re-read storage (simulates a page reload).
export function resetBoardViews() {
  views.clear();
  flushBoardViews();
}
export function reloadBoardViews() {
  clearTimeout(timer);
  timer = undefined;
  views = load();
}

/// Drop views of boards that no longer exist (deleted/archived), so the map
/// stays bounded and a recycled id can't inherit a stale view.
export function forgetBoardViews(keep: Iterable<string>): void {
  const live = new Set(keep);
  for (const id of views.keys()) if (!live.has(id)) views.delete(id);
  persist();
}

export function recordBoardFilter(boardId: string, f: BoardFilter): void {
  view(boardId).filter = { ...f, labelIds: [...f.labelIds] };
  persist();
}

/// Remembered filter of a board, with label ids not in `knownLabelIds`
/// (deleted since) dropped. Null when the board was never visited.
export function rememberedFilter(boardId: string, knownLabelIds: string[]): BoardFilter | null {
  const f = views.get(boardId)?.filter;
  if (!f) return null;
  const known = new Set(knownLabelIds);
  return { ...f, labelIds: f.labelIds.filter((id) => known.has(id)) };
}

/// Record the focused card and scroll offsets of the board shown under `root`.
/// `boardId()` must name the board whose DOM is currently rendered.
export function trackBoardView(root: HTMLElement, boardId: () => string | undefined): () => void {
  const onFocusIn = (e: FocusEvent) => {
    const id = boardId();
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(".card[data-card-id]");
    if (id && card) {
      view(id).card = card.dataset.cardId ?? null;
      persist();
    }
  };
  // `scroll` doesn't bubble, so listen in the capture phase.
  const onScroll = (e: Event) => {
    const id = boardId();
    const el = e.target;
    if (!id || !(el instanceof HTMLElement)) return;
    if (el.classList.contains("lists-container")) {
      view(id).x = el.scrollLeft;
      persist();
    }
    else if (el.classList.contains("cards-container")) {
      const listId = el.closest<HTMLElement>(".list")?.dataset.listId;
      if (listId) {
        view(id).lists[listId] = el.scrollTop;
        persist();
      }
    }
  };
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("scroll", onScroll, true);
  return () => {
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("scroll", onScroll, true);
  };
}

/// Re-apply only the remembered scroll offsets. Refetches recreate the list
/// nodes (fresh ones start at scrollTop 0), so this also runs after those.
export function restoreBoardScroll(root: ParentNode, boardId: string): void {
  const v = views.get(boardId);
  if (!v) return;
  const apply = () => {
    const lists = new Map(
      [...root.querySelectorAll<HTMLElement>(".list")].map((l) => [l.dataset.listId, l]),
    );
    for (const [listId, y] of Object.entries(v.lists)) {
      const cards = lists.get(listId)?.querySelector<HTMLElement>(".cards-container");
      if (cards && cards.scrollTop !== y) cards.scrollTop = y;
    }
    const container = root.querySelector<HTMLElement>(".lists-container");
    if (container && container.scrollLeft !== v.x) container.scrollLeft = v.x;
  };
  apply();
  // Layout (fonts, thumbnails) may settle a frame later.
  requestAnimationFrame(apply);
}

/// Re-apply the remembered view of `boardId` to the rendered board under `root`.
/// Unknown cards/lists (deleted meanwhile) are skipped. Focus never scrolls;
/// the remembered offsets win.
export function restoreBoardView(root: ParentNode, boardId: string): void {
  const v = views.get(boardId);
  if (!v) return;
  const card = v.card
    ? [...root.querySelectorAll<HTMLElement>(".card[data-card-id]")].find(
        (c) => c.dataset.cardId === v.card,
      )
    : undefined;
  if (!isTypingIn(document.activeElement)) card?.focus({ preventScroll: true });
  restoreBoardScroll(root, boardId);
}
