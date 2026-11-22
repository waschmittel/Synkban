# Cards export to PDF/A-2u with a bespoke layout engine

`GET /api/cards/:id/pdf` renders the *saved* card (`store::export_card`, never unsaved UI state) with `krilla` (pure Rust). `pdf.rs` lays blocks out top-down into per-page `Op` lists (text/rect/image/link), then replays them onto krilla pages — two passes, because the footer needs the page count.

## Why

Archivable output without a headless browser or system libraries. **Conformance is enforced, not hoped for:** krilla's `Archival::A2_U` validator makes export fail (500) rather than emit a non-conforming file.

## Content and rules

- Title (bold/italic), `Board: … · Status: <creation date> UTC`, label chips, due date, description (headings, paragraphs with marks/highlights/links, nested lists, quote, alert blocks, code block, Lua blocks, tables, footnotes), checklist (☑/☐), attachment list and image thumbnails.
- PDF/A constraints: all fonts embedded and subsetted; unknown characters become `?` (`.notdef` is forbidden); no image interpolation; no embedded files.
- **Fonts are in the binary** (`include_bytes!` from `backend/fonts/`, licences alongside; the `Dockerfile` copies the dir): DejaVu Sans ×4 + Mono, Noto Emoji (monochrome), Noto Sans Arabic/Hebrew/Devanagari/Thai. **No CJK** (10–18 MB per language) — it prints `?`. Variable Noto fonts are pinned to wght 400 for drawing and measuring.
- **Fallback per character:** script font → the style's face → `FALLBACKS` → `?`. ZWJ, variation selectors and skin-tone modifiers are dropped. Widths come from rustybuzz shaping. RTL runs draw right-to-left; a paragraph that starts RTL is right-aligned; mixed lines are not full bidi.
- **Pagination:** paragraphs, headings and code blocks stay whole if they fit a page; checklist/attachment headers stay with their list; tables are centred at natural width, kept on one page when they fit, otherwise split between rows with a repeated header (never stranded); a single over-tall row isn't split.
- UI: footer **Export PDF** button and `Accel+P`; `Content-Disposition` carries the title-derived filename.

## Tests (backend only)

Golden layouts in `tests/golden/*.txt` (`UPDATE_GOLDEN=1 cargo test --lib pdf` after an intended change; review the diff); content parsed back with `lopdf`; PDF/A structure checks (`assert_pdfa`); corner cases with `assert_in_bounds` (empty/RTL/control titles, 600-char words, malformed ProseMirror JSON, 40-level nesting, degenerate tables, every keep-together rule at every offset, 400-item checklists, 150 attachments, bad thumbnails, unsafe link schemes). Any schema or content change adds corner cases here.

- Inline description images (ADR-0020) are embedded at their position, scaled to fit the line width in both directions; table cells print `[image: name]`.

- **Examples:** `docs/export-examples/` (index in its README) are rendered from the corner cases in `pdf/tests/examples.rs` and compared byte for byte; regenerate with `UPDATE_EXAMPLES=1 cargo test --lib examples`. New PDF-affecting features add a case there.

## Page breaks (same rules as the terminal app's export, `tct`)

- **Sections:** a heading's section (up to the next heading of the same or a higher level) moves to a fresh page when it would be split but fits one page; longer sections flow, and their sub-sections get the same rule one level down. The "Description" title is kept with the first heading's section, or with the first block only when the description starts with other content (so a big first block, e.g. an image, can't drag the title to the next page).
- **Blocks:** paragraphs, lists, quotes, code blocks and tables up to **half a page** (`KEEP_MAX`) are kept whole; bigger ones split. Paragraphs with inline images follow the same rule (images are at most `KEEP_MAX` high, ADR-0020).
- **No orphans/widows:** when splitting, no single line (paragraph, code) or row (table) is left alone at a page's top or bottom; a table header keeps two rows company and is repeated on each page.
- **Checklist** (title and items) moves as a unit when it fits a page.
- **Footnotes (ADR-0030):** printed at the bottom of every page that references them (short muted rule, raised black `[k]` markers, per-page numbering restart, `NOTE_BUDGET` half-page cap with `carry` spill onto subsequent pages); unreferenced orphans are omitted.
- **Highlights & alerts (ADR-0031):** `highlight` marks paint print-friendly pastel rects behind runs (including in footnotes); `alert` blocks paint a tinted box, 3pt colored left bar, vector icon + bold colored header, and a darker pill background for inline code inside alerts.
- Implemented by `Layout::keep_together_up_to`: build, and if the output was split but fits a fresh page, roll back and rebuild on a new page. Tests sweep the offset on the page (`tests.rs`, "page-break rules"); examples 14, 15 and 19.
