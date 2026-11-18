# Data lives in JSON files; `store/` is the only code that touches them

Boards, lists and cards are plain JSON files (`data/boards/{bid}/board.json`, `lists/{lid}/list.json`, `lists/{lid}/cards/{cid}.json`, `archived_cards/{cid}.json`). No database, ever. Only `backend/src/store/` performs data I/O; handlers extract params, call `store::*`, return JSON. `store/walk.rs` is the only `read_dir` walker over the tree and defines what counts as a valid board (dir + `board.json`), list (dir + `list.json`) and card (`*.json`).

## Why

The app is local-first and syncable with plain file tools (rsync, git, Syncthing). One file per card makes concurrent edits of different cards conflict-free and lets users inspect or repair data by hand. A flat public store API (`store/mod.rs` re-exports) keeps handlers ignorant of layout.

## Rules that follow

- **IDs** are server-generated UUIDv4; `store/paths.rs::check_id` validates every incoming ID (`1..=64` ASCII alphanumeric, `-`, `_`, 400 otherwise) so path parameters can never traverse directories. `position: f64` uses fractional indexing (new = `max + 1.0`, reorder = midpoint, finite `f64` required on update; gaps are fine, never normalised). Timestamps are `YYYY-MM-DD HH:MM:SS` UTC from `store/io.rs` (no chrono).
- **Corrupt files are skipped, not fatal.** Every walker tolerates one unreadable JSON file (partial sync, manual edit) and records a warning (`io::warn_skip`, drained by `collect_warnings`, served at `GET /api/warnings`, shown as a dismissible `WarningBanner`). Skipped data stays on disk, hidden until readable. Single-item reads that own their record still error for that op.
- **Writes are atomic:** `write_json` writes a `.{name}.{uuid}.tmp` beside the file and renames it over (walkers only read `*.json`). Card read-modify-writes (`update_card`, attachment add/remove with their history entry) hold `io::card_write_lock()`: parallel uploads used to interleave `fs::write`s and leave the card file unparseable.
- **Audit trail:** `io::track` records every write/delete; mutating handlers drain it (`store::drain_file_ops`) and log the action plus an explicit file list.
- **Moves** write the new location then delete the old. Deleting a board removes its directory; deleting a list archives its cards first (ADR-0006). `remove_dir_if_empty` cleans empty parents (`attachments/{cid}/`, `attachments/`, `archived_cards/`, `lists/`).
- **Finding a card/list scans board directories** (no index) — acceptable at this scale.
- **Dead label IDs** are pruned on every card write (ADR-0014).
- **Backward compatibility** uses `#[serde(default)]` on new fields; breaking changes need a documented migration.
- **No auth** (single-user). Don't add it unless asked.

## Considered and rejected

- **SQLite/Postgres.** Defeats file-level sync and manual repair.
- **An in-memory index.** Complexity without need at MVP scale.
