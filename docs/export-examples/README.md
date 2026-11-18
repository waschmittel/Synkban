# PDF export examples

Generated from the corner cases in `backend/src/pdf/tests/examples.rs`
(`corner_cases()`) by `UPDATE_EXAMPLES=1 cargo test --lib examples`. Regenerate
and look at them after changing the layout. `example_pdfs_are_up_to_date`
compares them byte for byte (fixed export time, so they only change with
content) and fails when they are stale. Each case is also checked for PDF/A
validity, margins/page bounds, no empty pages and determinism.

| File | What it shows |
|------|---------------|
| `00-showcase` | A nice-looking everyday card rather than a corner case: labels, due date, formatting, link, inline images, lists, quote, table, checklist, code |
| `01-empty-card` | No title, description, checklist, labels or attachments |
| `02-very-long-title` | Title wrapping over many lines |
| `03-unicode-and-missing-glyphs` | Umlauts, symbols, emoji, CJK/Arabic, glyphs the fonts lack, tabs, control characters |
| `04-unbreakable-words` | Words wider than the page in text, list, quote and inline code |
| `05-wide-table` | Ten columns: padding and type shrink before words are broken |
| `06-long-table-repeats-header` | 150 rows over several pages with the header repeated |
| `07-heading-hierarchy` | Level 1–3 headings |
| `08-lists-and-quotes` | Nested lists, numbering, nested quotes |
| `09-code-blocks` | Over-long code lines, a block taller than a page, tabs and indentation |
| `10-checklist-page-break` | Checklist after a long description |
| `11-many-labels` | Label chips wrapping over rows |
| `12-inline-images` | Inline images (ADR-0020): wide/tall/small, in lists and quotes, several in a row, a dangling reference (`[image: …]`) and one inside a table cell (placeholder) |
| `13-inline-images-page-break` | Images that don't fit move to the next page |
| `13b-description-of-only-big-images` | Two big images and nothing else: the title stays with the first image, the second moves on |
| `14-section-page-breaks` | Sections kept whole on a page where they fit; a part longer than a page flows but its subsection is kept |
| `15-orphans-and-widows` | A long paragraph, code block and table split with no single line/row left alone at a page edge |
| `16-attachments` | Attachment list (long names, sizes) and thumbnails |
| `17-matrix` | Matrix with open top-left corner, centred top/left headers, per-cell alignment, and page break |
