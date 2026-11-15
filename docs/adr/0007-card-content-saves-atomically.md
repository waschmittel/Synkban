# Card content is edited locally and saved atomically

Title, description, labels, due date and checklist are **card content**: the card modal edits local signals and persists them only on Save (`PUT /api/cards/:id` with the changed fields, one atomic write of the card file). Closing with dirty state goes through the unsaved guard (Save / Discard / Cancel; Save focused; all four close paths — Esc, overlay, ✕, Cancel — use `guardedClose()`).

## Why

No half-saved cards, no mutation queues, no per-field endpoints. Attachments are the exception (ADR-0004) because they are separate files.

## Rules

- `UpdateCard` uses double-Option for nullable fields (`due_date`: null clears, absent keeps) and `Option<Vec>` for `checklist` (Some replaces the whole list). Due dates are `YYYY-MM-DD`, validated server-side (400). Checklist item IDs are minted client-side (`crypto.randomUUID()`); the backend stores the array as-is.
- **The Notes pane (ADR-0022) saves without closing** and rebases its dirty baseline on every save; leaving a dirty card there goes through the same Save / Discard / Cancel dialog.
- **Save is `Accel+S`, never `Ctrl+Enter`** — ProseMirror turns that into a hard break and would corrupt the description just before saving.
- `Board.handleCardSave` and `handleModalClose` `await refetch()` **before** unmounting the modal, so an immediate re-open never snapshots a stale card.
- **PDF export renders the saved card** server-side (ADR-0012). A dirty card opens `ExportPdfDialog`: *Save & export* (default), *Export saved version*, or cancel. `onSave` therefore returns `void | Promise<void>`.
- **Checklist** (`ChecklistSection`): one flat list per card; rows via `<Index>` (a `<For>` re-create drops focus for a frame and loses keys typed after Space); delete asks inline (Yes focused); `Shift+↑↓` reorders; native drag reorders too; `done/total` pill and a Check all/Uncheck all button; `Accel+L` focuses the add input.
- **Due dates:** a chip opening `DuePicker`, wording and colours shared with the list badge (ADR-0023).
