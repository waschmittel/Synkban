# Testing: real-surface e2e first, with isolated servers and guarded regressions

## Decision

Behaviour is verified through the real surfaces. Playwright specs in `frontend/e2e/` boot the **release binary** on port 8091 with a temp `DATA_DIR` and temp `SYNKBAN_CONFIG_DIR` (so tests never touch `~/.config/synkban`). Unit tests cover pure logic (`vitest`, jsdom where the DOM is needed); the backend has unit + `tests/integration.rs` tests and, for PDFs, golden layouts (ADR-0012).

## Rules and caveats

- Build the frontend before the backend (assets are embedded), then run e2e: `./build.sh` does both; `./build.sh --skip-tests` skips e2e; `./run.sh` builds and opens the app.
- **`ControlOrMeta+…`**, never `Control+…` (ADR-0008).
- **Settings specs use a dedicated server on :8092** — settings are global server state and would race parallel specs' `goto("/")`.
- **The drafts spec uses a dedicated server on :8093** (serial); the shared servers run with `SYNKBAN_DRAFTS=0` — the crash draft is one per machine and redirects app start (ADR-0024).
- ProseMirror picks up selection changes asynchronously (`selectionchange`): after click/Shift+arrow, wait a tick before pressing a key that depends on it (`settle()`/`clickCell` helpers). After opening a dialog, wait for its input to be *focused* before sending keys.
- The suite shares one server, so use fresh boards per test and assert on unique `data-board-id`s rather than generic titles; re-running the whole suite repeatedly (`--repeat-each`) on one server accumulates boards and can slow `GET /api/boards` or break title-only home-page locators.
- **Never assume async browser work settles in one tick:**
  - Wait for `.modal-content` CSS animations (`getAnimations()`) before measuring bounding boxes or starting drag-and-drop.
  - Use `expect.poll(...)` for scroll/layout assertions after focus/blur/restore rather than one-shot `evaluate()` checks.
  - Put the entire HTML5 drag sequence (`mouse.up()` → `mouse.move(src)` → `mouse.down()` → `mouse.move(tgt)`) inside `toPass()` so retries can restart a missed `dragstart`.
  - Wait for `networkidle` after initial page load before installing offline/abort `page.route` interceptors so in-flight mount requests don't race the simulated outage.
- Tooltips and shortcuts are guarded by `e2e/tooltips.spec.ts` (ADR-0008).
- Regressions get a spec that pins the *mechanism* (e.g. stubbed `requestAnimationFrame` to hold the pre-focus state, ADR-0009).
- Frontend: `npx vite build` must be clean; backend: `cargo build` with zero warnings.
