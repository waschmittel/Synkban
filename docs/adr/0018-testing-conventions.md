# Testing: real-surface e2e first, with isolated servers and guarded regressions

## Decision

Behaviour is verified through the real surfaces. Playwright specs in `frontend/e2e/` boot the **release binary** on port 8091 with a temp `DATA_DIR` and temp `SYNKBAN_CONFIG_DIR` (so tests never touch `~/.config/synkban`). Unit tests cover pure logic (`vitest`, jsdom where the DOM is needed); the backend has unit + `tests/integration.rs` tests and, for PDFs, golden layouts (ADR-0012).

## Rules and caveats

- Build the frontend before the backend (assets are embedded), then run e2e: `./build.sh` does both; `./build.sh --skip-tests` skips e2e; `./run.sh` builds and opens the app.
- **`ControlOrMeta+…`**, never `Control+…` (ADR-0008).
- **Settings specs use a dedicated server on :8092** — settings are global server state and would race parallel specs' `goto("/")`.
- **The drafts spec uses a dedicated server on :8093** (serial); the shared servers run with `SYNKBAN_DRAFTS=0` — the crash draft is one per machine and redirects app start (ADR-0024).
- ProseMirror picks up selection changes asynchronously (`selectionchange`): after click/Shift+arrow, wait a tick before pressing a key that depends on it (`settle()`/`clickCell` helpers).
- The suite shares one server, so use fresh boards per test and assert on unique `data-board-id`s rather than generic titles; re-running the whole suite repeatedly (`--repeat-each`) on one server accumulates boards and can slow `GET /api/boards` or break title-only home-page locators.
- **Never assume async browser work or network mutations settle in one tick:**
  - **Focus and open state before keys:** After opening a dialog, popup menu, or card detail (`CardDetail` focuses `.modal-title-input` on `requestAnimationFrame`), wait for the menu/dialog to be visible (`toBeVisible()`) and for its input to be focused (`toBeFocused()`) before sending shortcuts (`ControlOrMeta+p`, menu hotkeys like `u`, etc.) or calling `waitForEvent("filechooser")` / `waitForEvent("download")`. Wait for overlays/modals/dropdowns to close (`toHaveCount(0)`) before interacting underneath or sending keys.
  - **Reactive text inputs:** Test interactive typing with `page.keyboard.type(..., { delay: 25 })` (crossing animation frames) rather than `.fill()` alone; `.fill()` sets `.value` atomically and hides `requestAnimationFrame` focus/select-all or caret-reset bugs between keystrokes.
  - **File choosers must be DOM-connected and armed before raw key triggers:** Programmatic file pickers must use a DOM-connected `<input type="file" hidden>` rather than an ephemeral detached element, which GC can collect before `change` fires or CDP `DOM.resolveNode` resolves Playwright's `filechooser` event. Tests calling `setInputFiles` should target the input's specific class (`.attachment-file-input` / `.image-file-input`). When triggering a file chooser with a raw `page.keyboard.press(...)` (which has no locator actionability round-trips), call `page.waitForEvent("filechooser")` *before* an awaited UI step or assertion (e.g. `toBeVisible()` / `toBeFocused()`) so Playwright's asynchronous CDP `Page.setInterceptFileChooserDialog` finishes before the keypress fires.
  - **Run the full E2E suite after shared-UI changes:** Shared surfaces like `editorMenu.ts` are asserted across multiple specs (`editor.spec.ts`, `tables.spec.ts`, `tooltips.spec.ts`); run the full `pnpm run test:e2e` suite rather than only the spec file you edited.
  - **Blurring inside `focusTrap`:** Clicking a non-focusable element inside a `focusTrap` modal moves focus to `<body>`, causing `focusTrap` to pull focus back to the first input on `requestAnimationFrame`. To blur an input and keep it blurred, click or focus a *focusable* element inside the modal (e.g. `.ProseMirror`).
  - **UI animations & layout:** Wait for `.modal-content` CSS animations (`getAnimations()`) before measuring bounding boxes or starting drag-and-drop. Use `expect.poll(...)` for scroll/layout assertions after focus/blur/restore rather than one-shot `evaluate()` checks.
  - **API persistence after UI actions:** Clicking a button that fires an async `PUT`/`POST`/`DELETE` does not guarantee the request has completed on the next line. Either wait for the UI state that settles after the request (e.g. dropdown/modal closing) or poll `request.get(...)` with `expect.poll(...)` before asserting backend state.
  - **HTML5 drag-and-drop:** Put the entire sequence (`mouse.up()` → `mouse.move(src)` → `mouse.down()` → `mouse.move(tgt)`) inside `toPass()` so retries can restart a missed `dragstart`.
  - **Network interception:** Wait for `networkidle` after initial page load before installing offline/abort `page.route` interceptors so in-flight mount requests don't race the simulated outage.
- Tooltips and shortcuts are guarded by `e2e/tooltips.spec.ts` (ADR-0008).
- Regressions get a spec that pins the *mechanism* (e.g. stubbed `requestAnimationFrame` to hold the pre-focus state, ADR-0009).
- Frontend: `npx vite build` must be clean; backend: `cargo build` with zero warnings.
