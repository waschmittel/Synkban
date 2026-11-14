# Card history stores content snapshots, served on demand

`Card.history` keeps the last 100 versions of the card's **content** (title, description, label_ids, due_date, checklist, attachment filenames), oldest first, inside the card JSON. Each entry is `{ at, ..CardContent }` — the full content as of when it became current. `store/cards.rs::record_history` appends only when content actually differs, so moves, archiving and no-op saves add nothing. A card with no history first records its pre-edit state (stamped `created_at`); older entries beyond `HISTORY_LIMIT` drop.

## Why

Full snapshots make diffing and display trivial and robust to schema drift; the cost is size, hence the cap.

## Rules

- History is **stripped from every API response** (it would bloat board payloads ×100) and served by `GET /api/cards/:id/history` → `{ current, entries }` (newest first). Walker results are never written back, which is what makes dropping it there safe — **code that rewrites a card must use `read_card`**, which keeps history.
- The History dialog (`HistoryDialog.tsx`, `Accel+J`) shows a per-field diff from the previous version to the selected one (`diff.ts`: LCS on text lines, sets for labels/attachments); the oldest version shows everything as added. Read-only, no restore.
- Tables diff as one markdown-style line per row; alignment shows in the separator.
