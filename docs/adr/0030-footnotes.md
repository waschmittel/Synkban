# Numbered footnotes live at the bottom of the description and restart per page in PDFs

Descriptions support numbered footnotes (`footnote_ref`, `footnote_list`, `footnote_def`, `footnote_paragraph` in `schema.json`, implemented in `frontend/src/footnotes.ts` and `backend/src/pdf.rs`).

## Document structure

- `doc` is `block+ footnote_list?`. Because `footnote_list` is not in `group: "block"`, footnote definitions are structurally pinned to the bottom of the description and can never appear between body blocks or inside lists/tables/quotes.
- `footnote_def` holds `footnote_paragraph+`, which permits `(text | hard_break)*` and all inline marks (`strong`, `em`, `code`, `link`) while disallowing nested `footnote_ref` and inline `image` at the schema level.
- References (`footnote_ref`) link to definitions (`footnote_def`) by opaque `id`. Footnotes are numbered-only (`[1]`, `[2]`, …), derived dynamically in order of **first reference** in the body. An `appendTransaction` normalizer keeps `footnote_list` ordered in that same first-reference order.
- **Orphaned definitions:** deleting the last reference to an empty definition removes it automatically (and removes an empty `footnote_list`); deleting the last reference to a non-empty definition keeps it dimmed at the bottom as `[—]` so prose is not lost by accident. Orphaned definitions are omitted from exported PDFs and can be removed via their `×` button.

## Toolbar & keyboard navigation

- **Insert menu:** the description toolbar groups **Footnote**, **Image**, **Table**, **Matrix**, **Bullet list**, **Ordered list**, and **Blockquote** into a single **Insert** dropdown (`InsertDropdown`), each item rendered with icon + text. Footnotes have no standalone top-bar button and no direct insert chord (ADR-0008).
- **Editor menu (`Accel+K` / right-click):** `F` adapts to context — *Insert footnote* in prose/tables, *Jump to footnote* on/adjacent to a reference, *Jump back to reference* inside a definition. Inside a `footnote_def`, `D` (*Delete footnote*, danger-tinted) deletes the definition and all references pointing to it in one undo step.
- **Jump & return (`Accel+Enter`):** on or adjacent to a `footnote_ref` (or `Enter` when the ref is selected) jumps to its `footnote_def` and records the exact reference position on a mapped return target; `Accel+Enter` (or clicking/activating the marker or `↩` button via keyboard) inside a `footnote_def` jumps right back behind that reference (falling back to the first reference if entered manually).

## PDF rendering (aligned with `tct`)

- **Same-page invariant:** every page that holds a reference prints that note at the bottom above the footer below a short muted rule (`CONTENT_W / 4.0`, `0.6pt`), with a raised black `[k]` marker (no dot) and wrapped note text aligned behind that page's longest marker.
- **Per-page numbering restart:** numbering restarts at `[1]` on every PDF page in order of first reference on that page; a note referenced on two pages prints on both pages with each page's local number.
- **Budget & spill:** the footnote area is capped at `NOTE_BUDGET` (half the content height). Notes exceeding the budget split onto the top of the next page's footnote area (`carry`, marker not repeated), cascading onto overflow pages if needed. `Layout::Mark` / `rollback` snapshot `page_notes` and `carry` so `keep_together_up_to` accounts for footnote height automatically.

## Considered and rejected

- **Named footnotes (`[^label]`):** numbered-only keeps the UI minimal without a label-editing dialog and avoids numbering/name collisions.
- **Direct insert chord (`Accel+N` / `Accel+Shift+F`):** `Accel+N` is browser-reserved (ADR-0008); `Insert → Footnote` and `Accel+K` → `F` are discoverable without claiming another global chord.
