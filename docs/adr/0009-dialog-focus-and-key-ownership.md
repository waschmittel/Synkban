# Overlays own focus and keys through small shared modules

Every modal dialog renders `<dialog>` with `modalDialog(el)` (which opens via `showModal()` and attaches `focusTrap(el)`), registers its keys with `dialogKeys(handler)`, and participates in the overlay stack (`overlayLayers.ts`). Floating menus and pickers use `floatingPopup.ts` (`popover="manual"`). See also ADR-0033.

## Why

Without them, focus escaped dialogs to `<body>`, dialogs auto-focusing on the next frame let a fast keypress hit the element behind, a focus trap reclaimed focus from sibling/higher overlays on top of it, and `position: absolute` dropdowns clipped inside `.editor-wrapper` / `.modal-body`.

## Modules

- **`modalDialog.ts`**: wires native `<dialog>.showModal()` (top layer + native inertness), suppresses native `cancel` so `Escape` routes through `dialogKeys` / `guardedClose`, keeps initial focus on the `<dialog>` container until the dialog's own `rAF` focuses its intended button/input, and attaches `focusTrap`.
- **`floatingPopup.ts`**: shared top-layer (`popover="manual"`) popup helper with viewport clamping (below/above flip + `maxHeight` scroll), resize/scroll repositioning, exclusive single-open coordination, and automatic dismissal when `overlayLayers` registers a modal.
- **`focusTrap.ts`**: focus never leaves an open dialog. If the focused element disappears or focus lands on `<body>`, focus returns to the last-focused element still inside (`focusin` history + a `MutationObserver`, since browsers don't reliably fire `focusout` on removal). `Tab`/`Shift+Tab` wrap at the edges. Nested traps compose (the inner handles Tab first; outer handlers skip `defaultPrevented`).
- **`overlayLayers.ts`**: a shared open-order stack (`registerOverlay`, `onOverlayOpen`). A trap yields (`focusInHigherLayer`) when a later-opened layer outside its DOM subtree — the ProseMirror link dialog, or `ShortcutHelp`/`ConfirmDialog` rendered beside an open `CardDetail` — holds focus, and open floating popups dismiss whenever a higher overlay registers.
- **`dialogKeys.ts`**: a document-level **capture** keydown stack; the topmost dialog wins. Handlers act only on keys they own and `preventDefault()`/`stopPropagation()` them; everything else propagates (Tab wrap, button Enter, typing). Used by `UnsavedDialog`, `ConfirmDialog`, `ShortcutHelp`, `ArchivePanel`, `HistoryDialog`, `ExportPdfDialog`, `ImagePreviewOverlay`, `links.ts`, the editor menu, and toolbar dropdowns. Element-level handlers can't do this: they need focus inside, and a one-frame window existed where they didn't (flaky double-Escape on slow CI).

## Also

- Board's global Escape dispatches `request-card-close` so closing routes through the unsaved guard; with no overlay open in Kanban view, Escape closes the label drawer if open and leaves focus on the current card (rather than blurring it to `.board-page`).
- `ConfirmDialog`/`ArchivePanel` keep a catch-all element-level `stopPropagation()` to shield page shortcuts.
- Dialogs auto-focus their default button; Enter runs the focused button.
- Covered by `e2e/focus.spec.ts` (including a stubbed-`requestAnimationFrame` regression).
