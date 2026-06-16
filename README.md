# Synkban

A **local-first, keyboard-driven, syncable** (via any third party file sync) kanban board with a Rust backend (Actix Web) and SolidJS frontend. Data stored as JSON files on disk.

![demo](demo.gif)

Can be run in two ways:

* Standalone Electron app
* Web Server for deployment behind an authenticating proxy

## Features

- **Boards** — create, rename, recolor, archive/restore, reorder
- **Lists** — add to boards, reorder via drag-and-drop or keyboard, delete (archives any cards)
- **Cards** — drag within/across lists, archive/restore, permanent delete
- **Card detail** — modal with title (markdown bold/italic), rich text description (ProseMirror), labels, due date, file attachments (≤50 MB) with image thumbnails + preview
- **Labels** — per-board colored tags; auto-assigned palette; filter cards by label
- **Filter** — search cards by text + label inside a board
- **Archive** — soft-delete for boards and cards (separate undo flows)
- **Keyboard-first** — full keyboard navigation; press `?` for in-app help
- **Drag-and-drop** — HTML5 native drag API, fractional indexing for position (no bulk reorder updates)
- **File-based storage** — nested JSON files, no database required
- **Single binary** — frontend assets embedded at compile time via `include_dir`
- **Desktop mode** — optional Electron wrapper that bundles the binary + a native window (`./build.sh --desktop`)

## Prerequisites

| Tool                              | Version | Purpose                                |
| --------------------------------- | ------- | -------------------------------------- |
| [Rust](https://rustup.rs/)        | 1.70+   | Backend compilation                    |
| [Node.js](https://nodejs.org/)    | 18+     | Frontend build                         |
| [Docker](https://www.docker.com/) | any     | Optional, for containerized deployment |

## Quick Start

```bash
# Build everything into a single binary
./build.sh

# Run (creates ./data/ directory automatically)
./backend/target/release/synkban

# Open http://localhost:8080
```

## Development

### Setup

```bash
# Install pnpm if needed
npm install -g pnpm

# Install dependencies and approve build scripts (required for pnpm 10+)
pnpm install && pnpm approve-builds --all
cd frontend && pnpm install && pnpm approve-builds --all
cd ../electron && pnpm install && pnpm approve-builds --all
```

### Run

Run backend and frontend separately for hot reload:

```bash
# Terminal 1 — backend on :8080
cd backend
cargo run

# Terminal 2 — frontend on :3000 (proxies /api → :8080)
cd frontend
pnpm install
pnpm run dev
```

Open <http://localhost:3000>. The Vite dev server proxies all `/api` requests to the backend.

## Build

```bash
./build.sh
```

This script:

1. Builds the frontend (`pnpm install && pnpm run build` → `frontend/dist/`)
2. Copies `frontend/dist/` → `backend/static/`
3. Compiles the backend in release mode, embedding static files into the binary

Output: `backend/target/release/synkban` — a single binary you can copy anywhere and run.

## Configuration

All configuration via environment variables:

| Variable   | Default     | Description                                    |
| ---------- | ----------- | ---------------------------------------------- |
| `HOST`     | `127.0.0.1` | Bind address                                   |
| `PORT`     | `8080`      | Bind port                                      |
| `DATA_DIR` | `./data`    | Path to data directory (created automatically) |

Example:

```bash
HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/lib/tc ./synkban
```

## Docker

### Build

```bash
./docker-build.sh            # defaults to synkban:latest
./docker-build.sh myapp 1.0  # custom name:tag
# or directly:
docker build -t synkban .
```

### Run

```bash
# Ephemeral
docker run -p 8080:8080 synkban

# Persistent data
docker run -p 8080:8080 -v synkban-data:/app/data synkban
```

The Dockerfile is a multi-stage build:

1. **node:22** — builds frontend
2. **rust:1.95** — copies frontend dist into `static/`, compiles backend with embedded assets
3. **debian:bookworm-slim** — minimal runtime image with just the binary

## Data Storage

Data is stored as JSON files in a nested directory structure under `DATA_DIR`:

```
data/
└── boards/
    └── {board-id}/
        ├── board.json
        ├── lists/
        │   └── {list-id}/
        │       ├── list.json
        │       └── cards/
        │           └── {card-id}.json
        ├── archived_cards/                # orphaned cards (their list was deleted)
        │   └── {card-id}.json
        └── attachments/
            └── {card-id}/
                ├── {att-id}                # raw bytes (no extension)
                └── {att-id}_thumb          # JPEG, only for image attachments
```

Empty parent directories (`lists/`, `archived_cards/`, `attachments/`, etc.) are cleaned up automatically when their last child is removed.

### board.json

```json
{
  "id": "uuid",
  "title": "My Board",
  "created_at": "2026-05-13 14:08:21",
  "labels": [{ "id": "uuid", "name": "Bug", "color": "#ffb3b3" }],
  "color": "#0079bf",
  "archived": false,
  "position": 1.0
}
```

### list.json

```json
{
  "id": "uuid",
  "board_id": "uuid",
  "title": "To Do",
  "position": 1.0,
  "created_at": "2026-05-13 14:08:21"
}
```

### {card-id}.json

```json
{
  "id": "uuid",
  "list_id": "uuid",
  "title": "My Card",
  "description": "{\"type\":\"doc\",\"content\":[...]}",
  "position": 1.0,
  "created_at": "2026-05-13 14:08:21",
  "label_ids": ["uuid", "uuid"],
  "archived": false,
  "attachments": [
    { "id": "uuid", "filename": "spec.pdf", "size": 12345, "content_type": "application/pdf", "created_at": "2026-05-13 14:08:21" }
  ],
  "due_date": "2026-06-15"
}
```

The `description` field stores a ProseMirror document as a JSON string. Empty descriptions are stored as `""`. ProseMirror is safe by design — it uses a schema-constrained document model, not raw HTML.

### Backup / Migration

Data is plain JSON files. To back up: copy the `data/` directory. To migrate: move the directory to the new host and point `DATA_DIR` at it.

### Position field

Lists and cards use a `position: f64` field for ordering. New items get `max_position + 1.0`. Reordering sets position to the midpoint between neighbors (fractional indexing). This avoids bulk-updating all positions on every reorder.

## API Reference

Base URL: `/api`

### Change polling

| Method | Path       | Response            | Description                                                                                                                                                                   |
| ------ | ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/changes` | `{ mtime: number }` | Newest file mtime in `DATA_DIR`. The UI polls this every 15 s and only refetches the board when it changes — so external edits (rsync, Syncthing, etc.) flow through cheaply. |

### Boards

| Method | Path              | Body                            | Response      | Description                                                      |
| ------ | ----------------- | ------------------------------- | ------------- | ---------------------------------------------------------------- |
| GET    | `/boards`         | —                               | `Board[]`     | List active boards (sorted by `position` then `created_at` desc) |
| GET    | `/boards/archive` | —                               | `Board[]`     | List archived boards                                             |
| POST   | `/boards`         | `{ title }`                     | `Board` (201) | Create board                                                     |
| GET    | `/boards/:id`     | —                               | `BoardDetail` | Board with nested lists, cards, and labels                       |
| PUT    | `/boards/:id`     | `{ title?, color?, archived? }` | `Board`       | Update fields. Archiving must precede deletion.                  |
| PUT    | `/boards/order`   | `{ ids: string[] }`             | 204           | Renumber active boards 1.0, 2.0, … in the given order            |
| DELETE | `/boards/:id`     | —                               | 204           | Permanently delete (rejected with 400 if not archived)           |

### Labels

| Method | Path                       | Body       | Response      | Description                        |
| ------ | -------------------------- | ---------- | ------------- | ---------------------------------- |
| POST   | `/boards/:board_id/labels` | `{ name }` | `Label` (201) | Create label (color auto-assigned) |
| PUT    | `/labels/:id`              | `{ name }` | `Label`       | Rename label                       |
| DELETE | `/labels/:id`              | —          | 204           | Delete label                       |

### Lists

| Method | Path                      | Body                    | Response     | Description                                |
| ------ | ------------------------- | ----------------------- | ------------ | ------------------------------------------ |
| POST   | `/boards/:board_id/lists` | `{ title }`             | `List` (201) | Add list to board                          |
| PUT    | `/lists/:id`              | `{ title?, position? }` | `List`       | Update title and/or position               |
| DELETE | `/lists/:id`              | —                       | 204          | Delete list (archives any contained cards) |

### Cards

| Method | Path                        | Body                                                                              | Response     | Description                                                                                                                                                                        |
| ------ | --------------------------- | --------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/boards/:board_id/archive` | —                                                                                 | `Card[]`     | List archived cards on a board                                                                                                                                                     |
| POST   | `/lists/:list_id/cards`     | `{ title }`                                                                       | `Card` (201) | Add card to list                                                                                                                                                                   |
| PUT    | `/cards/:id`                | `{ title?, description?, position?, list_id?, label_ids?, archived?, due_date? }` | `Card`       | Update card fields. Set `list_id` to move; `due_date` accepts `null` to clear, omitted to leave unchanged. Restoring an orphaned card (whose list was deleted) requires `list_id`. |
| DELETE | `/cards/:id`                | —                                                                                 | 204          | Permanently delete card (rejected with 400 if not archived)                                                                                                                        |

### Attachments

| Method | Path                                        | Body                                        | Response           | Description                                       |
| ------ | ------------------------------------------- | ------------------------------------------- | ------------------ | ------------------------------------------------- |
| POST   | `/cards/:card_id/attachments?filename=…`    | raw bytes (`Content-Type` header preserved) | `Attachment` (201) | Upload an attachment (max 50 MB, 413 on overflow) |
| GET    | `/cards/:card_id/attachments/:att_id`       | —                                           | binary             | Download (sets `Content-Disposition: attachment`) |
| GET    | `/cards/:card_id/attachments/:att_id/thumb` | —                                           | JPEG               | Thumbnail (404 for non-image attachments)         |
| DELETE | `/cards/:card_id/attachments/:att_id`       | —                                           | 204                | Remove attachment + thumbnail                     |

### Types

```typescript
interface Label {
  id: string;
  name: string;     // supports **bold** and *italic*
  color: string;    // hex
}

interface Attachment {
  id: string;
  filename: string;
  size: number;     // bytes
  content_type: string;
  created_at: string;
}

interface Board {
  id: string;
  title: string;
  created_at: string;
  color?: string;
  archived: boolean;
  position: number;
}

interface Card {
  id: string;
  list_id: string;
  title: string;          // supports **bold** and *italic*
  description: string;    // ProseMirror doc JSON or empty string
  position: number;
  created_at: string;
  label_ids: string[];
  archived: boolean;
  attachments: Attachment[];
  due_date?: string;      // YYYY-MM-DD
}

interface ListWithCards {
  id: string;
  board_id: string;
  title: string;
  position: number;
  created_at: string;
  cards: Card[];
}

interface BoardDetail {
  id: string;
  title: string;
  created_at: string;
  color?: string;
  labels: Label[];
  lists: ListWithCards[];  // sorted by position
}
```

### Error responses

```json
{ "error": "Board not found" }
```

- `400` — bad request (validation: malformed date, deleting a non-archived board/card, restoring an orphaned card without `list_id`)
- `404` — resource not found
- `413` — attachment exceeds 50 MB
- `500` — IO error (disk full, permissions, etc.)

## Project Structure

```
tc/
├── backend/
│   ├── Cargo.toml                    # Rust dependencies
│   ├── src/
│   │   ├── main.rs                   # Thin entry point (delegates to lib)
│   │   ├── lib.rs                    # Server setup (web + desktop modes), routes, token auth, embedded static serving
│   │   ├── models.rs                 # Data structs + request/response types
│   │   ├── errors.rs                 # AppError → HTTP error responses
│   │   ├── store/                    # File-based JSON storage layer (modular)
│   │   │   ├── mod.rs                # Re-exports the flat public API
│   │   │   ├── paths.rs              # Path helpers (no I/O)
│   │   │   ├── io.rs                 # JSON read/write, file-op tracking, timestamps, mtime walk
│   │   │   ├── boards.rs             # Board CRUD + BoardFile (on-disk shape)
│   │   │   ├── labels.rs             # Label CRUD (stored inside board.json)
│   │   │   ├── lists.rs              # List CRUD (delete archives contained cards)
│   │   │   ├── cards.rs              # Card CRUD, archive/orphan logic
│   │   │   └── attachments.rs        # Attachment binaries + thumbnails
│   │   └── handlers/
│   │       ├── mod.rs
│   │       ├── boards.rs             # Board + change-poll + archive handlers
│   │       ├── labels.rs             # Label handlers
│   │       ├── lists.rs              # List handlers
│   │       └── cards.rs              # Card + attachment handlers
│   ├── tests/integration.rs          # Actix integration tests (HTTP-level)
│   └── static/                       # (gitignored) frontend build output copied here before cargo build
│
├── frontend/
│   ├── package.json                  # Node dependencies (SolidJS, ProseMirror, Vite)
│   ├── vite.config.ts                # Vite config: port 3000, proxy /api → :8080
│   ├── vitest.config.ts              # Vitest config (node default, jsdom per-test via directive)
│   ├── tsconfig.json                 # TypeScript strict mode, SolidJS JSX
│   ├── index.html                    # HTML entry point
│   └── src/
│       ├── index.tsx                 # App bootstrap, router setup, Electron detection
│       ├── App.tsx                   # Layout shell (header + content + label drawer trigger)
│       ├── LabelContext.tsx          # Cross-component state (drawer open, board title, rename mode)
│       ├── api.ts                    # Typed fetch wrapper for all API endpoints
│       ├── types.ts                  # TypeScript interfaces matching backend models
│       ├── boardInput.ts             # isInInput guard (skip shortcuts inside inputs/modals)
│       ├── mdInput.ts                # **bold**/*italic* Ctrl+B/I shortcut helper
│       ├── proseEditor.ts            # ProseMirror schema + createCardEditor()
│       ├── positions.ts              # Fractional indexing math
│       ├── filter.ts                 # Card-filter predicate
│       ├── pages/
│       │   ├── Home.tsx              # Board grid: create / archive / restore / reorder
│       │   └── Board.tsx             # Board view coordinator
│       ├── components/
│       │   ├── AddForm.tsx           # Reusable inline add form with auto-focus
│       │   ├── Card.tsx              # Draggable card with click-to-open (also exports renderTitle)
│       │   ├── List.tsx              # List column: cards, drag-drop, add card form
│       │   ├── CardDetail.tsx        # Card edit modal (composes the sections below)
│       │   ├── CardLabelSection.tsx  #   – assigned chips + picker
│       │   ├── DueDateSection.tsx    #   – ISO date input + native picker
│       │   ├── AttachmentsSection.tsx #  – attachments list + upload
│       │   ├── ImagePreviewOverlay.tsx # – lightbox for image attachments
│       │   ├── UnsavedDialog.tsx     #   – Save/Discard/Cancel guard
│       │   ├── LabelDrawer.tsx       # Right-side label CRUD drawer
│       │   ├── ArchiveCardsModal.tsx # Archived-cards modal (restore/delete)
│       │   ├── FilterBar.tsx         # Card filter (text + label chips)
│       │   ├── BoardColorPicker.tsx  # Header color button + grid dropdown
│       │   ├── ConfirmDialog.tsx     # Reusable confirm/cancel dialog
│       │   └── ShortcutHelp.tsx      # ? help modal
│       ├── *.test.ts                 # Vitest unit tests (filter, positions, mdInput, boardInput, api)
│       └── styles/
│           └── app.css               # All styles: layout, cards, modal, drawer, ProseMirror editor
│
├── electron/
│   ├── main.js                       # Electron main process (spawns Rust binary with token auth)
│   └── package.json                  # electron-builder config + extraResources
│
├── tests/                            # Playwright end-to-end tests (browser)
├── build.sh                          # Production build (web by default; `--desktop` packages Electron)
├── docker-build.sh                   # Docker image build helper
├── Dockerfile                        # Multi-stage: node → rust → debian-slim
├── .github/workflows/release.yml     # macOS/Linux/Windows release workflow (triggered by v* tags)
└── .gitignore
```

## Architecture Notes

### Frontend rendering

SolidJS uses fine-grained reactivity — no virtual DOM. Components use `createResource` for async data fetching with built-in `refetch`. State changes trigger minimal DOM updates. Component-level state is split: `Board.tsx` is the coordinator (signals + handlers + global keyboard), while presentation lives in focused leaf components (drawer, modals, filter bar, etc.) so each file stays small and testable.

### Drag-and-drop

Uses native HTML5 drag-and-drop API (no library). Cards store their ID and source list ID in `dataTransfer`. On drop, the new position is calculated as the midpoint between the neighboring cards' positions (see `positions.ts`). List reordering works the same way using X-axis position.

### Change polling

`GET /api/changes` returns the newest file mtime in `DATA_DIR`. The UI polls every 15 seconds and only refetches when mtime moves, so external edits (rsync, Syncthing) flow through cheaply.

### Rich text editor

ProseMirror with `prosemirror-example-setup`, configured in `frontend/src/proseEditor.ts`. The schema is the basic schema plus lists, minus the `image` and `horizontal_rule` nodes. The menu is customised: a Plain/Code/H1–H3 dropdown, inline bold/italic/code, and a custom link dialog. The document is serialised to JSON and stored in the card's `description` field. ProseMirror is inherently safe — it constructs DOM from a schema-validated document model, never from raw HTML strings.

### Desktop mode

When packaged with `./build.sh --desktop`, Electron generates a UUID token at launch, spawns the Rust binary with that token + a per-user `DATA_DIR`, reads a random port from stdout, then opens a window pointing at the local server. Every request must present the token (cookie or `?token=` query param), so other apps on the same machine can't reach the UI. See `electron/main.js` and `run_desktop_server` in `backend/src/lib.rs`.

**macOS "App is damaged" Error:**
Because the app is not code-signed with a Developer ID, macOS Gatekeeper may report it as "damaged". You can fix this by running:

```bash
sudo xattr -cr /Applications/Synkban.app
```

(Or run it on the `.dmg` / `.zip` content before moving to Applications).

### Static file embedding

The `include_dir!` macro embeds the entire `backend/static/` directory into the binary at compile time. The `serve_embedded` handler serves these files with correct MIME types, falling back to `index.html` for client-side routes (SPA fallback).

## Testing

```bash
# Backend unit + integration tests
cd backend && cargo test

# Frontend unit tests (Vitest)
cd frontend && pnpm test

# End-to-end (Playwright; expects backend + frontend dev servers running)
pnpm playwright test
```

Backend tests live alongside the code (`#[cfg(test)] mod tests` per storage submodule, plus `backend/tests/integration.rs` for HTTP-level coverage). Frontend tests cover utilities (`positions`, `filter`, `mdInput`, `boardInput`), the API client, and `renderTitle`.
