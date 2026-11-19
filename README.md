# Synkban

A **local-first, keyboard-driven, syncable** (via any third party file sync) kanban board with a Rust backend (Actix Web) and SolidJS frontend. Data stored as JSON files on disk.

![demo](demo.gif)

➡️ **[Read the User Guide](docs/user-guide.md)** — full walkthrough of features, Kanban & Notes modes, syncing, crash safety, and keyboard shortcuts.

Can be run in two ways:

* Standalone **Desktop Mode** app (macOS, Linux, Windows)
* **Web Mode** server / Docker container (installable as a PWA) for local use or behind an authenticating proxy

## Features

- **Boards** — create, rename inline, recolour (with automatic light/dark palette), archive/restore, reorder, and switch quickly via the bottom Board Dock
- **Kanban Mode & Notes Mode** — view lists side by side or press `V` to switch any board into a split master-detail writing view with list tabs
- **Lists** — add, rename, reorder (drag or keyboard), collapse into narrow vertical strips (`C`), and delete safely (contained cards are archived)
- **Quick-add & Cards** — drag within/across lists (mouse, keyboard, or long-press touch), or assign `#label` and `due:` tokens right in a new card's title
- **Rich Card Detail** — formatted title (`**bold**` / `*italic*`), structured rich-text description (headings, code blocks, quotes, nested lists, smart links, tables, transposable matrices, and inline images), keyboard-first due date picker, flat checklist, and file attachments (≤50 MB) with image thumbnails and lightbox preview
- **Labels & Filtering** — per-board ordered labels with loose matching and merge support; filter cards by text, due date (`Overdue`, `This week`, `Until…`), and labels
- **Card History & PDF/A Export** — inspect the last 100 content snapshots with field-by-field diffs, or export any card offline to archival **PDF/A-2u**
- **Archive, Crash Safety & Resilience** — two-step archive before permanent deletion, machine-local crash drafts for open unsaved edits, warning banners for partial/corrupt files, and offline/outage resilience
- **Keyboard-first & Dark Mode** — cross-platform shortcuts (`?` for contextual help) and system/light/dark themes
- **File-based Sync & Single Binary** — plain JSON files + sidecar attachments on disk with 15-second external change polling; frontend assets embedded into one Rust binary

## Quick Start

```bash
# Build everything into a single binary
./build.sh

# Run (creates ~/.config/synkban/data/ automatically)
./backend/target/release/synkban

# Open http://localhost:8080
```

## Documentation

- **[User Guide](docs/user-guide.md)** — complete guide to features, workflows, syncing across devices, backups, and shortcuts
- **[Self-Hosting & Docker Guide (Traefik + Tinyauth PWA)](docs/docker/README.md)** — Docker image, persistent single-prompt login, and mobile/desktop PWA setup
- **[PDF Export Examples](docs/export-examples/README.md)** — reference PDFs showing layout and typography rules
- **[Development Guide](docs/development.md)** — dev setup, API reference, project structure, architecture notes, and testing

## Configuration

Environment variables and CLI flags:

| Variable             | Default               | Description                                                |
| -------------------- | --------------------- | ---------------------------------------------------------- |
| `HOST`               | `127.0.0.1`           | Bind address                                               |
| `PORT`               | `8080`                | Bind port                                                  |
| `DATA_DIR`           | `~/.config/synkban/data` | **Path to the data directory** (created if absent)      |
| `SYNKBAN_CONFIG_DIR` | `~/.config/synkban`   | Directory for `synkban.toml` and local crash-recovery draft |

| Flag                | Description                                        |
| ------------------- | -------------------------------------------------- |
| `--data-dir <path>` | Data directory; takes precedence over `DATA_DIR`   |

```bash
HOST=0.0.0.0 PORT=3000 DATA_DIR=/var/lib/tc ./synkban
# or
./synkban --data-dir /var/lib/tc
```

### Config file

Persistent settings live in `~/.config/synkban/synkban.toml` (all platforms and modes; directory overridable via `SYNKBAN_CONFIG_DIR`):

```toml
data_dir = "/home/me/Sync/synkban"   # optional custom data directory
startup_view = "last"                # "overview" (default) | "last"
theme = "system"                     # "system" (default) | "light" | "dark"
last_board_id = "…"                  # maintained automatically
```

You normally never edit it — the in-app **⚙ Settings** dialog (gear button in the top bar) writes it for you.

### How the effective data directory is determined

The data directory is the one setting that decides **where all your boards live**. Resolution order (identical in web server and desktop mode):

1. `--data-dir` CLI flag
2. `DATA_DIR` environment variable
3. `data_dir` in `~/.config/synkban/synkban.toml`
4. default: `~/.config/synkban/data/`

Created automatically on first run. In the desktop app a custom folder (e.g. inside your Syncthing/Dropbox tree) can be chosen via **⚙ Settings** → *Data folder* → *Browse…*; saving restarts the app on the new folder. Existing boards are **not** moved automatically — copy the `boards/` folder yourself.

### Startup view

By default the app opens on the board overview. **⚙ Settings** → *On startup, open* switches to reopening the last used board instead (persisted in the config file; deep links always win, and a board that no longer exists falls back to the overview).

Data is plain JSON files: to back up, copy the directory; to migrate, move it to the new host and point `DATA_DIR` at it. The on-disk layout and file formats are documented in the [development guide](docs/development.md#data-storage).

## Self-Hosting & Docker

Synkban's web server has **no authentication of its own** (single-user MVP), so run it locally, on a private network, or behind an authenticating reverse proxy:

➡️ **[Self-Hosting & Docker Guide (Traefik + Tinyauth PWA)](docs/docker/README.md)** — `ghcr.io/waschmittel/synkban`, local/standalone Docker runs, and Docker Compose with persistent single-prompt login and unauthenticated PWA metadata

## License

Synkban is released under the [MIT License](LICENSE). Bundled fonts and third-party components keep their own licenses — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
