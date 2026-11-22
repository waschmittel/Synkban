# Readable board & label colours, board-matched highlights, and manual label colours

Users can pick any `#RRGGBB` hex colour for a board or a label. Synkban preserves the user's chosen colour on the board canvas and Home tiles, keeps `.app-header` text and icons always white (gently capping only excessive header lightness for very bright board colours while preserving full chroma), backs floating board controls with real translucent surfaces, and computes WCAG-checked ink for Home tiles and label chips (in both UI and PDF/A exports).

## Why

Previously, `.app-header` and Home `.board-card` painted raw `--board-color` / `board.color` behind hardcoded white text, and `.add-list-wrapper` / `.loading` placed translucent white text directly on `.board-page` (`color-mix(--board-color 50%, white)`). Any light board colour made "Add list" (especially in Notes mode, right beside dark-text tabs), the header, and Home tiles unreadable. Flipping `.app-header` text/icons to black looked out of place with the dark-tinted top bar and Electron's white `titleBarOverlay` symbols; instead, capping only the header's upper OKLCH lightness (`min(l, 0.54)` light / `min(l, 0.62)` dark, full chroma `c`) leaves dark and medium colours untouched while keeping white header text/icons ≥ 4.5:1 even on `#ffffff`. Meanwhile, card focus/selection highlights and `::selection` were hardcoded blue (`#f0f6fd`, `#cce5ff`) and `--color-accent` desaturated vivid hues; deriving highlights directly from `--board-color` keeps them faithful to the board's colour.

## Rules

- **Header always uses white ink:** `.app-header` never switches to black/dark text or icons. Its base colour is `oklch(from var(--board-color) min(l, 0.54) c h)` (light) / `min(l, 0.62) c h` (dark) under its subtle vertical dark gradient — zero chroma clamping and no lower bound, so darker/medium colours are unchanged while very light colours deepen just enough for ≥ 4.5:1 white text and Electron `titleBarOverlay` symbols.
- **Board canvas stays unclamped:** `.board-page` uses `color-mix(in srgb, var(--board-color) 50%, white)` (light) and `color-mix(in srgb, var(--board-color) 42%, #0d0f14)` (dark).
- **No white-on-transparent controls on `.board-page`:** `.add-list-wrapper` (both Kanban and Notes) uses a real translucent surface matching `.list`/`.notes-tab` with `--color-text`; `.board-page .loading` uses `--color-text`.
- **Home tile adaptive ink (`.board-card--light`):** `Home.tsx` paints `board.color` directly and applies `.board-card--light` when `colorContrast.ts::isLightColor(board.color)` is true, switching title, metadata, and archive button to dark ink (`#0f172a`).
- **Board-matched highlights:** `--color-accent` preserves full chroma `c` (`clamp(0.30, l, 0.65)` light, `clamp(0.55, l, 0.85)` dark); `--color-primary` keeps full chroma (`0.38–0.52` light, `0.42–0.54` dark) for white button text; `.card:focus`, `.card.card--selected:not(:focus)`, and `::selection` mix directly from `var(--board-color)` instead of hardcoded blue.
- **Manual label colours (`PUT /api/labels/:id {name?, color?, merge?}`, `POST /api/boards/:bid/labels {name, color?}`):** validated as `#RRGGBB` (shared `store::paths::is_valid_hex_color`). Edited from the `LabelDrawer` swatch button (12 pastel presets + native `<input type="color">`; `Esc` closes the picker without closing the drawer).
- **Automatic label chip ink:** `colorContrast.ts::labelTextColor` (frontend: `Card.tsx`, `QuickAddPreview.tsx`) and `pdf.rs::contrast_ink` (PDF/A export) pick `#000000` vs `#ffffff` (`INK` vs `WHITE` in PDF) by highest WCAG 2.1 contrast ratio, guaranteeing ≥ 4.5:1 across the entire sRGB cube.
- **Regression prevention:** `colorContrast.test.ts` checks contrast across the sRGB cube and Home tile luminance detection; `e2e/contrast.spec.ts` asserts white header ink and ≥ 4.5:1 computed WCAG contrast on extreme board colours (`#ffffff`, `#fff59d`, `#000000`) across Light/Dark and Kanban/Notes modes, plus manual label colour persistence and ink switching.

## Considered and rejected

- **Black/dark ink in `.app-header`:** looked visually jarring in the top bar and clashed with Electron's white Windows/Linux `titleBarOverlay` caption symbols.
- **Strict OKLCH lightness + chroma clamping across `.board-page` and `.board-card`:** muted vivid board canvases and darkened light Home tiles away from the user's chosen colour.
- **Restricting the board/label colour picker to a fixed palette:** users want free colour choice; upper-bounded header lightness, surface-backed controls, and adaptive chip/tile ink give full freedom without sacrificing readability.
