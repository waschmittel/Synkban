# One context-sensitive editor menu (Accel+K); a text-style dropdown that shows state

## Text styles

`TEXT_STYLES` (`schema.ts`): Plain text, Code block, **Heading 1, 2, 3** — always spelled "Heading n", never "H1", in every menu and tooltip. The toolbar `TypeDropdown` **shows the current style**; unavailable choices stay **listed but greyed**, the current one is marked; where the style can't change at all (table cells) the **whole dropdown is disabled**. Inline marks (bold, italic, inline code) work everywhere including table cells.

## The menu

`Accel+K` or right-click opens `.table-menu` (`editorMenu.ts::openEditorMenu`) beside the caret: one mechanism for keyboard and touch, items clickable *and* carrying on-screen single-key hints. In the toolbar, a flat **`+ Insert`** menu button (`InsertDropdown`, visually distinct from the bordered Text-style select dropdown) groups **Footnote**, **Image**, **Table**, **Matrix**, **Bullet list**, **Ordered list**, and **Blockquote** — each with icon + text — and disables items where insertion is invalid (e.g. tables/matrices inside a table, or footnotes inside a footnote/code block). Groups in the `Accel+K` menu, divided by separators, no headings, an icon each:

| Group | Items (key) | Availability |
|---|---|---|
| Link | Add/Edit link… (`L`), Remove link (`U`) | greyed when not applicable |
| Code / Inline | Inline code (`I`), Insert image… (`M`), Insert/Jump footnote (`F`) | greyed when not applicable |
| Footnote | Delete footnote (`D`; tinted danger) | inside a footnote definition |
| Text style | Plain (`0`), Code block (`B`), Heading 1–3 (`1`–`3`); current highlighted | **omitted in table cells** |
| Insert | Insert table 3×3 (`T`), Insert matrix 3×3 (`X`) | outside tables |
| Block | Insert paragraph above (`Shift+P`), Insert paragraph below (`P`) | inside tables, code blocks, quotes, lists (before Delete inside tables) |
| Table | move row/column (`W`/`S` up/down, `A`/`D` left/right), transpose matrix (`X`), insert row/column (Shift+arrows), align column or matrix cell (`1`/`2`/`3`), delete row/column/table or matrix (`R`/`C`/`T`; tinted danger) | inside tables/matrices |

## Why

A modifier chord per operation doesn't scale and collides across OSes (ADR-0008); one chord opens a menu whose keys are visible. Text styles are omitted in cells (rather than greyed) because the block type is fixed there and the digits mean alignment.

## Rules

- Keyboard focus **never leaves the editor** (items swallow `mousedown`): selection and touch keyboard survive.
- While open the menu owns the keyboard (`dialogKeys`, ADR-0009) and swallows every other key so nothing reaches the document; other chords (`Accel+S`) pass through. `Esc`, `Enter` and `Accel+K` close.
- **Every action closes the menu**; a disabled action is ignored and the menu stays open. Reopen to repeat.
- Keys match only *enabled* items.
- **Right-click does exactly what Accel+K does**, anchored at the pointer: same menu, same items. The caret moves to the click first (like a native right-click) unless the click lands inside the current selection, which is kept. The native context menu is not offered inside the editor.
- Icons are static inline SVG (`tableIcons.ts`) — the only `innerHTML` source; nothing user-controlled reaches it.
- Discoverability per ADR-0008 (`ShortcutHelp.tsx`, `tooltips.spec.ts`).

## Menu navigation and image items

- All popup menus (editor menu, image picker; `menuNav.ts`): `↑`/`↓` (wrapping) and `Home`/`End` move a highlight over the enabled items, `Enter` runs the highlighted item (without a highlight it closes the menu), `Esc` closes. Letter/digit shortcuts keep working. Arrow keys therefore no longer move table rows/columns (`W`/`S`/`A`/`D`); `Shift`+arrows still insert.
- `M` / the toolbar image button open the image picker (ADR-0020); both are greyed out where an inline image cannot go (code blocks).
