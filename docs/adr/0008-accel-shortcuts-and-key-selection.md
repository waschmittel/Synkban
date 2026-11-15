# Shortcuts use the platform accelerator, chosen from a safe set of keys

"Accel" is **Cmd on macOS, Ctrl everywhere else**, never both. `platform.ts` owns it (`isMac`, `accelLabel`, `hasAccel(e)`, `accel()`, `tip()`); every modifier chord goes through `hasAccel`, which also rejects Shift/Alt so `Accel+Shift+X` can't fire an `Accel+X` binding. Synkban must work identically on macOS, Linux and Windows, in browser and Electron.

## Why

Matching `metaKey || ctrlKey` steals macOS's Ctrl text bindings in every input (Ctrl+A/E/D/K/T). Keys differ per OS and layout, so the rules below are what keeps a shortcut from being dead on one platform.

## Rules

- **Never hardcode ⌘ or Ctrl** in code, tooltips or specs (Playwright presses `ControlOrMeta+…`, never `Control+…`).
- **No Alt chords** (Option types glyphs on macOS, Alt opens menus on Windows/Linux and Alt+←/→ is history, Ctrl+Alt is AltGr on many layouts). Sole exception: `Shift+Alt+←/→` to move lists.
- **Prefer letters over punctuation** (`/` is `Shift+7` on German layouts).
- **Never a browser-reserved key** (`Ctrl+T/N/W/Q`, `Ctrl+<digit>`: `preventDefault` does nothing, the binding is simply dead) and **never a text-editing key** (`C/V/X/A/Z/Y`: they fire while typing and would break copy/paste/undo; `Accel+C` for the checklist did exactly that). The rest (S D E G J K L O U) only overrides browser conveniences. Prefer letters that mirror a board shortcut.
- Non-chord handlers **bail on unowned modifiers** (`Card.tsx`, `ChecklistSection.tsx`) so Ctrl+Home, Alt+←, Cmd+Enter and Ctrl+Space aren't swallowed.
- **Discoverability:** every control with a shortcut carries `Label (KEY)` as its tooltip via `tip()`/`accel()`; Escape-closable dialogs have `Close (Esc)` / `Cancel (Esc)`. Adding or changing a shortcut means updating (1) the tooltip, (2) `ShortcutHelp.tsx`, (3) `e2e/tooltips.spec.ts`. Keyboard-only navigation without a control (arrow roving, `Shift+↑↓`) is help-dialog only.
- **The help is contextual:** tabs Boards / Board / Notes / Card / Editor, opened on the one for where focus is (`helpContextOf`: the description editor → Editor, the card dialog or pane → Card, else the board's view), marked "●". `←/→` or `1`–`5` switch tabs, `?`/`Esc` close, focus returns to where it was.
- **Global single-letter shortcuts** register through `shortcutRouter.ts` and are gated by `isInInput` (inputs, textareas, contentEditable, and anything inside `.modal-overlay`, `.label-drawer`, `.shortcut-help-overlay`, `.archive-overlay`, `.settings-overlay`, `.filter-bar`).
- `Backspace` is suppressed at board-page level to prevent browser-back.

## The map

Board: `b` boards, `l` add list, `n`/`c` add card, `e` edit, `g` labels, `f` filter, `a` archive, `?` help, `,`/`.` cycle boards, `v` Board/Notes view (ADR-0022), `Esc`. Notes view: `←→` switch list tabs, `Shift+←→` move the card to the neighbour tab, `Esc` from anywhere returns to the selected card, `r` or a click on the active tab renames its list. Cards: arrows move focus (`←→` index-aware), `Home/End` (`PageUp/Down` alias), `Shift+arrows` reorder/move, `Shift+Home/End` to top/bottom, `Enter/Space` open, `Delete` archive. Home: `n`, arrows, `Shift+arrows` reorder, `Delete`, `a`. Card modal: `Accel+S` save, `E` title, `G` labels, `D` description, `L` checklist, `O` attach, `U` due date (opens the picker, ADR-0023), `K` editor menu (ADR-0016), `J` history, `P` PDF. Full list: `ShortcutHelp.tsx`.
