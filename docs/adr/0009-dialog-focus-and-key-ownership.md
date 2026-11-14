# Overlays own focus and keys through three small modules

Every overlay dialog attaches `focusTrap(root)`, registers its keys with `dialogKeys(handler)`, and (if portaled) registers in the overlay stack.

## Why

Without them, focus escaped dialogs to `<body>`, dialogs auto-focusing on the next frame let a fast keypress hit the element behind, and a focus trap reclaimed focus from portaled overlays on top of it (the link dialog was unusable).

## Modules

- **`focusTrap.ts`**: focus never leaves an open dialog. If the focused element disappears or focus lands on `<body>`, focus returns to the last-focused element still inside (`focusin` history + a `MutationObserver`, since browsers don't reliably fire `focusout` on removal). `Tab`/`Shift+Tab` wrap at the edges. Nested traps compose (the inner handles Tab first; outer handlers skip `defaultPrevented`).
- **`overlayLayers.ts`**: a shared open-order stack (`registerOverlay`). A trap yields (`focusInHigherLayer`) when a later-opened layer outside its DOM subtree — the ProseMirror link dialog, or `ShortcutHelp`/`ConfirmDialog` rendered beside an open `CardDetail` — holds focus.
- **`dialogKeys.ts`**: a document-level **capture** keydown stack; the topmost dialog wins. Handlers act only on keys they own and `preventDefault()`/`stopPropagation()` them; everything else propagates (Tab wrap, button Enter, typing). Used by `UnsavedDialog`, `ConfirmDialog`, `ShortcutHelp`, `ArchivePanel`, `HistoryDialog`, `ExportPdfDialog`, the editor menu. Element-level handlers can't do this: they need focus inside, and a one-frame window existed where they didn't (flaky double-Escape on slow CI).

## Also

- Board's global Escape dispatches `request-card-close` so closing routes through the unsaved guard.
- `ConfirmDialog`/`ArchivePanel` keep a catch-all element-level `stopPropagation()` to shield page shortcuts.
- Dialogs auto-focus their default button; Enter runs the focused button.
- Covered by `e2e/focus.spec.ts` (including a stubbed-`requestAnimationFrame` regression).
