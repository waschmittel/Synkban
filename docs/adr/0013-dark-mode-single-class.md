# Dark mode hangs off one `html.theme-dark` class

`theme` (`system` default | `light` | `dark`) is persisted server-side (ADR-0002). `theme.ts::applyTheme` toggles `html.theme-dark` (resolving `system` through `matchMedia` and staying subscribed so an OS change flips the app live); `isDark` reports the resolution.

## Why

One class keeps the stylesheet DRY: a single dark block at the bottom of `app.css`, no duplicated media queries. Most surfaces flip automatically because CSS routes colours through semantic tokens in `:root` that the dark block reassigns; the block only re-specifies bespoke values (gradients, translucent overlays, info boxes, the ProseMirror sticky-note tint, code/kbd chips) plus `color-scheme: dark` (darkens native controls and date/colour pickers).

## Rules

- **Flash-free:** an inline script in `index.html` sets the class from the OS before first paint; `index.tsx::bootstrap` then applies the persisted choice (corrects only a forced light/dark).
- Board background mixes the board colour **toward black** in dark mode (`color-mix(var(--board-color) 42%, #0d0f14)`) instead of toward white (50%).
- Primary/accent colors (`--color-primary`, `--color-primary-hover`, `--color-accent`, `--ring`) derive from `--board-color` via lightness-clamped `oklch(from …)`: `--color-primary` stays mid-dark (`0.38–0.52` light, `0.42–0.54` dark) for white button text, while `--color-accent` brightens (`0.68–0.78`) in dark mode for outlines, focus rings, and accent text.
- Settings radios preview live; every discard path reverts via `revertThemePreview()`.
- Covered by `e2e/settings.spec.ts`.
