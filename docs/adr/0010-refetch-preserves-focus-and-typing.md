# A refetch must not cost the user their focus or their typing

Home and Board poll `GET /api/changes` every 15s (`changePoller.ts` owns interval, last-mtime memory and error swallowing; Board watches its own board's mtime, Home skips ticks during a reorder). A changed mtime triggers a full refetch, which hands `<For>` a new payload and recreates every node.

## Why

Recreated DOM drops keyboard focus onto `<body>` (the next shortcut goes nowhere) and tears down forms mid-word. The poller's first tick always fires, so every page left open for one interval hit this.

## Rules

- **Capture the focused card/board before refetching** and restore it via `pendingFocusCardId` (`focusRestoration.ts`; Home has the same shape). After add, the new card is focused; after archive, the next sibling (or previous); after a move, the moved card.
- The restore effect **untracks** the pending id (tracking it makes setting it run the effect before the refetch it must survive) and focuses **synchronously first, then again in a `requestAnimationFrame`** — deferring all of it leaves one frame on `<body>`, enough to swallow a fast second `Shift+Arrow` (flaky keyboard-move specs).
- **`preserve` yields to typing:** it bails when an editable element is focused, so a slow create round-trip can't yank the caret out of a form the user reopened.
- **`AddForm` keeps all three pieces of state in module scope** keyed by `draftKey`: draft text, open/closed, and which form owns the caret (`focusedKey`; cleared only when blur lands on a *live* element, because removing a focused input doesn't reliably blur). On re-mount it re-focuses only if nothing else claimed focus by the next frame. The add-list form needs a key too (`list:${boardId}`). Only one form is open at a time (`open()` closes the others, drafts kept); blur alone doesn't close (clicking Add blurs the input), so `n`/`l` re-focus an open form instead of clicking a trigger that no longer exists.
- **Errored resources throw when read.** An uncaught throw in a `createEffect` aborts the effect-queue run, silently skipping later effects. Check `resource.error` first or try/catch (`focusRestoration.ts`, `Home.tsx`).
- `.board-page` has `tabindex="-1"` as a focus fallback; Escape unfocuses a card to it, not to `<body>`.
- Covered by `changePoller.test.ts`, `e2e/addform.spec.ts`, `e2e/focus.spec.ts`.
