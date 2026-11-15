# Switching boards remembers where you were

Per board, `boardView.ts` keeps the last focused card, the filter (bar open, text, labels), the horizontal scroll of `.lists-container` and the vertical scroll of every list, in `sessionStorage` (per tab; survives reloads, gone when the tab closes).

## Why

Cycling boards (dock, `,` / `.`) otherwise dropped you at the top-left with nothing focused on every return.

## Rules

- **`sessionStorage`**, key `synkban.boardViews`: orientation, not data, so it doesn't outlive the tab and isn't shared between tabs. Writes are debounced (scroll is frequent) and flushed on `pagehide`/hidden. Stored JSON is validated on load; corrupt, foreign or blocked storage degrades to empty/in-memory.
- **Tracked continuously** (`focusin` + capture-phase `scroll` on `.board-page`), not on leave: the dock button, not the card, holds focus when the switch happens. Events are attributed to the board whose DOM is *rendered* (`board()?.id`), since the resource keeps the old board on screen until the new one loads.
- **Restored once per visit**, when the resource has resolved for `params.id`; polling refetches don't re-restore (ADR-0010 covers those). Focus uses `preventScroll`; offsets are applied synchronously and again in a `requestAnimationFrame`.
- Deleted cards/lists are skipped; restore never steals focus from a text field.
- **Filter is per board** (it used to leak from one board to the next). Remembered label ids that no longer exist are dropped; the restored bar doesn't autofocus, so the active card keeps focus.
- **Resilient:** views of deleted/archived boards are forgotten (`forgetBoardViews`), stale cards/lists/labels are ignored, and an unvisited board starts clean.
- Not remembered: open dialogs/drawers.
- **Considered and rejected:** in-memory only (lost on reload); `localStorage` (shared across tabs, lives forever, and per-origin so lost per Electron launch); server settings (ADR-0002; would rewrite the file on every scroll).
- Covered by `boardView.test.ts`, `e2e/board.spec.ts` (incl. narrow viewport).
