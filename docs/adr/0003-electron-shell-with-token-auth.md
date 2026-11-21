# Desktop mode is an Electron shell around the Rust binary, guarded by a token

`electron/main.js` spawns the release binary with `DESKTOP_TOKEN=<uuid>`, reads `DESKTOP_PORT=<port>` from its stdout, then opens a `BrowserWindow` at `http://127.0.0.1:<port>/?token=<token>`. `lib.rs::run_desktop_server` binds `127.0.0.1:0` and wraps every request in token middleware (`synkban_token` cookie or `?token=`; the first load sets the cookie). Web mode (`run_server`) is unchanged.

## Why

Other local apps must not reach the UI or data, so each launch gets a fresh secret and a random port. Electron passes no `DATA_DIR`; the binary resolves it itself (ADR-0002).

## Rules

- **IPC is shell-only.** All board/card/settings traffic is HTTP. The only bridge is `window.synkbanDesktop` (`pickDataDir`, `relaunch`) from `preload.js`, feature-detected by `settings.ts::desktopBridge()`; web mode shows a read-only hint.
- **Seamless title bar.** The window is frameless; the app's coloured `.app-header` is the title bar (`-webkit-app-region: drag`, `no-drag` on controls). `titleBarOverlay` is set on **every** platform because that is what publishes `env(titlebar-area-*)`. Clearing the window controls is **pure CSS** — `padding-left: max(16px, env(titlebar-area-x, 0px))`, `padding-right: max(16px, 100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))` — so no side or platform is hardcoded (controls are on the left on macOS, right on Windows, either on Linux) and fullscreen/web fall back to 16px. The frontend only adds `html.electron`. Keep `HEADER_HEIGHT` in `main.js` equal to `.app-header` (52px); macOS traffic lights are centred with `(HEADER_HEIGHT - 14) / 2` (14px measured, not the 12px usually quoted).
- **Icons:** macOS `icon.icns`, Windows `icon.png`, Linux the whole `backend/icons/png/` set (a single PNG installs to an undeclared hicolor size and the icon resolves to nothing). `desktopName` in `package.json` plus a `BrowserWindow` icon and `app.setAppUserModelId('com.synkban.app')` link window to launcher. Guarded by `e2e/electron.spec.ts`.
- **Window geometry** is remembered per ADR-0019.
- Packaging: `./build.sh --desktop` → `electron/dist/` (electron-builder; the Rust binary is an `extraResource`, per platform). On Linux, `build.sh` compiles the backend for `*-unknown-linux-musl` so the bundled binary has no host `glibc` dependency; if the backend fails to start, `main.js` shows a native error dialog with captured stderr and exits with code 1.

## Considered and rejected

- **Tauri.** Dropped; `build.rs` is a no-op.
- **Measuring controls in JS.** `env()` stays live on resize/maximise for free.
