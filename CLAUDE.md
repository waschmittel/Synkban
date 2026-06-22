# Agent Instructions — Synkban

## Project Overview

Local-first, syncable kanban board. Rust backend (Actix Web), SolidJS frontend, file-based JSON storage. Single binary with embedded frontend. Optional Electron desktop shell wraps the web UI in a native window.

## Build & Run

```bash
# Full production build (frontend first, then backend with embedded assets)
./build.sh

# Skip the Playwright e2e tests
./build.sh --skip-tests

# Run
./backend/target/release/synkban
# → http://localhost:8080

# Desktop mode build (Electron app — packages Rust binary + Electron shell)
./build.sh --desktop
# → electron/dist/

# Desktop mode dev (Electron loads pre-built Rust binary)
cd electron && pnpm install && pnpm start

# Development (two terminals)
cd backend && cargo run          # :8080
cd frontend && pnpm run dev       # :3000 (proxies /api → :8080)
```

## Verify Changes

After any code change:

1. **Backend changes:** `cd backend && cargo build` — must compile with zero warnings
2. **Frontend changes:** `cd frontend && npx vite build` — must build cleanly
3. **Full build:** `./build.sh` — frontend must build before backend (assets embedded at compile time), then runs Playwright e2e tests against the built binary
4. **Smoke test:** Start server, `curl http://localhost:8080/api/boards` should return `[]` on fresh data dir
5. **E2E tests:** `cd frontend && pnpm run test:e2e` — Playwright specs in `frontend/e2e/` boot the release binary on port 8091 with a temp `DATA_DIR` (config: `frontend/playwright.config.ts`). Requires `backend/target/release/synkban` to exist and `pnpm exec playwright install chromium` once per machine. Runs automatically as part of `./build.sh`.

## Desktop Mode

Electron is the desktop shell. It spawns the Rust binary as a child process with token auth, then opens a `BrowserWindow` pointing to the backend's local HTTP server.

- `./build.sh` — web-only build (default)
- `./build.sh --desktop` — builds backend + packages Electron app via `electron-builder` → `electron/dist/`
- `cd electron && pnpm start` — dev mode (requires pre-built Rust binary at `backend/target/release/synkban`)
- `./backend/target/release/synkban` — web server mode (standalone, unchanged)

### System Dependencies for Desktop Build

- **All platforms:** Node.js 18+ (for Electron packaging)
- **macOS:** Xcode Command Line Tools
- **Linux:** `libgtk-3-dev`, `libxss1`, `libnss3`
- **Windows:** Visual Studio Build Tools

### Desktop Architecture

- `electron/main.js` — Electron main process. Generates a UUID token, spawns the Rust binary with `DESKTOP_TOKEN=<token>` and `DATA_DIR=<userData>` env vars, reads `DESKTOP_PORT=<port>` from stdout, then opens `BrowserWindow` at `http://127.0.0.1:<port>/?token=<token>`.
- `electron/package.json` — `electron-builder` config. Bundles Rust binary as `extraResources` alongside the Electron app. Icons from `backend/icons/`.
- `lib.rs` exposes `run_server` (web mode) and `run_desktop_server` (desktop mode with token middleware + random port); `main.rs` is a thin entry point.
- **Token protection** — Electron generates a UUID token per launch and passes it to the Rust binary via `DESKTOP_TOKEN`. Actix middleware (`wrap_fn`) checks every request for a `synkban_token` cookie or `?token=` query param. Initial page load sets the cookie via query param; subsequent same-origin requests include the cookie automatically. Other local apps cannot access the UI.
- **Random port** — desktop server binds to `127.0.0.1:0` (OS assigns free port). Rust prints `DESKTOP_PORT=<port>` to stdout; Electron reads it before opening the window.
- **Data directory** — Electron passes `DATA_DIR=app.getPath('userData')` (platform-specific user data dir) to the Rust binary. Overridable via env var.
- No Electron IPC — all communication is HTTP via the embedded Actix server. Frontend is unchanged.
- **Seamless title bar** — Electron creates the window without a native frame so the app's own coloured `.app-header` extends to the top edge. macOS uses `titleBarStyle: 'hiddenInset'` with `trafficLightPosition: { x: 14, y: 16 }`; Windows/Linux use `titleBarStyle: 'hidden'` plus `titleBarOverlay` (transparent fill, white symbols, 36px). Frontend bootstrap (`index.tsx`) detects Electron via `navigator.userAgent` and adds `html.electron` (always) and `html.electron--mac` (on macOS). CSS then sets `-webkit-app-region: drag` on `.app-header` (and `no-drag` on its buttons/inputs/links), reserves `padding-left: 84px` on macOS for the traffic lights, and adds right margin to `.app-header-actions` on Windows/Linux so the native controls don't cover the action buttons. The header still doubles as the drag region in all electron modes.
- `build.rs` is a no-op (`fn main() {}`). No Tauri build-time codegen.

## Architecture Rules

### Backend (`backend/src/`)

- **No database.** Storage is JSON files. Never add SQLite, Postgres, or any DB dependency.
- **`store/`** is the only place that touches the filesystem for data. Handlers call `store::*` functions — `mod.rs` re-exports a flat public API so handlers don't care about the internal layout. Submodules:
  - `store/paths.rs` — pure path helpers (no I/O)
  - `store/io.rs` — JSON read/write, file-op tracking (`FILE_OPS` thread-local + `drain_file_ops`), `remove_dir_if_empty`, mtime walk, timestamp formatting
  - `store/boards.rs` — board CRUD + `BoardFile` (the on-disk shape, includes labels)
  - `store/labels.rs` — label CRUD (labels live inside `board.json`, no separate file)
  - `store/lists.rs` — list CRUD; `delete_list` archives any contained cards
  - `store/cards.rs` — card CRUD, `CardLocation` enum (in-list vs orphaned), `get_archived_cards`
  - `store/card_index.rs` — locate a card (and its board/list) by ID across the tree
  - `store/attachments.rs` — attachment binary I/O + thumbnail generation + sidecar metadata (`load_attachments`, `move_card_attachments`)
  - `store/gc.rs` — startup reconcile/GC for attachment storage (migrate pre-sidecar metadata, drop orphaned dirs + partial files; mtime grace window guards in-flight syncs)
  - `store/walk.rs` — the only `fs::read_dir` walker over the `boards/` tree; defines what counts as a valid board (dir + `board.json`), list (dir + `list.json`) and card (`*.json` file). All enumeration (`scan_boards`, `get_board`, `get_archived_cards`, `card_index` scan, `find_board_for_list`, `max_position`) goes through it
- **Handlers** are thin — extract params, call store, return JSON. No business logic in handlers. All mutating handlers (create/update/delete) log to stdout with action summary + explicit file list. `store::io::track` records every file write/delete via thread-local `FILE_OPS`; handlers drain via `store::drain_file_ops(&data_dir)` after each store call. Format: `[HH:MM:SS] ACTION entity "name" (id: ...)` header, then indented lines like `wrote boards/{bid}/board.json` or `deleted dir boards/{bid}/lists/{lid}`. Timestamp from `log_timestamp()` in `lib.rs` (UTC HH:MM:SS).
- **Models** in `models.rs` — all data types and request/response DTOs live here.
- **Errors** in `errors.rs` — `AppError` enum, implements `ResponseError`. Four variants: `NotFound`, `Io`, `TooLarge` (HTTP 413, attachment size), `BadRequest` (HTTP 400, validation errors like invalid date format).
- **Static files** embedded via `include_dir!("$CARGO_MANIFEST_DIR/static")`. The `backend/static/` directory must exist at compile time (created by `build.sh`).
- **No auth.** Single-user MVP. Don't add auth unless explicitly asked.

### Frontend (`frontend/src/`)

- **SolidJS** — not React. No virtual DOM. Use `createSignal`, `createResource`, `Show`, `For`. Never use React patterns (useState, useEffect, etc.).
- **Router:** `@solidjs/router` — routes in `index.tsx`, pages in `pages/`.
- **API client:** `api.ts` — all backend calls go through this module. Typed fetch wrapper.
- **Types:** `types.ts` — TypeScript interfaces matching backend models. Keep in sync with `models.rs`.
- **Module layout:**
  - `pages/` — `Home.tsx` (boards grid) and `Board.tsx` (board view, coordinator for lists/cards/drawer/archive/filter)
  - `components/` — leaf and section components. `Card`, `List`, `CardDetail`, `AddForm`, `ShortcutHelp`, `WarningBanner`; board-level sections (`LabelDrawer`, `ArchivePanel`, `FilterBar`, `BoardColorPicker`, `ConfirmDialog`); card-detail sections (`CardLabelSection`, `DueDateSection`, `ChecklistSection`, `AttachmentsSection`, `ImagePreviewOverlay`, `UnsavedDialog`)
  - Shared utilities at `src/` root: `boardInput.ts` (`isInInput` guard), `shortcutRouter.ts` (global shortcut dispatch), `mdInput.ts` (`**bold**`/`*italic*` Ctrl+B/I for plain inputs), `autolink.ts` (editor URL autolinking), `proseEditor.ts` (ProseMirror schema + `createCardEditor`), `positions.ts` (fractional indexing math), `filter.ts` (card filter predicate), `focusTrap.ts` (dialog focus containment), `dialogKeys.ts` (capture-phase dialog key ownership), `overlayLayers.ts` (overlay stacking), `focusRestoration.ts` (card focus across refetch), `changePoller.ts` (mtime poll protocol), `rovingFocus.ts` (↑↓ focus between rows), `touchDrag.ts` (touch DnD), `confirm.tsx` (imperative confirm)
  - `LabelDrawerContext.tsx` (`useLabelDrawer` → `{ isOpen, open, close, toggle }`) and `BoardHeaderContext.tsx` (`useBoardHeader` → `{ isOnBoard, setIsOnBoard, title, setTitle, renaming, setRenaming, renameValue, setRenameValue }`) — cross-component state shared across `App`/`Board`
- **ProseMirror** for rich text in card descriptions. Schema includes basic nodes + lists, but `image` and `horizontal_rule` nodes are removed (not insertable). `list_item` content is `paragraph block*`, so bullet/ordered lists can be nested arbitrarily deep. The "Insert" dropdown is excluded from the menu. Editor menu uses a prosemirror-menu `Dropdown` labeled "Type" containing Plain, Code, H1, H2, H3. Styled with border, background, rounded dropdown menu. Links use a custom dialog (not the default `openPrompt`) with proper z-index, single URL field, pre-fill from selected URL text. A custom `keymap` plugin binds `Tab` → `sinkListItem` (indent/nest) and `Shift-Tab` → `liftListItem` (outdent); the example-setup defaults (`Mod-]`/`Mod-[`) still work too. `.editor-wrapper` background is a light yellow (`#fffbe6`) sticky-note tint to visually distinguish the description from the rest of the modal; the menubar keeps its grey (`#fafbfc`) for hierarchy. Description stored as ProseMirror JSON string. No raw HTML ever.
- **Drag-and-drop:** Native HTML5 API. No drag library. Position calculated via fractional indexing (midpoint between neighbors). Both cards and lists use the `requestAnimationFrame` trick: browser captures full-opacity ghost synchronously in `dragstart`, then next frame sets the drag class (`display:none`) to hide the original. Cards use `.dragging`, lists use `.list-dragging`. A `.drop-placeholder` line shows card insertion point; a column-sized dashed `.list-drop-placeholder` shows list insertion point. Card `dragstart` calls `stopPropagation()` to prevent list from also entering drag state. Placeholders cleaned up on `dragend` and `drop`.
- **Auto-focus:** Input fields use `ref={(el) => requestAnimationFrame(() => el.focus())}`. Do not use `autofocus` attribute (doesn't work reliably with SolidJS `Show`).
- **CSS:** All styles in `styles/app.css`. No CSS modules, no Tailwind, no CSS-in-JS.

### Data model

```
Board  →  has many Labels (per-board)
Board  →  has many Lists  →  has many Cards
Cards  →  reference Labels by ID (label_ids: Vec<String>)
```

- IDs are UUIDs (v4), generated server-side.
- `position: f64` — fractional indexing. New items: `max + 1.0`. Reorder: midpoint between neighbors.
- Card `description` — ProseMirror doc JSON string, or empty string `""`.
- Card `label_ids` — array of label IDs (subset of board's labels). Uses `#[serde(default)]` so existing cards without the field deserialize as empty vec.
- Board `archived: bool` — soft delete for boards. `list_boards` filters out archived boards. `GET /api/boards/archive` returns archived boards. `PUT /api/boards/:id` with `{ archived: true }` archives; `{ archived: false }` restores. `DELETE /api/boards/:id` rejects non-archived boards (400) — must archive first. Home page X button archives (with confirmation), archived boards panel has Restore and Delete (permanent, with confirmation). Uses `#[serde(default)]` for backward compatibility.
- Board `position: f64` — fractional indexing for board ordering. New boards get `max + 1.0`. Sort uses `(position ASC, created_at DESC)` so legacy boards (default `position = 0.0`) fall back to newest-first within ties. `PUT /api/boards/order` with `{ ids: string[] }` renumbers all active boards sequentially (`1.0, 2.0, …`) in the given order — this is what the Home-page Shift+Arrow keyboard reorder uses. Archived boards are skipped. `#[serde(default)]` keeps legacy `board.json` files readable.
- Card `archived_at: Option<String>` — UTC timestamp set when the card is archived, cleared on restore. `#[serde(default, skip_serializing_if)]` for backward compatibility. `get_archived_cards` sorts descending by it (legacy cards without one fall back to `created_at`). Same field + behavior on `Board` (`list_archived_boards` sorts descending by it).
- Card `archived: bool` — soft delete. `get_board` filters out archived cards. `GET /api/boards/:id/archive` returns archived cards (from both list dirs and `archived_cards/`). `PUT /api/cards/:id` with `{ archived: false }` restores. Orphaned cards (from deleted lists, in `archived_cards/`) require `list_id` in the restore request to specify target list. `DELETE /api/cards/:id` permanently deletes (including attachment files).
- Card `due_date: Option<String>` — optional due date in `YYYY-MM-DD` ISO format (validated server-side, returns 400 on invalid format). `UpdateCard` uses double-Option (`Option<Option<String>>`) so `null` clears the date vs absent leaves it unchanged. Displayed as color-coded badge in list view (overdue/today/tomorrow/future).
- Card `checklist: Vec<ChecklistItem>` — single flat checklist per card, stored in card JSON (no separate file). Each item has `id` (UUID), `text`, `done: bool`. Vec order is display order. Uses `#[serde(default)]` so legacy cards deserialize with an empty checklist. Checklist is **card content**: it is persisted as part of the card Save via `PUT /api/cards/:id { checklist }` (no dedicated endpoints). `UpdateCard.checklist` is `Option<Vec<ChecklistItem>>` — `Some(vec)` replaces the whole list, absent leaves it unchanged. New item IDs are generated **client-side** (`crypto.randomUUID()`); the backend stores the array as-is.
- Card `attachments: Vec<Attachment>` — **NOT stored in card JSON**. Each attachment is a file trio in `data/boards/{bid}/attachments/{cid}/`: the binary `{att-id}` (no extension), an optional JPEG thumbnail `{att-id}_thumb` (images only, max 400px, via the `image` crate), and a metadata sidecar `{att-id}.json` (the `Attachment` record). The sidecar — not the card — is the source of truth, so attachment persistence is decoupled from the card record (additive writes don't conflict with concurrent card edits, and the dir travels with the card on cross-board moves). Card responses populate `attachments` from the sidecars via `attachments::load_attachments`; `store/cards.rs::write_card` strips the field before writing card JSON (via `mem::take`). Max 50 MB enforced in handler (`TooLarge` error → HTTP 413). Upload: `POST /api/cards/:id/attachments?filename=...` with raw body bytes (no multipart) — writes the binary, then thumbnail, then the sidecar **last** as the completeness marker. Download: `GET /api/cards/:id/attachments/:att_id`. Thumbnail: `GET /api/cards/:cid/attachments/:att_id/thumb`.
- Timestamps — `YYYY-MM-DD HH:MM:SS` UTC, generated in `store/io.rs` (no chrono crate).
- **Labels** — stored in `board.json` as a `labels: Vec<Label>` array. Each label has `id`, `name`, `color`. Colors are auto-assigned from a 12-color pastel palette (evenly distributed hues) in interleaved order for max visual distinction. `board.json` is read/written via the `pub(crate) BoardFile` struct in `store/boards.rs`; the public `Board` response type omits labels (labels only appear in `BoardDetail`). No separate labels file.

### File storage layout

```
data/boards/{board-id}/board.json
data/boards/{board-id}/lists/{list-id}/list.json
data/boards/{board-id}/lists/{list-id}/cards/{card-id}.json
data/boards/{board-id}/archived_cards/{card-id}.json
```

- Deleting a board: `remove_dir_all` on its directory (cascades lists + cards).
- Deleting a list: archives all cards in the list (moves them to `data/boards/{bid}/archived_cards/` with `archived: true`), then `remove_dir_all` on the list directory. Cleans up empty `lists/` dir. Frontend shows a confirmation dialog when deleting a list that contains cards.
- Moving a card between lists: write to new location, delete from old location.
- Attachments: `data/boards/{bid}/attachments/{cid}/{att-id}` (binary, no extension), `{att-id}_thumb` (thumbnail), `{att-id}.json` (metadata sidecar — the source of truth, NOT the card JSON). On a cross-board card move, `update_card` calls `attachments::move_card_attachments` to `fs::rename` the whole `{cid}/` dir to the target board.
- **Empty dir cleanup** — `remove_dir_if_empty()` in `store/io.rs` cleans up empty parent dirs after deletions: `attachments/{cid}/`, `attachments/`, `archived_cards/`, `lists/`. Tracked in file ops log.
- **Attachment reconcile/GC** — `store/gc.rs::reconcile()` runs once at startup (`lib.rs::reconcile_attachments`, called from both `run_server` and `run_desktop_server` before the HTTP server starts). It (1) migrates any pre-sidecar attachment metadata still embedded in card JSON into sidecar files then rewrites the card to drop it, (2) deletes attachment dirs whose card no longer exists on the board, and (3) deletes partial files (binary without sidecar, sidecar without binary, orphan thumbnail). Steps 2–3 only touch files older than a 5-minute `GRACE` window so an in-flight sync (attachment arriving before its card, or a half-transferred blob) isn't mistaken for garbage. File ops are logged via the audit trail.
- Finding a card/list requires scanning board directories (no index). Acceptable at MVP scale.

## API Endpoints

```
GET    /api/changes                          → { mtime: u64 } (newest file mtime, for poll efficiency)
GET    /api/warnings                          → { warnings: string[] } (data-integrity warnings: corrupt/unreadable files the walker skipped)
GET    /api/boards                           → Board[] (non-archived only)
GET    /api/boards/archive                   → Board[] (archived boards only)
POST   /api/boards          {title}          → Board (201)
GET    /api/boards/:id                       → BoardDetail (nested lists + cards + labels)
PUT    /api/boards/:id       {title?,color?,archived?} → Board
PUT    /api/boards/order     {ids: string[]} → 204 — renumber active boards 1.0, 2.0, … in given order
DELETE /api/boards/:id                       → 204 (must be archived first, else 400)

POST   /api/boards/:bid/labels  {name}       → Label (201) — auto-assigns pastel color
PUT    /api/labels/:id          {name}       → Label
DELETE /api/labels/:id                       → 204

POST   /api/boards/:bid/lists {title}        → List (201)
PUT    /api/lists/:id    {title?,pos?}       → List
DELETE /api/lists/:id                        → 204

GET    /api/boards/:bid/archive              → Card[] (archived cards, sorted by archival date desc)

POST   /api/lists/:lid/cards {title}         → Card (201)
PUT    /api/cards/:id  {title?,desc?,pos?,list_id?,label_ids?,archived?,due_date?,checklist?} → Card
DELETE /api/cards/:id                        → 204

POST   /api/cards/:cid/attachments?filename=… → Attachment (201) — raw body bytes, Content-Type header
GET    /api/cards/:cid/attachments/:att_id    → binary (Content-Disposition: attachment)
GET    /api/cards/:cid/attachments/:att_id/thumb → JPEG thumbnail (404 if not image)
DELETE /api/cards/:cid/attachments/:att_id    → 204
```

## Adding New Features

### New backend endpoint
1. Add request/response types to `models.rs`
2. Add store function in the appropriate `store/*.rs` submodule (and re-export from `store/mod.rs` if it should be part of the public API)
3. Add handler function in appropriate `handlers/*.rs`
4. Add route in `main.rs`
5. `cargo build` — zero warnings

### New frontend page
1. Create component in `pages/`
2. Add route in `index.tsx`
3. Add API function to `api.ts` if needed
4. Add types to `types.ts` if needed

### New frontend component
1. Create in `components/`
2. Add styles to `styles/app.css`
3. Import and use in parent component

### Modifying data model
1. Update `models.rs` (backend)
2. Update `types.ts` (frontend) — must stay in sync
3. Update read/write functions in the relevant `store/*.rs` submodule
4. Update `api.ts` if request/response shapes change
5. Existing data files may need migration — document breaking changes

## Common Pitfalls

- **Build order matters.** Frontend must build before backend. `build.sh` handles this. If building manually, run `pnpm run build` + copy dist to `backend/static/` before `cargo build`.
- **`backend/static/` must exist** for `cargo build` to succeed (even in dev). For dev builds, create an empty `backend/static/` with a dummy `index.html`.
- **SolidJS reactivity** — don't destructure props (breaks reactivity). Access as `props.foo`. Use `createMemo` for derived values.
- **Position gaps are fine.** Fractional indexing leaves gaps (1.0, 2.0, 1.5, 1.25...). This is by design. No need to normalize positions.
- **Corrupt files are skipped, not fatal.** Every walker/scan tolerates a single unreadable JSON file instead of `?`-propagating — one bad file (partial sync, manual edit) must not hide unrelated data. Covers `walk.rs` (`board_files`/`lists`/`read_cards_in`), attachment sidecars (`attachments::load_attachments`), the startup GC sweep (`gc::migrate_board`), and the board-scanning helpers (`labels::find_board_for_label`, `boards::reorder_boards`). Each skip records a helpful warning (relative path + remediation) via the shared `io::warn_skip` → `io::warn`/`drain_warnings` thread-local (mirrors `FILE_OPS`). `store::collect_warnings` re-walks the whole tree — boards, lists, cards, orphans, **and** attachment sidecars — and drives `GET /api/warnings`. Home + Board poll it (mount + each `changePoller` tick) and render `WarningBanner` (dismissible per warning-set). Single-item reads that own their record (`read_board_file`, `update_list`, `get_attachment_data`) still error for that one op — you can't render/edit a thing whose own file is unreadable. Skipped data stays on disk; it's only hidden until the file is readable.
- **Dead label IDs are pruned on save.** `delete_label` does not rewrite cards, so a card can keep a `label_id` that no longer exists on the board. The UI already filters chips to existing board labels (Card.tsx/CardLabelSection), and `cards::prune_label_ids` drops dangling IDs on **every** `update_card` write (against the card's board labels) so the stored set self-heals on the card's next save.
- **Card description** is a JSON string, not a JSON object. It's `JSON.stringify(prosemirrorDoc)` on save, `JSON.parse(description)` on load.
- **Dialog focus containment** — `focusTrap.ts` exports `focusTrap(root)`; every overlay dialog attaches it via `ref={(el) => onCleanup(focusTrap(el))}` (CardDetail `.modal-overlay`, `UnsavedDialog`, `ConfirmDialog`, `ShortcutHelp`, `ArchivePanel`, `ImagePreviewOverlay`). It guarantees keyboard focus never escapes an open dialog: (1) if the focused element disappears (inline confirmations, nested dialogs closing) or focus lands on `<body>`, focus is restored to the most recently focused element inside the root that still exists (tracked via `focusin` history; a `MutationObserver` catches removals because browsers don't reliably fire `focusout` when the focused element is removed); (2) `Tab`/`Shift+Tab` wrap at the dialog edges instead of escaping to the page behind. Nested traps compose — the inner dialog handles Tab first and outer handlers skip `defaultPrevented` events. **Overlay-layer stack** (`overlayLayers.ts`): a trap must also yield to overlays stacked *above* it that live *outside* its DOM subtree — e.g. the ProseMirror link dialog, which portals to `document.body`, or `ShortcutHelp`/`ConfirmDialog` rendered as Board-level siblings of an open `CardDetail`. Every `focusTrap` root and every portaled overlay (the link dialog) registers into a shared open-order stack via `registerOverlay`; `focusTrap`'s `restore()` bails when `focusInHigherLayer` reports that a later-opened layer holds focus, so the trap no longer reclaims focus from the dialog on top of it. As a defense-in-depth, Board.tsx's global Escape (which only fires when focus is outside the modal) dispatches a `request-card-close` `CustomEvent` instead of closing directly; CardDetail listens and routes it through the unsaved guard. Covered by `e2e/focus.spec.ts`.
- **Dialog keyboard ownership** — `dialogKeys.ts` exports `dialogKeys(handler)`: a document-level **capture** keydown listener with a stack (topmost dialog wins, nested dialogs compose). `UnsavedDialog`, `ConfirmDialog`, `ShortcutHelp`, and `ArchivePanel` register their owned keys (Escape/Enter/`?`/arrows) through it via `onCleanup(dialogKeys(...))`. Reason: dialogs auto-focus their default button on the next animation frame, so element-level keydown handlers (which need focus *inside* the overlay) have a one-frame window where a fast keypress still targets the element behind the overlay and gets swallowed — this caused a flaky double-Escape e2e failure on slow CI runners. Handlers must act only on keys they own and call `preventDefault()`/`stopPropagation()` on those; everything else propagates normally (focusTrap Tab wrap, button Enter activation, typing). `ConfirmDialog`/`ArchivePanel` keep a catch-all element-level `stopPropagation()` to shield page-global shortcuts while focus is inside. Regression-tested in `e2e/focus.spec.ts` by stubbing `requestAnimationFrame` to hold the pre-focus state deterministically.
- **Unsaved changes confirmation** — CardDetail modal shows a centered overlay dialog (`.unsaved-overlay` + `.unsaved-dialog`) with Save/Discard/Cancel when closing with dirty state. Save button is focused by default with a prominent focus ring. Enter executes whichever button is focused (Tab to move between buttons). Escape dismisses the dialog. All 4 close paths (ESC, overlay click, X button, Cancel) are guarded via `guardedClose()`.
- **Periodic polling** — Home and Board pages poll `GET /api/changes` every 15s via `startChangePoller` in `changePoller.ts`, which owns the protocol (interval, last-mtime memory, error swallowing). Pages pass policy only: Board selects its own board's per-board mtime (quiet boards don't refetch) and captures focus before refetch; Home skips ticks while a reorder is in flight (`shouldSkip`). Full refetch only happens when mtime changes. This efficiently reflects external file changes (rsync, git pull, Syncthing) without unnecessary data transfers. Covered by `changePoller.test.ts`.
- **Labels** — per-board colored tags. Stored in `board.json` (not separate files). Board labels flow down as `props.labels` through `BoardPage → List → Card`. `CardDetail` receives `boardLabels` and forwards them to `CardLabelSection` (assigned chips + picker). `onSave` callback signature includes `labelIds: string[]`. Label management UI is a **right-side slide-out drawer** rendered by `LabelDrawer.tsx` (`.label-drawer`, always rendered for CSS transition, toggled via `.label-drawer--open` class → `translateX(0)`). The "Labels" button lives in `.app-header-actions` (visible only on board pages). Label names support `**bold**` and `*italic*` markdown (rendered via `renderTitle()` from `Card.tsx`; `handleMarkdownShortcut` from `mdInput.ts` wraps the selection in the drawer inputs on Ctrl+B/I). Label colors use `color-mix()` for selected state in the label picker.
- **Header contexts** — two SolidJS contexts (split from the old `LabelContext`), both wrapped around the app in `App.tsx` via `LabelDrawerProvider` + `BoardHeaderProvider`. `LabelDrawerContext.tsx` (`useLabelDrawer`) owns the label-drawer open state (`{ isOpen, open, close, toggle }`). `BoardHeaderContext.tsx` (`useBoardHeader`) owns header board state (`{ isOnBoard, setIsOnBoard, title, setTitle, renaming, setRenaming, renameValue, setRenameValue }`). The `AppHeader` sub-component reads both to show/hide the Labels button and render the board title. `Board.tsx` sets `setIsOnBoard(true)` on mount, `false` on cleanup, and reactively `setTitle(board().title)`.
- **Keyboard navigation** — Cards have `tabindex="0"` and handle `↑↓` (move within list), `←→` (jump to adjacent list, index-aware: focuses the nth card in the adjacent list matching the current index, or the nearest card if the adjacent list is shorter), `Shift+↑↓` (reorder card in list), `Shift+←→` (move card to adjacent list, preserving index position — inserts at same position in target list rather than appending), `Enter`/`Space` (open card), `Delete`/`Backspace` (archive card with confirmation), `e` (edit focused card). When no card is focused, any arrow key focuses the first/last card in the board. Navigating `←→` to an empty list focuses the list's `.add-trigger` button. When `.add-trigger` (card list) is focused: `←→` navigates to adjacent list, `↑` focuses last card in current list, `Enter`/`Space` opens the add-card form. Focus style via `.card:focus` (uses `:focus` not `:focus-visible` for Safari/WebView compatibility). Shortcuts hidden by default — press `?` to toggle `ShortcutHelp` modal, or click the `?` button in the app header. The header `?` button dispatches a `toggle-shortcuts` `CustomEvent` on `document`; `Board.tsx` and `Home.tsx` listen for it in `onMount`. Global single-letter shortcuts are registered through `shortcutRouter.ts`'s `registerShortcuts()` (used by both `Board.tsx` and `Home.tsx`, gated by `isInInput`). Global shortcuts: `b` (back to boards overview), `l` (add list), `n`/`c` (add card to focused/first list), `e` (edit focused card), `g` (toggle label drawer), `f` (toggle filter bar), `a` (toggle archive panel), `?` (toggle help), `Escape` (close drawer/help/archive/CardDetail/rename, or unfocus card to board-page container). `Backspace` is suppressed (preventDefault) at the board-page level to prevent browser-back navigation. Home page: `n` (open new board form), `↑↓←→` (navigate between board cards, grid-aware), `Delete`/`Backspace` (archive focused board with confirmation), `a` (toggle archived boards panel), `?` (toggle help), `Escape` (close form, help, or archive panel). CardDetail: `Ctrl+S`/`Cmd+S` saves (NOT `Ctrl+Enter` — ProseMirror inserts a hard break on Ctrl+Enter, which would corrupt the description right before saving), `Escape` closes (with unsaved guard), title `Enter` focuses editor, `Ctrl+B`/`Ctrl+I` wraps selection in `**bold**`/`*italic*` markdown. Section-focus shortcuts use a Ctrl/Cmd modifier and fire regardless of focus (each `preventDefault`s the browser default): `Ctrl/Cmd+T` focuses title, `Ctrl/Cmd+L` opens label picker + focuses the add-label button, `Ctrl/Cmd+D` focuses description editor, `Ctrl/Cmd+C` focuses checklist add input, `Ctrl/Cmd+O` triggers the attachment file picker, `Ctrl/Cmd+U` focuses + opens (`showPicker()`) the due-date input. Non-modifier `f` toggles filter bar, `?` toggles shortcut help (suppressed when typing in input/editor). Drawer inputs: `Escape` closes the entire drawer. Attachments: `tabindex="0"`, `Delete`/`Backspace` removes, `Enter` previews (images) or downloads (other files). Archive modal (cards): `↑↓` navigates between archived card items (`tabindex="0"`, `.archive-card-item:focus` outline), `Escape` closes. Opening archive auto-focuses first item. Archive modal (boards): same `↑↓` navigation between `.archive-board-item` elements. Both archive modals auto-focus the first item on open (falls back to modal container via `tabindex="-1"`); overlays use `stopPropagation` on keydown so ESC is handled locally. Global ESC handlers also check `showArchive()` as fallback when focus is outside the overlay.
- **Card title markdown** — titles support `**text**` (bold) and `*text*` (italic). `renderTitle(title)` in `Card.tsx` converts to `<strong>`/`<em>` HTML and is used via `innerHTML` in both card list view and CardDetail. Stored as-is (markdown string) in the title field. The shared `handleMarkdownShortcut`/`wrapMarkdownSelection` helpers in `mdInput.ts` handle Ctrl+B/I on plain inputs (CardDetail title, label drawer inputs); they're covered by `mdInput.test.ts`.
- **`isInInput` guard** — `boardInput.ts` exports `isInInput(target)` which returns true if the event target is an INPUT, TEXTAREA, contentEditable element, or inside `.modal-overlay`, `.label-drawer`, `.shortcut-help-overlay`, `.archive-overlay`, or `.filter-bar`. All global keydown handlers check this before acting, so shortcuts don't fire while typing or when a dialog is open. Covered by `boardInput.test.ts`.
- **Focus restoration** — `Board.tsx` tracks `lastFocusedCardId` signal. Set on card click/keyboard open. Both `handleCardSave` and `handleModalClose` use the `pendingFocusCardId` mechanism (rather than an immediate `querySelector(...).focus()`) so that focus survives the resource refetch / DOM recreation that follows a save, and also any polling refetch that happens between closing the modal and the focus call. Both close paths `await refetch()` **before** unmounting the modal, so `board()` already reflects the modal's writes — an immediate re-open never snapshots a stale card (save/refetch race, regression-tested in `e2e/focus.spec.ts`). A `createEffect` watches the `board` resource and re-focuses `[data-card-id="..."]` after SolidJS finishes re-rendering. After `handleMoveCard`, the moved card's ID goes into `pendingFocusCardId` so cross-list moves keep focus on the card. During polling refetch, the currently focused card ID is also captured into `pendingFocusCardId` before `refetch()` so focus survives DOM recreation from auto-updates. After `handleAddCard`, the newly created card's ID is set as `pendingFocusCardId` so the card receives focus once it appears in the DOM. After archiving a card, the next sibling card (or previous if last) receives focus via `pendingFocusCardId`. The `.board-page` div has `tabindex="-1"` as a focus fallback — clicking empty board areas refocuses the last focused card or the board container, and Escape unfocuses a card by moving focus to the board container (not `<body>`).
- **ShortcutHelp** — `components/ShortcutHelp.tsx` renders a centered modal overlay with all shortcuts organized by section (Home, Navigation, Move Card, Cards, Board, Archive, Card Detail, Attachments, Global). Closes on `Escape`, `?`, or overlay click. Rendered via `<Show when={showHelp()}>` in both `Board.tsx` and `Home.tsx`.
- **Board color** — `Board` and `BoardDetail` have an optional `color` field (`Option<String>` in Rust, `color?: string` in TS). Set via `PUT /api/boards/:id` with `{ color }`. `Board.tsx` syncs the value to `--board-color` CSS custom property on `:root` via `createEffect`. CSS uses `linear-gradient(rgba(0,0,0,0.2), ...), var(--board-color)` for the header (dark overlay for readability) and `color-mix(in srgb, var(--board-color) 50%, white)` for the board page background (muted/pastel). `BoardColorPicker` is a native `<input type="color">` for free color selection (no presets) plus a "Reset to default" button. Its `onInput` calls `onPreview` (Board.tsx sets `--board-color` live, no API call) and `onChange` calls `onSelect` (commits via `PUT /api/boards/:id`); Reset commits `{ color: null }`. `onCleanup` resets `--board-color` to `#0079bf`. Home page board cards show their color as card background via inline style.
- **Board rename** — The board title is displayed in the app header (replacing "Synkban" when on a board page). Clicking the header board title replaces it with an inline `input.header-rename-input` in the header itself (not in the board-title-bar). Rename state (`renaming`, `renameValue`) lives in `BoardHeaderContext` so `App.tsx` can render the input. Blur or Enter dispatches a `"commit-board-rename"` `CustomEvent`; `Board.tsx` listens and calls `api.updateBoard`. Escape cancels. A back chevron (`<A href="/" class="app-logo-home">`) appears before the board title in the header for navigation to the home page. The board-title-bar only shows action buttons (filter, archive, color).
- **Archive (soft delete)** — Both boards and cards support archival. Cards: archive button (`.card-archive`) and `Delete`/`Backspace` key show a confirmation dialog before archiving. Archived cards filtered out by `get_board`. "Archive" button in board title bar (or `a` key) opens `.archive-modal-overlay` listing all archived cards with Restore and Delete. Archive items have `tabindex="0"` and support `↑↓` arrow key navigation. Delete shows inline "Delete permanently?" confirmation (Yes/No). Restore calls `api.restoreCard` → `PUT /api/cards/:id { archived: false, list_id? }`. Orphaned cards need `list_id`. Delete calls `api.deleteCard` → `DELETE /api/cards/:id` (permanent). API rejects deletion of non-archived cards (400). Backend uses `CardLocation` enum (`InList` vs `Orphaned`). Boards: the X button on home page board cards archives (with confirmation dialog). `DELETE /api/boards/:id` rejects non-archived boards (400). Home page always shows an "Archive" button in the header (with count when > 0); clicking it (or pressing `a`) opens an archived boards panel with Restore and Delete (permanent, with inline confirmation). `GET /api/boards/archive` returns archived boards. Home.tsx uses manual signals (`archivedBoards`/`archiveLoading`) instead of `createResource`. Both archive UIs are adapters of the shared `ArchivePanel` component (`components/ArchivePanel.tsx`), which owns the overlay + modal frame, loading/empty states, auto-focus of the first item once loading finishes (or the modal container if empty), `↑↓` roving focus (via `rovingFocus.ts`), the inline delete confirmation (Yes auto-focused), Escape-to-close, `stopPropagation` on keydown so ESC and arrow nav are handled locally, and focusTrap wiring; adapters supply only `renderItem`, `itemClass` (`archive-card-item` / `archive-board-item`) and the restore/delete handlers. The global ESC handler also checks `showArchive()` as fallback. After archiving a board, `archivedBoards` is always re-fetched (not just when panel is open).
- **List delete confirmation** — Deleting a list with cards shows a confirmation dialog (`.archive-overlay` + `.unsaved-dialog`). Confirming archives all cards to `archived_cards/` then removes list directory. Empty lists delete immediately without confirmation.
- **Attachments** — Files up to 50 MB. Upload via `POST /api/cards/:id/attachments?filename=...` with raw body (no multipart). Backend stores binary at `data/boards/{bid}/attachments/{cid}/{att-id}` with metadata in a sidecar `{att-id}.json` (NOT in card JSON — see data model). `AttachmentsSection.tsx` renders the list + upload button; the image preview overlay (`ImagePreviewOverlay.tsx`) is rendered by `CardDetail` so it can intercept Escape (closes preview only, not the whole modal). Local `attachments` signal in `CardDetail` keeps UI in sync without refetch. `api.uploadAttachment` uses a raw `fetch` (bypasses the JSON helper) with the file as body; `api.getAttachmentUrl` returns a direct URL for `<a download>` links. Image attachments (`content_type` starting with `image/`) show inline thumbnails; clicking thumbnail or filename invokes `onPreview` which the parent uses to render `ImagePreviewOverlay`. **Drag & drop upload** — when CardDetail modal is open, dragging files anywhere onto the modal triggers upload. Uses `dragenter`/`dragleave`/`drop` on `.modal-overlay` with a `dragCounter` to handle nested element events. Visual feedback: `.modal-overlay--drop-active` adds a dashed outline on `.modal-content`, and a `.drop-zone-overlay` with icon + "Drop files to attach" message appears. Supports multiple files dropped at once.
- **CardDetail label UX** — Labels section is **always rendered** in the detail modal (even when the board has zero labels), so the "+ Add label" button and `Ctrl/Cmd+L` shortcut are always reachable. Only assigned labels shown as chips; each has a small × button for removal. The "+ Add label" button toggles an inline picker showing all board labels with checkmarks. Picker hidden by default to reduce noise. `Ctrl/Cmd+L` opens the picker and focuses the add-label button. Inside the open picker, a `.label-create-toggle` button ("+ Create label", mirroring "+ Add label") reveals the `.label-create` form (text input + Create button) for defining a new label inline — the form is **hidden by default** (local `showCreate` signal, false) so opening the picker only shows the existing-label grid, not a text input. `showCreate` resets to false whenever the picker closes (`createEffect` on `props.pickerOpen`), so every card (and every reopen) starts collapsed. The form also collapses back to the toggle when it loses focus but stays in the picker (e.g. clicking a label in the grid) — `handleCreateFocusOut` on the form mirrors the area-level `handleFocusOut` (microtask + `document.activeElement` guard) and clears `newName`. Clicking the toggle focuses the input **synchronously** (not via `requestAnimationFrame`) so the focus lands before the `onFocusOut` microtask fires — the toggle button is removed from the DOM on the same click, and a deferred focus would lose the race and let `handleFocusOut` close the whole picker. Creating: `CardLabelSection` calls `props.onCreateLabel(name)` → `CardDetail.createLabel` → `Board.handleCreateLabel` (`api.createLabel` + `refetch`, returns the new `Label`), then the new label's id is added to `selectedLabelIds` (auto-assigned to the card, marks dirty). The create input supports `**bold**`/`*italic*` via `handleMarkdownShortcut`. Works even when the board has zero labels (no separate empty-state hint anymore). The picker (and thus the inline create form) closes after a label is created — focus returns to the "Add label" button (`addBtnRef`) — or when focus leaves the whole `.label-assigned-area` (an `onFocusOut` handler confirms via `document.activeElement` on the next microtask, since `relatedTarget` is unreliable for clicks on non-focusable regions); `onClosePicker` drives the close. Covered by `e2e/board.spec.ts`.
- **Board filtering** — "Filter" button in board title bar (or `f` key) toggles a filter bar below the title bar. Button highlights when filter bar is open or filters are active. The UI lives in `FilterBar.tsx`; filter state (`showFilterBar`, `filterText`, `filterLabelIds`) stays in `Board.tsx`. Text input filters cards by title, description (plain-text `description_text`), and checklist item text. Label chips filter by label (multi-select, AND with text filter: card matches if it has at least one selected label). Inline × button in input clears all filters. `cardMatchesFilter()` in `filter.ts` returns true when (no text OR title/description/checklist contains text) AND (no label filter OR card has at least one filtered label). `.filter-bar` is included in `isInInput()` guard so board shortcuts don't fire while typing in filter input.
- **Checklist** — `ChecklistSection.tsx` in the CardDetail modal (between description and attachments). Single flat checklist per card. Checklist is **card content**: edits mutate the local `checklist` signal in `CardDetail`, feed the `dirty` memo (serialized-state comparison against the original), and persist **only on card Save** (`onSave` carries the `checklist` array → `Board.handleCardSave` → `api.updateCard({ checklist })`). Closing without saving discards checklist edits via the unsaved guard, exactly like title/description. New item IDs are minted client-side with `crypto.randomUUID()`. There are **no dedicated checklist endpoints** and **no mutation queue** — Save is one atomic write of the whole card file. Items: checkbox + text (click or Enter to inline-edit, Enter/blur commits, Escape cancels) + × delete button. Deleting (× button or `Delete`/`Backspace`) shows an inline "Delete?" Yes/No confirmation in the row (`.checklist-confirm`, Yes auto-focused so Enter confirms, Escape/No cancels and refocuses the item) — same pattern as the archive modals. Header shows `done/total` progress pill (green via `.checklist-progress--complete` when complete) and a "Check all"/"Uncheck all" button (toggles `done` on every item in the local signal). Add input at the bottom keeps focus after Enter for rapid entry. Keyboard: items have `tabindex="0"`, `↑↓` navigate, `Space` toggles done, `Enter` edits, `Shift+↑↓` reorders (focus follows the item), `Delete`/`Backspace` asks then removes (focus moves to neighbor); `Ctrl/Cmd+C` in CardDetail focuses the add input. Reorder moves the item within the local array (`handleMoveChecklistItem`). Items are also reorderable via native HTML5 drag & drop: rows are `draggable` (except while editing), `.checklist-item--dragging` dims the source, `.checklist-item--drop-before/--drop-after` draw the insertion line; the item drop event must bubble to the modal overlay so its file-drop counter resets (overlay drop ignores non-file drops). Items render via `<Index>` (not `<For>`) so a local toggle updates the row in place — `<For>` would re-create the DOM node and drop focus for a frame, losing keys typed right after Space. Edit/delete focus moves use rAF + `[data-checklist-item-id]` lookup. The card list view shows a `done/total` badge (`.checklist-badge`, green `--complete` pill when all done). `Board.tsx` refetches on modal close so badges reflect a Save without waiting for the poll.
- **Due dates in CardDetail** — ISO text input (`YYYY-MM-DD`, monospace font, pattern-validated) with a calendar button that opens the native date picker via `showPicker()`. Clear button to unset. `Ctrl/Cmd+U` focuses the date input and opens the picker. `onSave` callback includes `dueDate: string | null` parameter.
- **Card layout** — `.card-main` wrapper (flex-column) contains `.card-content`. Inside `.card-content`: title first, then `.card-labels` (label chips), then `.card-badges` (due date, description, checklist, attachments). `.card-actions` remains as a flex-row sibling to `.card-main`.

## Dependencies

### Backend (Cargo.toml)
- `actix-web` — HTTP framework
- `actix-cors` — CORS middleware
- `serde` / `serde_json` — serialization
- `uuid` — ID generation
- `tokio` — async runtime (rt-multi-thread + macros only)
- `include_dir` — embed static files in binary
- `mime_guess` — MIME type detection for static files
- `image` — server-side thumbnail generation for image attachments

### Desktop shell (`electron/package.json`)
- `electron` v34 — Chromium-based desktop window
- `electron-builder` v25 — cross-platform packaging (bundles Rust binary as extraResource)

### Frontend (package.json)
- `solid-js` + `@solidjs/router` — UI framework + routing
- `prosemirror-*` (13 packages) — rich text editor
- `vite` + `vite-plugin-solid` + `typescript` — build tooling (devDependencies)

## Docker

Multi-stage Dockerfile:
1. `node:22-bookworm-slim` — frontend build
2. `rust:1.95-bookworm` — backend build (with frontend assets in `static/`)
3. `debian:bookworm-slim` — runtime (just the binary)

Persistent data: mount volume at `/app/data`.

## Release CI (GitHub Actions)

`.github/workflows/release.yml` builds the Electron desktop app for macOS, Linux, and Windows and publishes a GitHub Release whenever a tag matching `v*` is pushed. Workflow can also be run manually via `workflow_dispatch` (artifacts are uploaded but no Release is created unless the run was triggered by a tag).

- **Matrix** — `macos-latest`, `ubuntu-latest`, `windows-latest`. Each runner runs `./build.sh --desktop`. Linux job installs `libgtk-3-dev libxss1 libnss3` first; Windows uses Git Bash via `shell: bash`. Cargo registry + target dir are cached per-OS keyed on `Cargo.lock` + `backend/src/**`.
- **electron-builder targets** — declared in `electron/package.json` per-platform: macOS `dmg` + `zip` (explicitly `arm64` / `aarch64` only), Linux `AppImage` + `deb`, Windows `nsis`. `extraResources` is now per-platform too because the Windows binary is `synkban.exe`. `CSC_IDENTITY_AUTO_DISCOVERY=false` is set in the job env so unsigned builds work without an installed cert.
- **Release job** — depends on the build matrix, runs only when the trigger is a tag, downloads all artifacts and creates a GitHub Release via `softprops/action-gh-release@v2` with auto-generated notes.
- **Cutting a release** — `git tag v0.2.0 && git push origin v0.2.0`. The workflow builds all three OSes in parallel and attaches the installers/zips to a new Release at that tag.

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
