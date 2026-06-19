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
- **Card detail** — modal with title (markdown bold/italic), rich text description (ProseMirror), labels, due date, checklist, file attachments (≤50 MB) with image thumbnails + preview
- **Labels** — per-board colored tags; auto-assigned palette; filter cards by label
- **Filter** — search cards by text + label inside a board
- **Archive** — soft-delete for boards and cards (separate undo flows)
- **Keyboard-first** — full keyboard navigation; press `?` for in-app help
- **Drag-and-drop** — HTML5 native drag API, fractional indexing for position (no bulk reorder updates)
- **File-based storage** — nested JSON files, no database required
- **Single binary** — frontend assets embedded at compile time via `include_dir`
- **Desktop mode** — optional Electron wrapper that bundles the binary + a native window (`./build.sh --desktop`)

## Quick Start

```bash
# Build everything into a single binary
./build.sh

# Run (creates ./data/ directory automatically)
./backend/target/release/synkban

# Open http://localhost:8080
```

## Development

Dev setup, API reference, project structure, architecture notes, and testing are documented separately:

➡️ **[Development guide](docs/development.md)**

## Configuration

All configuration via environment variables:

| Variable   | Default     | Description                                      |
| ---------- | ----------- | ------------------------------------------------ |
| `HOST`     | `127.0.0.1` | Bind address                                     |
| `PORT`     | `8080`      | Bind port                                        |
| `DATA_DIR` | `./data`    | **Path to the data directory** (created if absent) |

```bash
HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/lib/tc ./synkban
```

### How the effective `DATA_DIR` is determined

`DATA_DIR` is the one setting that decides **where all your boards live**, so it's worth knowing how it's resolved:

- **Web server mode** (`./synkban`, Docker) — reads the `DATA_DIR` env var. If unset, defaults to `./data` (relative to the working directory). Created automatically on first run.
- **Desktop mode** (Electron app) — Electron **overrides** `DATA_DIR` with the per-user application data directory and passes it to the bundled binary, so any inherited env var is ignored. Locations:
  - macOS — `~/Library/Application Support/Synkban`
  - Windows — `%APPDATA%\Synkban`
  - Linux — `~/.config/Synkban`

Data is plain JSON files: to back up, copy the directory; to migrate, move it to the new host and point `DATA_DIR` at it. The on-disk layout and file formats are documented in the [development guide](docs/development.md#data-storage).

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

## Self-Hosting (Docker Compose + authenticating proxy)

Synkban's web server has **no authentication of its own** (single-user MVP), so run it behind an authenticating reverse proxy on an internal network with no published ports. Full step-by-step setup with Docker Compose + Caddy (login form + long-lived session cookie via the `caddy-security` plugin):

➡️ **[Self-hosting behind Caddy + caddy-security](docs/self-hosting-caddy-security.md)**
