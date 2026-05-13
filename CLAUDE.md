# Agent Instructions — Trello Clone (tc)

## Project Overview

Trello-like kanban board. Rust backend (Actix Web), SolidJS frontend, file-based JSON storage. Single binary with embedded frontend.

## Build & Run

```bash
# Full production build (frontend first, then backend with embedded assets)
./build.sh

# Run
./backend/target/release/tc-backend
# → http://localhost:8080

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

## Architecture Rules

### Backend (`backend/src/`)

- **No database.** Storage is JSON files via `store.rs`. Never add SQLite, Postgres, or any DB dependency.
- **`store.rs`** is the only file that touches the filesystem for data. All handlers call `store::*` functions.
- **Handlers** are thin — extract params, call store, return JSON. No business logic in handlers.
- **Models** in `models.rs` — all data types and request/response DTOs live here.
- **Errors** in `errors.rs` — `AppError` enum, implements `ResponseError`. Two variants: `NotFound`, `Io`.
- **Static files** embedded via `include_dir!("$CARGO_MANIFEST_DIR/static")`. The `backend/static/` directory must exist at compile time (created by `build.sh`).
- **No auth.** Single-user MVP. Don't add auth unless explicitly asked.

### Frontend (`frontend/src/`)

- **SolidJS** — not React. No virtual DOM. Use `createSignal`, `createResource`, `Show`, `For`. Never use React patterns (useState, useEffect, etc.).
- **Router:** `@solidjs/router` — routes in `index.tsx`, pages in `pages/`.
- **API client:** `api.ts` — all backend calls go through this module. Typed fetch wrapper.
- **Types:** `types.ts` — TypeScript interfaces matching backend models. Keep in sync with `models.rs`.
- **ProseMirror** for rich text in card descriptions. Schema includes basic nodes + lists. Description stored as ProseMirror JSON string. No raw HTML ever.
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
- Timestamps — `YYYY-MM-DD HH:MM:SS` UTC, generated in `store.rs` (no chrono crate).
- **Labels** — stored in `board.json` as a `labels: Vec<Label>` array. Each label has `id`, `name`, `color`. Colors are auto-assigned from a 12-color pastel palette (evenly distributed hues) in interleaved order for max visual distinction. `board.json` is read/written via the private `BoardFile` struct in `store.rs`; the public `Board` response type omits labels (labels only appear in `BoardDetail`). No separate labels file.

### File storage layout

```
data/boards/{board-id}/board.json
data/boards/{board-id}/lists/{list-id}/list.json
data/boards/{board-id}/lists/{list-id}/cards/{card-id}.json
```

- Deleting a board: `remove_dir_all` on its directory (cascades lists + cards).
- Deleting a list: `remove_dir_all` on its directory (cascades cards).
- Moving a card between lists: write to new location, delete from old location.
- Finding a card/list requires scanning board directories (no index). Acceptable at MVP scale.

## API Endpoints

```
GET    /api/changes                          → { mtime: u64 } (newest file mtime, for poll efficiency)
GET    /api/boards                           → Board[]
POST   /api/boards          {title}          → Board (201)
GET    /api/boards/:id                       → BoardDetail (nested lists + cards + labels)
PUT    /api/boards/:id       {title}         → Board
DELETE /api/boards/:id                       → 204

POST   /api/boards/:bid/labels  {name}       → Label (201) — auto-assigns pastel color
PUT    /api/labels/:id          {name}       → Label
DELETE /api/labels/:id                       → 204

POST   /api/boards/:bid/lists {title}        → List (201)
PUT    /api/lists/:id    {title?,pos?}       → List
DELETE /api/lists/:id                        → 204

POST   /api/lists/:lid/cards {title}         → Card (201)
PUT    /api/cards/:id  {title?,desc?,pos?,list_id?,label_ids?} → Card
DELETE /api/cards/:id                        → 204
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
- **Labels** — per-board colored tags. Stored in `board.json` (not separate files). Board labels flow down as `props.labels` through `BoardPage → List → Card`. CardDetail receives `boardLabels` prop and manages `selectedLabelIds` signal. `onSave` callback signature includes `labelIds: string[]`. Label management UI is a **right-side slide-out drawer** (`.label-drawer`, always rendered for CSS transition, toggled via `.label-drawer--open` class → `translateX(0)`). The "Labels" button lives in `.app-header-actions` (visible only on board pages). Label colors use `color-mix()` for selected state in the label picker.
- **LabelContext** — `LabelContext.tsx` exposes `{ isOpen, open, close, toggle, hasBoard, setHasBoard }` via SolidJS context. `App.tsx` wraps everything in `LabelProvider`. The `AppHeader` sub-component in `App.tsx` reads context to show/hide the Labels button. `Board.tsx` calls `lc.setHasBoard(true)` on mount and `lc.setHasBoard(false)` on cleanup. This pattern allows the header (outside the router outlet) to control drawer state owned by the board page.
- **Keyboard navigation** — Cards have `tabindex="0"` and handle `↑↓` (move within list), `←→` (jump to adjacent list), `Enter`/`Space` (open card), `Delete`/`Backspace` (delete card), `e` (edit focused card). Focus style via `.card:focus-visible`. Shortcuts are **hidden by default** — press `?` to toggle `ShortcutHelp` modal, or click the `?` button in the app header. The header `?` button dispatches a `toggle-shortcuts` `CustomEvent` on `document`; `Board.tsx` listens for it in `onMount`. Global shortcuts: `l` (add list), `n`/`c` (add card to focused/first list), `e` (edit focused card), `?` (toggle help), `Escape` (close drawer/help/blur card). Home page: `n` (open new board form). CardDetail: `Ctrl+Enter` saves, `Escape` closes (with unsaved guard), title `Enter` focuses editor.
- **`isInInput` guard** — `Board.tsx` defines `isInInput(target)` that returns true if the event target is an INPUT, TEXTAREA, contentEditable element, or inside `.modal-overlay`, `.label-drawer`, or `.shortcut-help-overlay`. All global keydown handlers check this before acting, so shortcuts don't fire while typing.
- **Focus restoration** — `Board.tsx` tracks `lastFocusedCardId` signal. Set on card click/keyboard open. After modal closes (`handleCardSave`, `handleModalClose`), `restoreFocus()` uses `requestAnimationFrame` to `querySelector('[data-card-id="..."]').focus()`. Ensures keyboard user returns to the card they were on.
- **ShortcutHelp** — `components/ShortcutHelp.tsx` renders a centered modal overlay with all shortcuts organized by section (Navigation, Cards, Board, Card Detail, Global). Closes on `Escape`, `?`, or overlay click. Rendered via `<Show when={showHelp()}>` in `Board.tsx`.

## Dependencies

### Backend (Cargo.toml)
- `actix-web` — HTTP framework
- `actix-cors` — CORS middleware
- `serde` / `serde_json` — serialization
- `uuid` — ID generation
- `tokio` — async runtime (rt-multi-thread + macros only)
- `include_dir` — embed static files in binary
- `mime_guess` — MIME type detection for static files

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
