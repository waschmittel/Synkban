# The desktop window restores its last size, position and state

`electron/window-state.js` saves `getNormalBounds()` plus state flags to `<userData>/window-state.json` (debounced on resize/move/state events, and synchronously on close); `main.js` loads it before creating the `BrowserWindow`.

## Why

Users expect the window to reopen where they left it. Conventions differ by platform, so the state is applied per platform rather than uniformly.

## Rules

- **Normal bounds, not current bounds**: maximised/fullscreen windows keep the last un-maximised rect, so un-maximising returns to the user's size.
- **Windows/Linux**: restore the maximised state; fullscreen (F11) is transient and never restored.
- **macOS**: "zoom" is just a size, so only fullscreen is restored. Real `getBounds()` is saved (not `getNormalBounds()`): a window tiled by Rectangle & co. counts as zoomed and `getNormalBounds()` then returns a stale pre-zoom rect, losing both position and size. In fullscreen the last non-fullscreen bounds are kept.
- **Always fully visible** (`sanitize`, `fitToDisplays`): the window is fitted to the display it overlaps most — shrunk to its work area if larger, nudged back in if partly off-screen. With no overlap (monitor unplugged) the position is dropped so the OS centres it. Corrupt/missing file → defaults (1200×800, OS-placed). A minimum size (400×300) is enforced.
- Best-effort I/O: write failures are ignored. Unit tests: `cd electron && pnpm test`; relaunch spec in `e2e/electron.spec.ts`.

## Considered and rejected

- **`electron-window-state` dependency.** ~100 lines; no per-platform fullscreen/maximise policy.
- **Storing in `synkban.toml`.** Geometry is per-machine shell state, not a backend setting (ADR-0002).
