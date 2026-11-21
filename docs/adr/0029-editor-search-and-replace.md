# Description editor find and replace is a ProseMirror plugin with a docked bar

The card description editor provides live **Find** (`Accel+F` or the toolbar search button) and collapsible **Find & Replace** (`Accel+Shift+H` or the bar's chevron) via a custom ProseMirror plugin (`editorSearch.ts`) and a SolidJS bar (`EditorSearchBar.tsx`) docked directly below `.ProseMirror-menubar` inside `.editor-wrapper`.

## Why

Long notes in Notes mode and detailed cards in the Kanban modal need in-document search and batch replacement without leaving the editor or breaking rich-text structure. A small custom plugin (matching `tables.ts`, `links.ts`, and `luaBlock.ts`) keeps bundle size minimal and gives exact control over match counts, invalid-regex error feedback, and SolidJS reactivity.

## Rules

- **Shortcuts (ADR-0008):** `Accel+F` opens Find; `Accel+Shift+H` opens Find & Replace (`Accel+H` is unavailable — `Cmd+H` hides the app on macOS and `Ctrl+H` opens browser history elsewhere). Inside Find: `Enter` / `Shift+Enter` step next / previous (wrapping). Inside Replace: `Enter` replaces the active match and advances, `Accel+Enter` replaces all. `Esc` closes the bar first (returning focus to the editor at the active match) before closing the card modal or leaving the Notes pane.
- **Scope & matching:** Matches are computed per `isTextblock` node (`paragraph`, `heading`, `code_block`, `lua_block`, table cell paragraphs, list items, blockquotes) with a `charOffset → docPos` map so queries match across inline marks (`strong`, `em`, `code`, `link`) while never bridging across separate blocks, table cells, or inline `image` nodes (`\uFFFC` barrier).
- **Options:** Switchable case sensitivity (`Aa`) and optional regular expressions (`.*`); no whole-word toggle. Invalid regexes surface an inline error without throwing. Zero-length matches (`^`, `a*`, lookaheads) advance `lastIndex` and are skipped; matches are capped at 10,000 so pathological patterns cannot freeze the UI.
- **Replacement & undo:** Literal mode treats `$` verbatim (so `$100` is never expanded); regex mode supports JS capture groups (`$1`, `$&`, `$$`). `tr.insertText` preserves marks at the match start. Single replace advances the selection past the inserted text so self-matching replacements (`foo` → `foobar`) never stall. Replace all applies edits in reverse document order inside one transaction so a single `Accel+Z` undoes the entire batch.
- **Lifecycle & focus:** Opening Find pre-fills a non-empty single-line editor selection. Focus/select runs only on explicit open/shortcut requests (`on(() => props.focusRequest)`), never on search-state updates while typing, and external query syncing guards `input.value !== query` so mid-string edits keep caret position. Navigating or typing scrolls the active `.pm-search-match--active` decoration into view without dispatching a ProseMirror selection change; `TextSelection` is synced to the active match on close. Switching cards in Notes mode (or reverting/reloading the doc) closes the search bar automatically. Because the bar mounts inside `.editor-wrapper`, `CardDetail`'s `focusTrap` (ADR-0009) covers it with no extra overlay layer.
- Covered by `editorSearch.test.ts`, `e2e/editor.spec.ts`, `e2e/notes.spec.ts`, and `e2e/tooltips.spec.ts`.

## Considered and rejected

- **`prosemirror-search` dependency.** Adds another package whose built-in UI and state model would still need wrapping for SolidJS, live match counts, and regex error feedback.
- **`Accel+H` for Replace.** Uninterceptable on macOS (`Cmd+H` hides the app) and conflicts with browser history (`Ctrl+H`) on Windows/Linux (ADR-0008).
- **Keeping the bar open across card switches in Notes mode.** Stale queries and highlights from a previous note are distracting; closing on card switch keeps each note clean.
