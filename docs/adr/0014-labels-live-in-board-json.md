# Labels are per-board, live in `board.json`, and order is display order

`Board.labels: Vec<Label {id, name, color}>` is stored in `board.json` via the `pub(crate) BoardFile`; the public `Board` response omits it (only `BoardDetail` carries labels). Cards reference labels by ID (`label_ids`). Colours are auto-assigned from a 12-colour pastel palette in interleaved order for maximum distinction.

## Rules

- **Array order is the display order everywhere** (card chips, CardDetail row, FilterBar iterate `board.labels`, never `card.label_ids`); `store::reorder_labels` reorders it (`PUT /api/boards/:bid/labels/order`; unlisted ids keep relative order at the end, unknown ids ignored).
- **Dead IDs self-heal:** `delete_label` doesn't rewrite cards; the UI filters chips to existing labels and `cards::prune_label_ids` drops dangling IDs on every `update_card`.
- Names support `**bold**`/`*italic*` (`renderTitle`, `mdInput.ts` for Ctrl+B/I in plain inputs).
- **Drawer:** right-side slide-out (`LabelDrawer`, always rendered, `--open` toggles `translateX(0)`); rows reorder by drag, or `Shift+↑↓` with a row focused; focus restored after refetch.
- **Card modal picker** (`CardLabelSection`): one toggle row, every label exactly once (`aria-pressed`; selected = coloured border + ✓). Assigned first, then unassigned up to `max(12, assigned + 2)` chips, rest behind "+N more". Order is **frozen while pointer or focus is in the row** so a toggled chip doesn't move under the cursor. A dashed "New label" chip becomes an inline form (focused synchronously — a rAF would lose the race with the form's `focusout` collapse); the new label is auto-assigned.
- **Filtering:** `cardMatchesFilter` = (no text OR title/description_text/checklist matches) AND (every selected label on the card). `.filter-bar` is part of `isInInput`.
