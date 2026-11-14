# Boards and cards are archived before they can be deleted

`archived: bool` (+ `archived_at`) is a soft delete for boards and cards. `DELETE` on a non-archived board or card returns 400; permanent deletion only happens from the archive panels.

## Why

Deleting is irreversible on a file store that syncs; archiving first makes accidents recoverable.

## Behaviour

- **Cards:** archive via the card button or `Delete`/`Backspace` (confirmation). `get_board` hides them; `GET /api/boards/:id/archive` lists them (sorted by `archived_at` desc, legacy by `created_at`). Restore is `PUT /api/cards/:id { archived: false, list_id? }` — orphaned cards (from deleted lists, stored in `archived_cards/` with `CardLocation::Orphaned`) require `list_id`. Permanent delete also removes attachment files.
- **Lists:** deleting a list archives its cards to `archived_cards/` then removes the list dir; a non-empty list asks for confirmation.
- **Boards:** `list_boards` omits archived ones; `GET /api/boards/archive`; the Home X archives (confirmation); the panel offers Restore and permanent Delete. Archived boards are skipped by `PUT /api/boards/order`.
- Both archive UIs are adapters of one `ArchivePanel` (overlay, loading/empty, first-item focus, `↑↓` roving, inline "Delete permanently?" with Yes focused, Escape, focusTrap); adapters only supply `renderItem`, `itemClass` and handlers.
