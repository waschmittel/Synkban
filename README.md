# Trello Clone

A Trello-like kanban board with a Rust backend (Actix Web) and SolidJS frontend. Data stored as JSON files on disk. Builds into a single self-contained binary with the frontend embedded at compile time.

## Features

- **Boards** — create, rename, delete
- **Lists** — add to boards, reorder via drag-and-drop, delete (cascades cards)
- **Cards** — add to lists, drag within/across lists, delete
- **Card detail view** — click a card to open a modal with editable title and rich text description (ProseMirror)
- **Drag-and-drop** — HTML5 native drag API, fractional indexing for position (no bulk reorder updates)
- **File-based storage** — nested JSON files, no database required
- **Single binary** — frontend assets embedded at compile time via `include_dir`

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Rust](https://rustup.rs/) | 1.70+ | Backend compilation |
| [Node.js](https://nodejs.org/) | 18+ | Frontend build |
| [Docker](https://www.docker.com/) | any | Optional, for containerized deployment |

## Quick Start

```bash
# Build everything into a single binary
./build.sh

# Run (creates ./data/ directory automatically)
./backend/target/release/tc-backend

# Open http://localhost:8080
```

## Development

Run backend and frontend separately for hot reload:

```bash
# Terminal 1 — backend on :8080
cd backend
cargo run

# Terminal 2 — frontend on :3000 (proxies /api → :8080)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. The Vite dev server proxies all `/api` requests to the backend.

## Build

```bash
./build.sh
```

This script:
1. Builds the frontend (`npm ci && npm run build` → `frontend/dist/`)
2. Copies `frontend/dist/` → `backend/static/`
3. Compiles the backend in release mode, embedding static files into the binary

Output: `backend/target/release/tc-backend` — a single binary you can copy anywhere and run.

## Configuration

All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8080` | Bind port |
| `DATA_DIR` | `./data` | Path to data directory (created automatically) |

Example:
```bash
HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/lib/tc ./tc-backend
```

## Docker

### Build

```bash
./docker-build.sh            # defaults to tc-trello:latest
./docker-build.sh myapp 1.0  # custom name:tag
# or directly:
docker build -t tc-trello .
```

### Run

```bash
# Ephemeral
docker run -p 8080:8080 tc-trello

# Persistent data
docker run -p 8080:8080 -v tc-data:/app/data tc-trello
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
    └── {uuid}/
        ├── board.json
        └── lists/
            └── {uuid}/
                ├── list.json
                └── cards/
                    └── {uuid}.json
```

### board.json
```json
{
  "id": "uuid",
  "title": "My Board",
  "created_at": "2026-05-13 14:08:21"
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
  "created_at": "2026-05-13 14:08:21"
}
```

The `description` field stores a ProseMirror document as a JSON string. Empty descriptions are stored as `""`. ProseMirror is safe by design — it uses a schema-constrained document model, not raw HTML.

### Backup / Migration

Data is plain JSON files. To back up: copy the `data/` directory. To migrate: move the directory to the new host and point `DATA_DIR` at it.

### Position field

Lists and cards use a `position: f64` field for ordering. New items get `max_position + 1.0`. Reordering sets position to the midpoint between neighbors (fractional indexing). This avoids bulk-updating all positions on every reorder.

## API Reference

Base URL: `/api`

### Boards

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| GET | `/boards` | — | `Board[]` | List all boards (newest first) |
| POST | `/boards` | `{ title }` | `Board` (201) | Create board |
| GET | `/boards/:id` | — | `BoardDetail` | Board with nested lists and cards |
| PUT | `/boards/:id` | `{ title }` | `Board` | Rename board |
| DELETE | `/boards/:id` | — | 204 | Delete board and all its lists/cards |

### Lists

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| POST | `/boards/:board_id/lists` | `{ title }` | `List` (201) | Add list to board |
| PUT | `/lists/:id` | `{ title?, position? }` | `List` | Update title and/or position |
| DELETE | `/lists/:id` | — | 204 | Delete list and all its cards |

### Cards

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| POST | `/lists/:list_id/cards` | `{ title }` | `Card` (201) | Add card to list |
| PUT | `/cards/:id` | `{ title?, description?, position?, list_id? }` | `Card` | Update card fields. Set `list_id` to move between lists |
| DELETE | `/cards/:id` | — | 204 | Delete card |

### Types

```typescript
interface Board {
  id: string;
  title: string;
  created_at: string;
}

interface Card {
  id: string;
  list_id: string;
  title: string;
  description: string;   // ProseMirror doc JSON or empty string
  position: number;
  created_at: string;
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
  lists: ListWithCards[];  // sorted by position
}
```

### Error responses

```json
{ "error": "Board not found" }
```

- `404` — resource not found
- `500` — IO error (disk full, permissions, etc.)

## Project Structure

```
tc/
├── backend/
│   ├── Cargo.toml                    # Rust dependencies
│   ├── src/
│   │   ├── main.rs                   # Server setup, routes, embedded static serving
│   │   ├── store.rs                  # File-based JSON storage layer
│   │   ├── models.rs                 # Data structs + request/response types
│   │   ├── errors.rs                 # AppError → HTTP error responses
│   │   └── handlers/
│   │       ├── mod.rs
│   │       ├── boards.rs             # Board CRUD handlers
│   │       ├── lists.rs              # List CRUD handlers
│   │       └── cards.rs              # Card CRUD handlers
│   └── static/                       # (gitignored) frontend build output copied here before cargo build
│
├── frontend/
│   ├── package.json                  # Node dependencies (SolidJS, ProseMirror, Vite)
│   ├── vite.config.ts                # Vite config: port 3000, proxy /api → :8080
│   ├── tsconfig.json                 # TypeScript strict mode, SolidJS JSX
│   ├── index.html                    # HTML entry point
│   └── src/
│       ├── index.tsx                 # App bootstrap, router setup
│       ├── App.tsx                   # Layout shell (header + content)
│       ├── api.ts                    # Typed fetch wrapper for all API endpoints
│       ├── types.ts                  # TypeScript interfaces matching backend models
│       ├── pages/
│       │   ├── Home.tsx              # Board grid, create/delete boards
│       │   └── Board.tsx             # Board view: lists, cards, drag-drop, card detail modal
│       ├── components/
│       │   ├── AddForm.tsx           # Reusable inline add form with auto-focus
│       │   ├── Card.tsx              # Draggable card with click-to-open
│       │   ├── CardDetail.tsx        # Modal: editable title + ProseMirror rich text editor
│       │   └── List.tsx              # List column: cards, drag-drop, add card form
│       └── styles/
│           └── app.css               # All styles: layout, cards, modal, ProseMirror editor
│
├── build.sh                          # Production build: frontend → backend/static → cargo build --release
├── docker-build.sh                   # Docker image build helper
├── Dockerfile                        # Multi-stage: node → rust → debian-slim
└── .gitignore
```

## Architecture Notes

### Frontend rendering

SolidJS uses fine-grained reactivity — no virtual DOM. Components use `createResource` for async data fetching with built-in `refetch`. State changes trigger minimal DOM updates.

### Drag-and-drop

Uses native HTML5 drag-and-drop API (no library). Cards store their ID and source list ID in `dataTransfer`. On drop, the new position is calculated as the midpoint between the neighboring cards' positions. List reordering works the same way using X-axis position.

### Rich text editor

ProseMirror with `prosemirror-example-setup` provides a toolbar with formatting options (bold, italic, headings, lists, blockquotes, code). The document is serialized to JSON and stored in the card's `description` field. ProseMirror is inherently safe — it constructs DOM from a schema-validated document model, never from raw HTML strings.

### Static file embedding

The `include_dir!` macro embeds the entire `backend/static/` directory into the binary at compile time. The `serve_embedded` handler serves these files with correct MIME types, falling back to `index.html` for client-side routes (SPA fallback).
