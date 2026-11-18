# Network and server errors never masquerade as missing data

`api.ts` turns every transport or HTTP failure into an **`ApiError`** (`status`, `network`), distinguishing unreachable servers (`fetch` rejections, `502`/`503`/`504`, proxy `5xx` without backend JSON, status `0`) from application responses such as `404 Not Found`. Pages keep already-loaded boards/lists on screen across transient outages, surface failures via **`NetworkBanner`** (or inline dialog banners), preserve unsaved inputs, and recover automatically when the server returns.

## Why

Previously every failed request threw an untyped `Error`:
- An unreachable server or offline browser made `Board` show **"Board not found"** and `Home` fall back to **"No boards yet"**.
- A failed background poll refetch replaced an open board (and open card edits) with the error screen.
- Failed writes threw unhandled rejections or used blocking `alert()` dialogs, and `AddForm` cleared its draft before the request succeeded.
- `changePoller` remembered the last `mtime`, so recovering from a failed poll when `mtime` stayed unchanged never triggered a refetch.

## Rules

- **Classify at the API boundary (`api.ts`):**
  - `fetch` rejections (and body-read failures) throw `ApiError(NETWORK_ERROR_MESSAGE, 0, { network: true })`.
  - Non-OK responses parse `{ error }` JSON when available; `502`/`503`/`504` and empty-body/empty-statusText `5xx` responses set `network: true`. Backend `4xx`/`5xx` JSON errors keep `network: false`.
  - Helpers `isNetworkError`, `isNotFoundError`, and `errorMessage` are the single source of truth for UI classification and user-facing wording.
  - `serverUnreachable` and `actionError` signals track live connectivity; a monotonic sequence guard ensures an older in-flight response completing after a newer network failure cannot clear `serverUnreachable` or `actionError`. A newer successful (or non-network HTTP) response clears `serverUnreachable` (plus stale network `actionError`s) and notifies `onReconnect` subscribers. `keepalive` unload requests (ADR-0024 crash drafts) never flip `serverUnreachable`.
- **Never confuse an unreachable server with missing or empty data:**
  - `Board` shows **"Board not found"** only when `isNotFoundError(board.error)` (`404`); network/server load failures show **"Cannot reach the server"** (or **"Could not load board"**) with a **Retry** button and **Back to boards** link.
  - `Home` checks `!boards.error` before `boardList()` and shows **"Cannot reach the server"** with **Retry** when initial loading fails, never **"No boards yet"**.
  - `ArchivePanel`, `SettingsDialog`, and `HistoryDialog` render explicit error states with **Retry** rather than empty lists or an endless `"Loading…"` placeholder.
- **Keep loaded views alive across transient outages:**
  - `board`, `allBoards` (`Board.tsx`), and `boards` (`Home.tsx`) wrap their `createResource` fetchers so that once data for that resource/board id has loaded, a failed `refetch()` with `isNetworkError(err)` returns the previous `value` instead of setting `.error` and tearing down the workspace. A `404` (e.g. a board deleted elsewhere) clears the cached-id guard and transitions to **"Board not found"**.
  - `NetworkBanner` sits at the top of `Home` and `Board` (`suppressWhen={!!board.error}` / `!!boards.error` so initial-load error screens don't duplicate it), offering **Retry** and **Dismiss** (reappearing on new errors or a fresh disconnect).
- **Never lose user input on a failed write:**
  - `AddForm` clears/closes optimistically for snappy focus, but catches rejections from `onAdd`, restores the typed text, and reopens the form. `Home` board creation and `LabelDrawer`/`CardLabelSection` label creation similarly keep inputs open on failure.
  - `CardDetail` catches save, restore, label-creation, attachment-upload, and attachment-deletion failures, rendering `.detail-error-banner` inside the modal/pane (`runSave` returns `false`, closing `UnsavedDialog`/`ExportPdfDialog` back to the editor without discarding edits or downloading a stale PDF). On `onReconnect`, a dirty card re-sends its crash draft.
  - All board/card/list/label handlers wrap mutations in `try / catch` with `reportActionError` instead of unhandled rejections or `alert()`.
- **Automatic recovery (`changePoller.ts` & `onReconnect`):**
  - `changePoller` tracks `hadError`; the first successful poll after an outage triggers `onChange` even if `mtime` did not change, and listens to the browser `online` event to check immediately.
  - Page-level recovery from initial-load errors is driven by `changePoller` and explicit **Retry** buttons (never via `onReconnect`, which would create a feedback loop when sibling requests like `/api/warnings` succeed while a board/list request fails); `onReconnect` is reserved for non-looping side effects such as re-syncing `CardDetail`'s crash draft.
- **Guard all `createResource` reads:** every effect and memo reading `board()`, `allBoards()`, `boards()`, `settings()`, or `history()` must check `.error` first (ADR-0010).
- **Covered by:** `api.test.ts`, `changePoller.test.ts`, and `e2e/board.spec.ts`.

## Considered and rejected

- **Offline queue / client-side mutation log** — conflicts with Synkban's local-first single-machine/sync file model (ADR-0001) and atomic card saves (ADR-0007); keeping the user's open form/editor intact with a clear Retry/banner avoids silent divergence.
- **Global modal error overlay** — blocks access to already-loaded boards and prevents copying unsaved text out of an open card.
- **Using `error()` only in `createResource` without preserving `value` inside the fetcher** — SolidJS sets `resource.error` whenever a fetcher rejects, causing `<Show when={!board.error}>` to unmount the board and open `CardDetail`.
