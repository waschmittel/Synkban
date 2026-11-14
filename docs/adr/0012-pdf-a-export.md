# Cards export to PDF/A-2u with a bespoke layout engine

`GET /api/cards/:id/pdf` renders the *saved* card (`store::export_card`, never unsaved UI state) with `krilla` (pure Rust). `pdf.rs` lays blocks out top-down into per-page `Op` lists (text/rect/image/link), then replays them onto krilla pages — two passes, because the footer needs the page count.

## Why

Archivable output without a headless browser or system libraries. **Conformance is enforced, not hoped for:** krilla's `Archival::A2_U` validator makes export fail (500) rather than emit a non-conforming file.

## Content and rules

- Title (bold/italic), `Board: … · Status: <creation date> UTC`, label chips, due date, description (headings, paragraphs with marks/links, nested lists, quote, code block, tables), checklist (☑/☐), attachment list and image thumbnails.
- PDF/A constraints: all fonts embedded and subsetted; unknown characters become `?` (`.notdef` is forbidden); no image interpolation; no embedded files.
- **Fonts are in the binary** (`include_bytes!` from `backend/fonts/`, licences alongside; the `Dockerfile` copies the dir): DejaVu Sans ×4 + Mono, Noto Emoji (monochrome), Noto Sans Arabic/Hebrew/Devanagari/Thai. **No CJK** (10–18 MB per language) — it prints `?`. Variable Noto fonts are pinned to wght 400 for drawing and measuring.
- **Fallback per character:** script font → the style's face → `FALLBACKS` → `?`. ZWJ, variation selectors and skin-tone modifiers are dropped. Widths come from rustybuzz shaping. RTL runs draw right-to-left; a paragraph that starts RTL is right-aligned; mixed lines are not full bidi.
- **Pagination:** paragraphs, headings and code blocks stay whole if they fit a page; checklist/attachment headers stay with their list; tables are centred at natural width, kept on one page when they fit, otherwise split between rows with a repeated header (never stranded); a single over-tall row isn't split.
- UI: footer **Export PDF** button and `Accel+P`; `Content-Disposition` carries the title-derived filename.

## Tests (backend only)

Golden layouts in `tests/golden/*.txt` (`UPDATE_GOLDEN=1 cargo test --lib pdf` after an intended change; review the diff); content parsed back with `lopdf`; PDF/A structure checks (`assert_pdfa`); corner cases with `assert_in_bounds` (empty/RTL/control titles, 600-char words, malformed ProseMirror JSON, 40-level nesting, degenerate tables, every keep-together rule at every offset, 400-item checklists, 150 attachments, bad thumbnails, unsafe link schemes). Any schema or content change adds corner cases here.
