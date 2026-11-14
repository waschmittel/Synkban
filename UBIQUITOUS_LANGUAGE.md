# Ubiquitous Language

> Domain: **Synkban** — a local-first, syncable kanban board (Rust backend, SolidJS frontend, JSON files on disk, optional Electron shell). Use these terms in code, tests, docs and issues.

## Domain objects

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Board** | Top-level workspace owning ordered **Lists**, a **Label** palette and a colour (`board.json`) | Project, workspace |
| **List** | An ordered column on a **Board** holding **Cards** (`list.json`) | Column, lane, stack |
| **Card** | A unit of work in one **List**: title, description, labels, due date, checklist, attachments, history | Task, ticket, item |
| **Label** | Named, auto-coloured tag defined per **Board**; cards reference it by id; array order = display order (ADR-0014) | Tag, category |
| **Description** | A **Card**'s rich text: ProseMirror doc JSON stored as a string (ADR-0015) | Body, notes |
| **Checklist** | The single flat list of **Checklist Items** (`id`, `text`, `done`) on a **Card**; card content (ADR-0007) | Subtasks, todo list |
| **Attachment** | A file on a **Card**, stored as binary + optional thumbnail + sidecar, never in card JSON (ADR-0004) | Upload, file |
| **Due Date** | Optional `YYYY-MM-DD` on a **Card**, shown as a colour-coded badge | Deadline |
| **History** | Last 100 content snapshots of a **Card**, newest first via `/history` (ADR-0005) | Audit log, changelog |
| **Position** | `f64` fractional index ordering boards, lists, cards (midpoint insertion; gaps are fine) | Index, rank |

## State and lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Archived** | Soft-deleted **Board**/**Card**; hidden but restorable; must precede permanent deletion (ADR-0006) | Deleted, trashed |
| **Orphaned Card** | An archived **Card** whose **List** was deleted (`archived_cards/`); restoring needs a target `list_id` | Lost card |
| **Saved Card** | The persisted state of a **Card**; PDF export and history use it, never unsaved modal edits (ADR-0007) | Committed card |
| **Dirty** | The card modal has unsaved edits; closing goes through the unsaved guard | Modified |
| **Warning** | A data-integrity notice for a corrupt/unreadable file the walkers skipped (`/api/warnings`) | Error banner |
| **Data Directory** | Root of all board files; resolved `--data-dir` > `DATA_DIR` > config > default (ADR-0002) | Storage folder |
| **Settings** | User preferences in `synkban.toml` (`startup_view`, `last_board_id`, `theme`, `data_dir`), served by the backend | Preferences, config (for UI choices) |

## UI and interaction

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Accel** | The platform accelerator: Cmd on macOS, Ctrl elsewhere (ADR-0008) | Ctrl/Cmd, Mod (outside ProseMirror keymaps) |
| **Card Modal** | The detail dialog for a **Card** (`CardDetail`) with sections for title, labels, due date, description, checklist, attachments | Card detail page |
| **Label Drawer** | Right-side slide-out for managing **Labels** | Label panel |
| **Archive Panel** | Shared overlay (`ArchivePanel`) listing archived cards or boards with Restore/Delete | Trash |
| **Board Dock** | Fixed pill of dots at the bottom of a board to switch boards (`,`/`.`) | Pager |
| **Filter Bar** | Text + label filter below the board title bar (AND semantics) | Search bar |
| **Editor Menu** | The context-sensitive `Accel+K` popup in the description editor: link, code, text style, table (ADR-0016) | Table menu, command palette |
| **Text Style** | Block type of a description paragraph: Plain text, Code block, Heading 1–3 (never "H1") | Block type, format |
| **Header Row** | First row of a description table; always the header, source of column alignment (ADR-0017) | Table head |
| **Overlay Layer** | An entry in the open-order stack of overlays; traps yield to higher layers (ADR-0009) | Modal stack |
| **Desktop Mode** | Electron shell around the binary with token auth and a random port (ADR-0003) | Native app |
| **Web Mode** | Standalone binary serving the UI at `:8080` | Server mode |

## Relationships

- A **Board** has many **Lists** and **Labels**; a **List** has many **Cards**; a **Card** references **Labels** by id.
- Archiving a **List** is impossible — deleting one **Archives** its **Cards** (they become **Orphaned**).
- A **Card**'s **History** records content changes only, never moves or archiving.

## Flagged ambiguities

- "Delete" in the UI means **Archive** for boards and cards; permanent removal is "Delete permanently" and only exists in an **Archive Panel**.
- "Save" always means saving the **Card Modal** (or **Settings**), never autosave.
