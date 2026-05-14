# Agent Instructions — Synkban

## Project Overview

Local-first, syncable kanban board. Rust backend (Actix Web), SolidJS frontend, file-based JSON storage. Single binary with embedded frontend. Optional Tauri v2 desktop mode wraps the web UI in a native window.

## Build & Run

```bash
# Full production build (frontend first, then backend with embedded assets)
./build.sh

# Run
./backend/target/release/synkban
# → http://localhost:8080

# Desktop mode build (native window via Tauri v2)
./build.sh --desktop
./backend/target/release/synkban --desktop

# Development (two terminals)
cd backend && cargo run          # :8080
cd frontend && npm run dev       # :3000 (proxies /api → :8080)
```

## Verify Changes

After any code change:

1. **Backend changes:** `cd backend && cargo build` — must compile with zero warnings
2. **Frontend changes:** `cd frontend && npx vite build` — must build cleanly
3. **Full build:** `./build.sh` — frontend must build before backend (assets embedded at compile time)
4. **Smoke test:** Start server, `curl http://localhost:8080/api/boards` should return `[]` on fresh data dir
5. **Desktop build:** `cd backend && cargo build --features desktop` — must compile (requires system WebView libs)

## Desktop Mode

The `desktop` Cargo feature enables Tauri v2 desktop mode. When built with `--features desktop` and run with `--desktop`, the binary starts the backend server on a random free port (localhost-only), generates a one-time token for access control, and opens a native WebView window pointing to `http://127.0.0.1:PORT/?token=SECRET`.

- `./build.sh` — web-only build (default, no Tauri dependency)
- `./build.sh --desktop` — builds with Tauri v2 desktop support; on macOS also creates `Synkban.app` bundle
- `./backend/target/release/synkban` — web server mode (unchanged)
- `./backend/target/release/synkban --desktop` — desktop mode (native window)
- `open backend/target/release/Synkban.app` — launch macOS app (double-clickable, auto-passes `--desktop`)

### System Dependencies for Desktop Build

- **macOS:** Xcode Command Line Tools
- **Linux:** `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `libssl-dev`
- **Windows:** WebView2 runtime (pre-installed on Windows 10+), Visual Studio Build Tools

### Desktop Architecture

- `lib.rs` exposes `run_server` (web mode) and `run_desktop_server` (desktop mode with token middleware + random port); `main.rs` is a thin CLI entry point
- `desktop.rs` (cfg-gated behind `desktop` feature) creates a Tauri webview window pointing to the backend
- **Token protection** — desktop mode generates a UUID token per launch. Actix middleware (`wrap_fn`) checks every request for a `synkban_token` cookie or `?token=` query param. Initial page load sets the cookie via query param; subsequent same-origin requests include the cookie automatically. Other local apps cannot access the UI.
- **Random port** — desktop server binds to `127.0.0.1:0` (OS assigns free port). Port communicated to main thread via `mpsc` channel. Server readiness confirmed by actual HTTP request (not just TCP connect).
- No Tauri IPC — all communication is HTTP via the embedded Actix server
- No `@tauri-apps/cli` or `@tauri-apps/api` npm packages — frontend is unchanged
- `tauri.conf.json` and `capabilities/` in `backend/` — Tauri v2 config and permissions. `build` section is empty (no `frontendDist`) since the Tauri webview loads from the backend's HTTP server via External URL.
- `build.rs` conditionally calls `tauri_build::build()` when the `desktop` feature is enabled
- **macOS app bundle** — `build.sh --desktop` creates `Synkban.app` with proper icon (`.icns`), `Info.plist`, and a launcher script that auto-passes `--desktop`. Icon is a kanban board design generated from `icons/icon.png` (1024x1024).
- `Info.plist` in `backend/` — macOS bundle metadata (name, identifier, icon, version)

## Architecture Rules

### Backend (`backend/src/`)

- **No database.** Storage is JSON files via `store.rs`. Never add SQLite, Postgres, or any DB dependency.
- **`store.rs`** is the only file that touches the filesystem for data. All handlers call `store::*` functions.
- **Handlers** are thin — extract params, call store, return JSON. No business logic in handlers. All mutating handlers (create/update/delete) log to stdout with action summary + explicit file list. `store.rs` tracks every file write/delete via thread-local `FILE_OPS`; handlers drain via `store::drain_file_ops(&data_dir)` after each store call. Format: `[HH:MM:SS] ACTION entity "name" (id: ...)` header, then indented lines like `wrote boards/{bid}/board.json` or `deleted dir boards/{bid}/lists/{lid}`. Timestamp from `log_timestamp()` in `lib.rs` (UTC HH:MM:SS).
- **Models** in `models.rs` — all data types and request/response DTOs live here.
- **Errors** in `errors.rs` — `AppError` enum, implements `ResponseError`. Four variants: `NotFound`, `Io`, `TooLarge` (HTTP 413, attachment size), `BadRequest` (HTTP 400, validation errors like invalid date format).
- **Static files** embedded via `include_dir!("$CARGO_MANIFEST_DIR/static")`. The `backend/static/` directory must exist at compile time (created by `build.sh`).
- **No auth.** Single-user MVP. Don't add auth unless explicitly asked.

### Frontend (`frontend/src/`)

- **SolidJS** — not React. No virtual DOM. Use `createSignal`, `createResource`, `Show`, `For`. Never use React patterns (useState, useEffect, etc.).
- **Router:** `@solidjs/router` — routes in `index.tsx`, pages in `pages/`.
- **API client:** `api.ts` — all backend calls go through this module. Typed fetch wrapper.
- **Types:** `types.ts` — TypeScript interfaces matching backend models. Keep in sync with `models.rs`.
- **ProseMirror** for rich text in card descriptions. Schema includes basic nodes + lists, but `image` and `horizontal_rule` nodes are removed (not insertable). The "Insert" dropdown is excluded from the menu. Editor menu uses a prosemirror-menu `Dropdown` labeled "Type" containing Plain, Code, H1, H2, H3. Styled with border, background, rounded dropdown menu. Links use a custom dialog (not the default `openPrompt`) with proper z-index, single URL field, pre-fill from selected URL text. Description stored as ProseMirror JSON string. No raw HTML ever.
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
- Card `archived: bool` — soft delete. `get_board` filters out archived cards. `GET /api/boards/:id/archive` returns archived cards (from both list dirs and `archived_cards/`). `PUT /api/cards/:id` with `{ archived: false }` restores. Orphaned cards (from deleted lists, in `archived_cards/`) require `list_id` in the restore request to specify target list. `DELETE /api/cards/:id` permanently deletes (including attachment files).
- Card `due_date: Option<String>` — optional due date in `YYYY-MM-DD` ISO format (validated server-side, returns 400 on invalid format). `UpdateCard` uses double-Option (`Option<Option<String>>`) so `null` clears the date vs absent leaves it unchanged. Displayed as color-coded badge in list view (overdue/today/tomorrow/future).
- Card `attachments: Vec<Attachment>` — stored in card JSON. Binary data at `data/boards/{bid}/attachments/{cid}/{att-id}`. Max 50 MB enforced in handler (`TooLarge` error → HTTP 413). Upload: `POST /api/cards/:id/attachments?filename=...` with raw body bytes (no multipart). Download: `GET /api/cards/:id/attachments/:att_id`. Image attachments get a JPEG thumbnail (`{att-id}_thumb`, max 400px) generated server-side via the `image` crate. Thumbnail served at `GET /api/cards/:cid/attachments/:att_id/thumb`.
- Timestamps — `YYYY-MM-DD HH:MM:SS` UTC, generated in `store.rs` (no chrono crate).
- **Labels** — stored in `board.json` as a `labels: Vec<Label>` array. Each label has `id`, `name`, `color`. Colors are auto-assigned from a 12-color pastel palette (evenly distributed hues) in interleaved order for max visual distinction. `board.json` is read/written via the private `BoardFile` struct in `store.rs`; the public `Board` response type omits labels (labels only appear in `BoardDetail`). No separate labels file.

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
- Attachment binaries: `data/boards/{bid}/attachments/{cid}/{att-id}` (no extension). Thumbnails at `{att-id}_thumb`. Metadata lives in card JSON.
- **Empty dir cleanup** — `remove_dir_if_empty()` in `store.rs` cleans up empty parent dirs after deletions: `attachments/{cid}/`, `attachments/`, `archived_cards/`, `lists/`. Tracked in file ops log.
- Finding a card/list requires scanning board directories (no index). Acceptable at MVP scale.

## API Endpoints

```
GET    /api/changes                          → { mtime: u64 } (newest file mtime, for poll efficiency)
GET    /api/boards                           → Board[] (non-archived only)
GET    /api/boards/archive                   → Board[] (archived boards only)
POST   /api/boards          {title}          → Board (201)
GET    /api/boards/:id                       → BoardDetail (nested lists + cards + labels)
PUT    /api/boards/:id       {title?,color?,archived?} → Board
DELETE /api/boards/:id                       → 204 (must be archived first, else 400)

POST   /api/boards/:bid/labels  {name}       → Label (201) — auto-assigns pastel color
PUT    /api/labels/:id          {name}       → Label
DELETE /api/labels/:id                       → 204

POST   /api/boards/:bid/lists {title}        → List (201)
PUT    /api/lists/:id    {title?,pos?}       → List
DELETE /api/lists/:id                        → 204

GET    /api/boards/:bid/archive              → Card[] (archived cards, sorted by created_at desc)

POST   /api/lists/:lid/cards {title}         → Card (201)
PUT    /api/cards/:id  {title?,desc?,pos?,list_id?,label_ids?,archived?,due_date?} → Card
DELETE /api/cards/:id                        → 204

POST   /api/cards/:cid/attachments?filename=… → Attachment (201) — raw body bytes, Content-Type header
GET    /api/cards/:cid/attachments/:att_id    → binary (Content-Disposition: attachment)
GET    /api/cards/:cid/attachments/:att_id/thumb → JPEG thumbnail (404 if not image)
DELETE /api/cards/:cid/attachments/:att_id    → 204
```

## Adding New Features

### New backend endpoint
1. Add request/response types to `models.rs`
2. Add store function to `store.rs`
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
3. Update `store.rs` read/write functions
4. Update `api.ts` if request/response shapes change
5. Existing data files may need migration — document breaking changes

## Common Pitfalls

- **Build order matters.** Frontend must build before backend. `build.sh` handles this. If building manually, run `npm run build` + copy dist to `backend/static/` before `cargo build`.
- **`backend/static/` must exist** for `cargo build` to succeed (even in dev). For dev builds, create an empty `backend/static/` with a dummy `index.html`.
- **SolidJS reactivity** — don't destructure props (breaks reactivity). Access as `props.foo`. Use `createMemo` for derived values.
- **Position gaps are fine.** Fractional indexing leaves gaps (1.0, 2.0, 1.5, 1.25...). This is by design. No need to normalize positions.
- **Card description** is a JSON string, not a JSON object. It's `JSON.stringify(prosemirrorDoc)` on save, `JSON.parse(description)` on load.
- **Unsaved changes confirmation** — CardDetail modal shows a centered overlay dialog (`.unsaved-overlay` + `.unsaved-dialog`) with Save/Discard/Cancel when closing with dirty state. Save button is focused by default with a prominent focus ring. Enter executes whichever button is focused (Tab to move between buttons). Escape dismisses the dialog. All 4 close paths (ESC, overlay click, X button, Cancel) are guarded via `guardedClose()`.
- **Periodic polling** — Home and Board pages poll `GET /api/changes` every 15s, which returns the newest file mtime from the data directory (cheap stat walk, no JSON parsing). Full refetch only happens when mtime changes. This efficiently reflects external file changes (rsync, git pull, Syncthing) without unnecessary data transfers.
- **Labels** — per-board colored tags. Stored in `board.json` (not separate files). Board labels flow down as `props.labels` through `BoardPage → List → Card`. CardDetail receives `boardLabels` prop and manages `selectedLabelIds` signal. `onSave` callback signature includes `labelIds: string[]`. Label management UI is a **right-side slide-out drawer** (`.label-drawer`, always rendered for CSS transition, toggled via `.label-drawer--open` class → `translateX(0)`). The "Labels" button lives in `.app-header-actions` (visible only on board pages). Label names support `**bold**` and `*italic*` markdown (rendered via `renderTitle()` from `Card.tsx`; Ctrl+B/I wraps selection in the drawer inputs). Label colors use `color-mix()` for selected state in the label picker.
- **LabelContext** — `LabelContext.tsx` exposes `{ isOpen, open, close, toggle, hasBoard, setHasBoard, boardTitle, setBoardTitle, renaming, setRenaming, renameValue, setRenameValue }` via SolidJS context. `App.tsx` wraps everything in `LabelProvider`. The `AppHeader` sub-component in `App.tsx` reads context to show/hide the Labels button and display the board title in the header. `Board.tsx` calls `lc.setHasBoard(true)` on mount and `lc.setHasBoard(false)` on cleanup. `Board.tsx` reactively sets `lc.setBoardTitle(board().title)` so the header always reflects the current board name.
- **Keyboard navigation** — Cards have `tabindex="0"` and handle `↑↓` (move within list), `←→` (jump to adjacent list, index-aware: focuses the nth card in the adjacent list matching the current index, or the nearest card if the adjacent list is shorter), `Shift+↑↓` (reorder card in list), `Shift+←→` (move card to adjacent list, preserving index position — inserts at same position in target list rather than appending), `Enter`/`Space` (open card), `Delete`/`Backspace` (archive card with confirmation), `e` (edit focused card). When no card is focused, any arrow key focuses the first/last card in the board. Navigating `←→` to an empty list focuses the list's `.add-trigger` button. When `.add-trigger` (card list) is focused: `←→` navigates to adjacent list, `↑` focuses last card in current list, `Enter`/`Space` opens the add-card form. Focus style via `.card:focus` (uses `:focus` not `:focus-visible` for Safari/WebView compatibility). Shortcuts hidden by default — press `?` to toggle `ShortcutHelp` modal, or click the `?` button in the app header. The header `?` button dispatches a `toggle-shortcuts` `CustomEvent` on `document`; `Board.tsx` and `Home.tsx` listen for it in `onMount`. Global shortcuts: `b` (back to boards overview), `l` (add list), `n`/`c` (add card to focused/first list), `e` (edit focused card), `g` (toggle label drawer), `f` (toggle filter bar), `a` (toggle archive panel), `?` (toggle help), `Escape` (close drawer/help/archive/CardDetail/rename, or unfocus card to board-page container). `Backspace` is suppressed (preventDefault) at the board-page level to prevent browser-back navigation. Home page: `n` (open new board form), `↑↓←→` (navigate between board cards, grid-aware), `Delete`/`Backspace` (archive focused board with confirmation), `a` (toggle archived boards panel), `?` (toggle help), `Escape` (close form, help, or archive panel). CardDetail: `Ctrl+Enter` saves, `Escape` closes (with unsaved guard), `Ctrl+Shift` toggles focus between title input and rich text editor, title `Enter` focuses editor, `Ctrl+B`/`Ctrl+I` wraps selection in `**bold**`/`*italic*` markdown, `l` toggles label picker, `d` focuses due date input, `f` toggles filter bar, `?` toggles shortcut help. Single-letter shortcuts suppressed when typing in input/editor. Drawer inputs: `Escape` closes the entire drawer. Attachments: `tabindex="0"`, `Delete`/`Backspace` removes, `Enter` previews (images) or downloads (other files). Archive modal (cards): `↑↓` navigates between archived card items (`tabindex="0"`, `.archive-card-item:focus` outline), `Escape` closes. Opening archive auto-focuses first item. Archive modal (boards): same `↑↓` navigation between `.archive-board-item` elements. Both archive modals auto-focus the first item on open (falls back to modal container via `tabindex="-1"`); overlays use `stopPropagation` on keydown so ESC is handled locally. Global ESC handlers also check `showArchive()` as fallback when focus is outside the overlay.
- **Card title markdown** — titles support `**text**` (bold) and `*text*` (italic). `renderTitle(title)` in `Card.tsx` converts to `<strong>`/`<em>` HTML and is used via `innerHTML` in both card list view and CardDetail. Stored as-is (markdown string) in the title field. Ctrl+B/I in the title input in CardDetail wraps the selected text.
- **`isInInput` guard** — `Board.tsx` defines `isInInput(target)` that returns true if the event target is an INPUT, TEXTAREA, contentEditable element, or inside `.modal-overlay`, `.label-drawer`, `.shortcut-help-overlay`, `.archive-overlay`, or `.filter-bar`. All global keydown handlers check this before acting, so shortcuts don't fire while typing or when a dialog is open.
- **Focus restoration** — `Board.tsx` tracks `lastFocusedCardId` signal. Set on card click/keyboard open. After modal closes (`handleCardSave`, `handleModalClose`), `restoreFocus()` uses `requestAnimationFrame` to `querySelector('[data-card-id="..."]').focus()`. Ensures keyboard user returns to the card they were on. After `handleMoveCard`, a `pendingFocusCardId` signal is set; a `createEffect` watches the `board` resource and restores focus after SolidJS finishes re-rendering — this ensures focus works for cross-list moves where the card element is destroyed and recreated. During polling refetch, the currently focused card ID is also captured into `pendingFocusCardId` before `refetch()` so focus survives DOM recreation from auto-updates. After `handleAddCard`, the newly created card's ID is set as `pendingFocusCardId` so the card receives focus once it appears in the DOM. The `.board-page` div has `tabindex="-1"` as a focus fallback — clicking empty board areas refocuses the last focused card or the board container, and Escape unfocuses a card by moving focus to the board container (not `<body>`).
- **ShortcutHelp** — `components/ShortcutHelp.tsx` renders a centered modal overlay with all shortcuts organized by section (Home, Navigation, Move Card, Cards, Board, Archive, Card Detail, Attachments, Global). Closes on `Escape`, `?`, or overlay click. Rendered via `<Show when={showHelp()}>` in both `Board.tsx` and `Home.tsx`.
- **Board color** — `Board` and `BoardDetail` have an optional `color` field (`Option<String>` in Rust, `color?: string` in TS). Set via `PUT /api/boards/:id` with `{ color }`. `Board.tsx` syncs the value to `--board-color` CSS custom property on `:root` via `createEffect`. CSS uses `linear-gradient(rgba(0,0,0,0.2), ...), var(--board-color)` for the header (dark overlay for readability) and `color-mix(in srgb, var(--board-color) 50%, white)` for the board page background (muted/pastel). Color picker shows 16 preset swatches. `onCleanup` resets `--board-color` to `#0079bf`. Home page board cards show their color as card background via inline style.
- **Board rename** — The board title is displayed in the app header (replacing "Synkban" when on a board page). Clicking the header board title replaces it with an inline `input.header-rename-input` in the header itself (not in the board-title-bar). Rename state (`renaming`, `renameValue`) lives in `LabelContext` so `App.tsx` can render the input. Blur or Enter dispatches a `"commit-board-rename"` `CustomEvent`; `Board.tsx` listens and calls `api.updateBoard`. Escape cancels. A back chevron (`<A href="/" class="app-logo-home">`) appears before the board title in the header for navigation to the home page. The board-title-bar only shows action buttons (filter, archive, color).
- **Archive (soft delete)** — Both boards and cards support archival. Cards: archive button (`.card-archive`) and `Delete`/`Backspace` key show a confirmation dialog before archiving. Archived cards filtered out by `get_board`. "Archive" button in board title bar (or `a` key) opens `.archive-modal-overlay` listing all archived cards with Restore and Delete. Archive items have `tabindex="0"` and support `↑↓` arrow key navigation. Delete shows inline "Delete permanently?" confirmation (Yes/No). Restore calls `api.restoreCard` → `PUT /api/cards/:id { archived: false, list_id? }`. Orphaned cards need `list_id`. Delete calls `api.deleteCard` → `DELETE /api/cards/:id` (permanent). API rejects deletion of non-archived cards (400). Backend uses `CardLocation` enum (`InList` vs `Orphaned`). Boards: the X button on home page board cards archives (with confirmation dialog). `DELETE /api/boards/:id` rejects non-archived boards (400). Home page always shows an "Archive" button in the header (with count when > 0); clicking it (or pressing `a`) opens an archived boards panel with Restore and Delete (permanent, with inline confirmation). `GET /api/boards/archive` returns archived boards. Home.tsx uses manual signals (`archivedBoards`/`archiveLoading`) instead of `createResource` — `openArchive()` awaits `api.listArchivedBoards()` before rendering, showing a loading state, and auto-focuses the first item (or the modal container if empty). Archive overlay uses `stopPropagation` on keydown so ESC and arrow nav are handled locally; the global ESC handler also checks `showArchive()` as fallback. After archiving a board, `archivedBoards` is always re-fetched (not just when panel is open).
- **List delete confirmation** — Deleting a list with cards shows a confirmation dialog (`.archive-overlay` + `.unsaved-dialog`). Confirming archives all cards to `archived_cards/` then removes list directory. Empty lists delete immediately without confirmation.
- **Attachments** — Files up to 50 MB. Upload via `POST /api/cards/:id/attachments?filename=...` with raw body (no multipart). Backend stores binary at `data/boards/{bid}/attachments/{cid}/{att-id}`, metadata in card JSON. `CardDetail` shows an attachments section with download links and delete buttons. Local `attachments` signal keeps UI in sync without refetch. `api.uploadAttachment` uses a raw `fetch` (bypasses the JSON helper) with the file as body; `api.getAttachmentUrl` returns a direct URL for `<a download>` links. Image attachments (`content_type` starting with `image/`) show inline thumbnails; clicking thumbnail or filename opens a lightbox preview (`.image-preview-overlay`, z-index 300) with download button. Escape closes preview without closing CardDetail. **Drag & drop upload** — when CardDetail modal is open, dragging files anywhere onto the modal triggers upload. Uses `dragenter`/`dragleave`/`drop` on `.modal-overlay` with a `dragCounter` to handle nested element events. Visual feedback: `.modal-overlay--drop-active` adds a dashed outline on `.modal-content`, and a `.drop-zone-overlay` with icon + "Drop files to attach" message appears. Supports multiple files dropped at once.
- **CardDetail label UX** — only assigned labels shown as chips in the detail modal. Chips are display-only (no click-to-remove); each has a small × button for removal. A "+ Add label" button toggles an inline picker showing all board labels with checkmarks. Picker hidden by default to reduce noise. `l` key toggles picker when not in an input/editor.
- **Board filtering** — "Filter" button in board title bar (or `f` key) toggles a filter bar below the title bar. Button highlights when filter bar is open or filters are active. Text input filters cards by title and description (raw JSON string match). Label chips filter by label (multi-select, AND with text filter: card matches if it has at least one selected label). Inline × button in input clears all filters. Filter state: `showFilterBar`, `filterText`, `filterLabelIds` signals in `Board.tsx`. `cardMatchesFilter()` returns true when (no text OR title/description contains text) AND (no label filter OR card has at least one filtered label). `.filter-bar` is included in `isInInput()` guard so board shortcuts don't fire while typing in filter input.
- **Due dates in CardDetail** — ISO text input (`YYYY-MM-DD`, monospace font, pattern-validated) with a calendar button that opens the native date picker via `showPicker()`. Clear button to unset. `d` key focuses the date input. `onSave` callback includes `dueDate: string | null` parameter.
- **Card layout** — `.card-main` wrapper (flex-column) contains `.card-labels` above `.card-content`, so labels never shrink the title. `.card-actions` remains as a flex-row sibling to `.card-main`.

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

### Desktop-only (optional, behind `desktop` Cargo feature)
- `tauri` v2 — native WebView window
- `tauri-build` v2 — build-time code generation (build-dep)

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
