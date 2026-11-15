# Description tables are deliberately simple; the first row is always the header

`prosemirror-tables` wired in `tables.ts`: cells hold paragraphs only (`paragraph+`, so Tab never means list-indent in a table), **no merging, no column resizing**.

## Why

Simple tables keep the format, the PDF layout (ADR-0012), the diff and the text extraction tractable.

## Rules

- **The first row is always the header** (`headerRowPlugin` re-types cells after every edit, so deleting or moving rows can't break it). Deleting the header promotes the next row; the header can't move, nothing can be inserted above it or moved into it. Header cells always render centred.
- **Alignment is per column**, stored as the cell attr `align` on every cell; the **header cell is the source of truth** — `alignColumn` writes only it and `headerRowPlugin` copies it down after every edit, so later added/moved rows stay consistent.
- Keys in a cell: `Tab`/`Shift+Tab` next/previous cell (content selected; Tab on the last cell appends a row), `Enter` same column next row (on the last row leaves the table, creating a paragraph if needed), `Shift+Enter` line break in the cell, arrows at a cell edge cross to the neighbour.
- Row/column moves wrap the library's `moveTableRow`/`moveTableColumn` to put the caret in the moved cell.
- Menu actions: ADR-0016. History diffs: ADR-0005. Cell text is searchable (backend extraction walks nodes generically).

## Caveat

An app version without table support shows a table description as raw JSON (`docFromDescription` treats a node-parse failure as plain text). **All clients sharing a data dir must be upgraded together.**

- **Width:** in the card modal tables span the full width (fixed layout). In the Notes pane (ADR-0022) they use auto layout: at least the 90ch text measure, growing with their content, wrapping at word boundaries; wider than the pane, the description scrolls sideways.
- Menu keys for moving rows/columns are `W`/`S`/`A`/`D` (arrows navigate the menu, ADR-0016).
