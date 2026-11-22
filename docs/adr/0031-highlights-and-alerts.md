# Semantic text highlights and dedicated alert blocks

Card descriptions support colored text highlights (`highlight` mark, `frontend/src/highlights.ts`) and dedicated semantic alert callout blocks (`alert` node, `frontend/src/alerts.ts`, inspired by `tct`), both validated by `schema.json` / `backend/src/schema.rs` and rendered in PDF/A exports (`backend/src/pdf.rs`).

## Text highlights

- **Limited semantic palette (8 colors):** `yellow`, `orange`, `red`, `pink`, `purple`, `blue`, `green`, `gray` (`allowedHighlightColors` in `schema.json`).
- **Why semantic names instead of raw hex:** Synkban's editor uses a `#fffbe6` sticky-note background in light mode, `#2a2a20` in dark mode, and white `#ffffff` in exported PDFs. Storing named tokens lets each surface choose high-contrast fills (for example, `#ffe066` in light mode so yellow stands out clearly on `#fffbe6`, translucent fills in dark mode, and print-friendly pastels in PDF).
- **Mark rules:** `highlight` carries a required `color` attribute (`highlight_color`). By default it excludes itself (applying a new color replaces the previous one rather than stacking) and coexists with `strong`, `em`, `code`, and `link`. Forbidden inside `code_block` / `lua_block` (`marks: ""`).
- **Zero layout shift:** `mark[data-highlight]` carries zero padding, margin, and border so highlighting—including partial-word highlights—never changes text position, glyph spacing, or line wrapping. In PDFs, highlight rects likewise match exact glyph advance bounds with no horizontal bleed onto neighbouring characters.
- **UI & shortcuts:**
  - **Toolbar split button:** the left half highlights the selection in the **last used color** (default `yellow`, shown in the bar beneath the icon), or removes the highlight when highlighted text is selected or the caret sits inside a highlighted run. The right chevron opens a **compact visual swatch popover** (3×3 grid of 8 pure color swatches + clear icon, no color names and no keyboard shortcut hints).
  - **`Accel+K` / right-click menu:** **`H`** (*Highlight* / *Remove highlight*) runs the same default toggle as the split button's left half; **`G`** (*Highlight color…*) opens the keyboard-driven `.highlight-menu` with color names and single-key hints (`1`–`8` pick a color, `0` clears, `↑`/`↓` + `Enter`, `Esc` closes). Both are available outside and inside table cells. No markdown input rules (`==text==` stays literal).

## Alert blocks

- **Dedicated `alert` node (not a `blockquote` attribute):** `type: "alert"`, `content: "block+"`, `group: "block"`, `attrs: { kind: "note" | "tip" | "important" | "warning" | "caution" }` (default `"note"`). Descriptions are structured rich text, not Markdown, so a dedicated semantic node keeps alerts cleanly separated from quotes.
- **Kinds, icons & colors:** five kinds inspired by `tct` / GitHub alerts — **Note** (blue), **Tip** (green), **Important** (purple), **Warning** (amber), **Caution** (red) — rendered with 16×16 Primer Octicons, a 3.5px left accent bar, and a subtle tinted background.
- **NodeView & editing:** `createAlertView` renders a non-editable header bar (clickable icon + label badge to change kind or remove the alert) above the editable `.editor-alert-body`. `"alert"` is in `GAP_CURSOR_BLOCKS` and `ESCAPABLE_BLOCKS`, so `Shift+P` / `P` and gap-cursor clicks work out of the box. In Notes mode, alerts inherit ADR-0022's default centred `--text-measure` alignment (matching prose in width and horizontal position).
- **UI & shortcuts:** **Insert → Alert** in the toolbar and `Accel+K` / right-click → **`A`** (*Insert alert…* / *Change alert…*, omitted inside table cells) open `.alert-menu` (`N` Note, `T` Tip, `I` Important, `W` Warning, `C` Caution, and `X` Remove alert when inside one). No markdown input rules (`> [!note]` stays literal).

## PDF/A & history diff

- **Highlights in PDF:** emit background `Op::Rect` fills behind highlighted runs (bridging spaces across adjacent runs of the same color), including in footnotes.
- **Alerts in PDF:** render a soft 7% tinted background, 3pt left accent bar, crisp vector `Op::AlertIcon` + bold colored header, and body blocks. Inline `code` inside alerts gets a darker cool-gray pill background (`ALERT_CODE_BG`) so it remains clearly distinguishable against the alert tint.
- **History diff (`diff.ts`):** `alert` blocks emit `> [!KIND]` followed by `> `-prefixed body lines so kind changes diff cleanly.

## Considered and rejected

- **Raw `#RRGGBB` colors on `highlight`:** breaks legibility across `#fffbe6`, `#2a2a20`, and white PDF paper and weakens schema validation.
- **Extending `blockquote` with an `alert` attribute:** conflates quotations with semantic callouts in a non-Markdown ProseMirror model.
- **Markdown input rules (`> [!note]`, `==text==`):** avoided to keep rich-text editing predictable and anchored on the `Accel+K` editor menu and toolbar.
