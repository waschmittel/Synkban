# Top-layer overlays: `<dialog>.showModal()` for modals, `popover="manual"` for floating popups

All modal dialogs open via native `<dialog>.showModal()` (`modalDialog.ts`), and all floating menus, dropdowns, and pickers open in the browser top layer via `popover="manual"` (`floatingPopup.ts`).

## Why

- Toolbar dropdowns (`Text style` and `+ Insert`) previously subclassed `prosemirror-menu`'s `Dropdown`, which mounted `position: absolute` menus inside `.editor-wrapper` (`overflow: hidden`) and `.modal-body` (`overflow-y: auto`). On a short/new card in Board view, both menus were clipped at the bottom.
- Six editor popups (`editorMenu`, `highlights` ×2, `alerts`, `imagePicker`, `luaSyntax`) plus `DuePicker` each reimplemented `document.body` portaling, viewport clamping, outside-click dismissal, and `z-index` layering independently.
- Native `<dialog>.showModal()` makes everything outside the `<dialog>` `inert`, so `document.body`-portaled popups would become unclickable from inside a modal. Keeping popups in their owning DOM subtree with `popover="manual"` keeps them interactive inside `<dialog>.showModal()` while still escaping every ancestor `overflow` and stacking context.

## Rules

- **Modals (`modalDialog.ts`):** `CardDetail` (`variant="modal"`), `ConfirmDialog`, `UnsavedDialog`, `ExportPdfDialog`, `HistoryDialog`, `ImagePreviewOverlay`, `ArchivePanel`, `ShortcutHelp`, `SettingsDialog`, and `showLinkDialog` (`links.ts`) render `<dialog>` and call `modalDialog(el)`.
  - `modalDialog` calls `el.showModal()` once connected, focuses the `<dialog>` (`tabindex="-1"`) until each dialog's own `rAF` moves focus to its intended control (preventing `showModal()` from focusing a destructive button or letting a triggering `Enter` keypress click a button inside the dialog), suppresses native `cancel` so `Escape` routes through `dialogKeys` / `guardedClose`, and attaches `focusTrap`.
  - **Notes mode (`CardDetail variant="pane"`):** stays a normal inline `<div class="notes-detail">` (not a `<dialog>`). Sub-dialogs opened from Notes mode open in the top layer above the pane.
- **Floating popups (`floatingPopup.ts`):** `TypeDropdown`, `InsertDropdown`, `openEditorMenu`, `openHighlightSwatchPopover`, `openHighlightPicker`, `openAlertPicker`, `openImagePicker`, Lua autocomplete (`luaSyntax.ts`), `DuePicker`, and the persistent table controls (`.table-bar` / `.table-edge-add` in `tableBar.ts`) render inside their owning container with `popover="manual"` + `position: fixed`.
  - `positionFloating` clamps horizontally within viewport margins, opens below the anchor by default, flips above when space below is insufficient, and scrolls inside `maxHeight` on the roomier side on very short viewports; open popups reposition on window `resize` and ancestor `scroll`.
  - Opening any exclusive floating popup closes the previously open one, and `overlayLayers.ts::onOverlayOpen` automatically dismisses open popups whenever a modal opens.
  - Because top-layer elements paint in exact open order, overlay `z-index` values are removed from modals and floating popups; CSS resets UA `<dialog>` and `[popover]` defaults via zero-specificity `:where(...)` rules in `app.css`.

## Considered and rejected

- **`document.body` portals with `z-index`:** works for clipping, but fights native `<dialog>.showModal()` inertness, loses inherited CSS custom properties / scoped selectors, requires manual teardown on parent unmount, and keeps the `z-index` layering table alive.
- **`popover="auto"`:** built-in light-dismiss and `Escape` handling conflict with `dialogKeys` and `overlayLayers` (ADR-0009); `"manual"` gives exact control over `Escape`, toggle buttons, and focus return.
- **Increasing `.ProseMirror` / `.modal-content` `min-height`:** wastes vertical space on short cards and still fails when the toolbar sits near the bottom of the viewport.
