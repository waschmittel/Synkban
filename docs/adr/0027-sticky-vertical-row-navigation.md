# Sticky vertical row on horizontal list navigation

## Decision

Horizontal keyboard navigation (`←` / `→`) across Kanban lists remembers a sticky target row index (`listFocus.ts::preferredRow`), analogous to a text editor's goal column:

- Leaving a card horizontally when `preferredRow` is unset records that card's 0-based index in its list.
- Landing in an adjacent list focuses `cards[min(preferredRow, cards.length - 1)]`, or falls back to `.add-trigger` / `.list-expand` when the list has no cards — without overwriting `preferredRow`.
- Continuing `←` / `→` from a clamped shorter list, an empty list's `.add-trigger`, or a collapsed list's `.list-expand` restores `min(preferredRow, cards.length - 1)` when reaching a longer list.
- Entering a list horizontally when `preferredRow` is unset (e.g. starting directly from `.add-trigger` or `.list-expand`) keeps the entry fallback (`focusListEntry`: first card going right, last card going left).
- `preferredRow` resets to `null` on any vertical navigation (`↑`, `↓`, `Home`, `End`, `PageUp`, `PageDown`), on any non-horizontal `focusin` (clicks, `Tab`, modals, card moves), and on board unmount.

## Why

Without a sticky row, clamping to a shorter list immediately shrinks the current index, and passing through an empty or collapsed list drops it altogether — so scanning horizontally across lists of uneven height loses your vertical place.

## Considered and rejected

- **Remembering a row per list (`Map<listId, index>`)** — belongs to Notes mode (ADR-0022), where each list tab is an independent master-detail view; in Kanban mode, `←` / `→` scans across columns at the user's current visual row, like moving `↑` / `↓` across lines in an editor.
- **Updating `preferredRow` on every `focusin` on a card** — would defeat the sticky behavior, since clamping onto a shorter list focuses its last card. Guarding `focusin` with `isHorizontalNavigation()` preserves `preferredRow` during `←` / `→` hops while resetting it for every other focus change.
