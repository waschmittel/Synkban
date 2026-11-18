# Card content is edited locally and saved atomically

Title, description, labels, due date and checklist are **card content**: the card modal edits local signals and persists them only on Save (`PUT /api/cards/:id` with the changed fields, one atomic write of the card file). Closing with dirty state goes through the unsaved guard (Save / Discard / Cancel; Save focused; all four close paths — Esc, overlay, ✕, Cancel — use `guardedClose()`).

## Why

No half-saved cards, no mutation queues, no per-field endpoints. Attachments are the exception (ADR-0004) because they are separate files.

## Rules

- `UpdateCard` uses double-Option for nullable fields (`due_date`: null clears, absent keeps — just like `UpdateBoard.color`, which validates `#RRGGBB` or clears on `null`) and `Option<Vec>` for `checklist` (Some replaces the whole list).
- **Input validation (frontend + backend, 400 on violation):**
  - Board, list, card, and label titles/names must be non-empty after trimming. In `CardDetail`, the Save button stays enabled when the title is cleared so clicking Save (as well as `Accel+S` or Save in `UnsavedDialog`) surfaces the `"Card title cannot be empty."` banner and focuses the title input.
  - `description` must be `""` or a valid ProseMirror `doc` conforming to `frontend/src/schema.json` (ADR-0015).
  - `due_date` (and `?today=` on `GET /api/boards`) is calendar-validated (`YYYY-MM-DD`, checking real month lengths and leap years, matching `dueDate.ts::parseIso`).
  - `checklist` item IDs are minted client-side (`crypto.randomUUID()`); the backend validates that every item has a unique non-empty `id` and non-empty `text`.
- **The Notes pane (ADR-0022) saves without closing** and rebases its dirty baseline on every save; leaving a dirty card there goes through the same Save / Discard / Cancel dialog.
- **Save is `Accel+S`, never `Ctrl+Enter`** — ProseMirror turns that into a hard break and would corrupt the description just before saving.
- `Board.handleCardSave` and `handleModalClose` `await refetch()` **before** unmounting the modal, so an immediate re-open never snapshots a stale card.
- **PDF export renders the saved card** server-side (ADR-0012). A dirty card opens `ExportPdfDialog`: *Save & export* (default), *Export saved version*, or cancel. `onSave` therefore returns `void | Promise<void>`.
- **Checklist** (`ChecklistSection`): one flat list per card; rows via `<Index>` (a `<For>` re-create drops focus for a frame and loses keys typed after Space); delete asks inline (Yes focused); `Shift+↑↓` reorders; native drag reorders too; `done/total` pill and a Check all/Uncheck all button; `Accel+L` focuses the add input.
- **Due dates:** a chip opening `DuePicker`, wording and colours shared with the list badge (ADR-0023).
