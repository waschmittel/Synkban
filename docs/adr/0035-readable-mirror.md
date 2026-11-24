# Readable mirror exports static HTML and ID-keyed folders via manifest

A **Readable Mirror** exports a read-only, incremental, browser-browseable copy of saved boards, lists, cards, and attachments into a user-selected directory. In **Desktop Mode**, Settings configures the folder, schedule (`off` | `daily` | `weekly`), status, and manual trigger; in **Web Mode** / headless setups, `synkban export <output-dir>` runs one-shot from the CLI.

## Why

Synkban's `Data Directory` uses ProseMirror JSON strings inside card JSON files and extensionless UUID attachment blobs ([ADR-0004](0004-attachments-are-sidecars.md), [ADR-0015](0015-editor-document-model-and-links.md)). Users need a way to read and browse their boards with standard software (a web browser and file explorer) without Synkban running, while avoiding the fragility of title-derived folder paths, PDF/A font limits (no CJK), or unauthenticated server-path writes over HTTP.

## Structure and rules

- **Layout:** Flat-per-board ID folders so dragging cards between lists or archiving/restoring cards never moves attachments on disk:
  - `README.md` (timestamp-free explanation of mirror semantics and layout)
  - `index.html` (master-detail explorer in true `position` order, with live filter and `#<board-id>/<card-id>` hash deep-linking)
  - `style.css` (central stylesheet shared by `index.html` and every `card.html`, supporting light/dark/print and semantic highlights/alerts/tables)
  - `.synkban-mirror.json` (manifest tracking owned paths and per-card/index 128-bit input fingerprints)
  - `boards/<board-id>/cards/<card-id>/card.html` (`../../../../style.css`, pure semantic HTML of the saved card) + `attachments/`
- **Both `file://` and `http(s)://`:** `index.html` drives an `<iframe name="detail">` via relative links (`boards/<bid>/cards/<cid>/card.html`, never leading `/` or `fetch()`) and never reads `iframe.contentDocument`, so local double-click browsing works alongside static HTTP hosting (with `X-Frame-Options: SAMEORIGIN`). External card links open with `target="_blank" rel="noopener noreferrer"`.
- **Hybrid attachment naming:** Sorted deterministically by `(created_at, id)`, attachments with simple unique ASCII names (`[A-Za-z0-9._-]`, 1–64 chars, alphanumeric ends, no `..`, not a Windows reserved stem `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`, no case-insensitive collision on that card) keep their filename verbatim; all others fall back to `<att-id><ext>` preserving compound extensions (`.tar.gz`, `.sql.zst`, `.d.ts`, `.drawio.svg`, etc.) or MIME-inferred extensions so `file://` browsers open them properly.
- **Safety invariants:**
  - `mirror_dir`, `data_dir`, and `config_dir` are resolved via deepest-existing-ancestor canonicalization (`resolve_canonical`, matching symlinks and Windows `\\?\` prefixes) and refused on overlap or filesystem roots. Unmanifested directories containing `README.md`, `index.html`, `style.css`, or `boards/` are rejected.
  - Pruning deletes **only** paths recorded in `.synkban-mirror.json` (`fs::remove_file`) and cleans empty dirs bottom-up strictly via `fs::remove_dir` (never `remove_dir_all`), leaving unrelated user files untouched.
  - If `store::snapshot_for_mirror` reports any corrupt-file warning ([ADR-0001](0001-json-files-no-database.md)), the export aborts before modifying or pruning the mirror.
  - Archived boards and archived cards stay in the mirror until permanently deleted ([ADR-0006](0006-soft-delete-and-archive.md)); only **Saved Cards** are exported ([ADR-0007](0007-card-content-saves-atomically.md)).
- **Desktop vs. Web Mode:** `DesktopMode(true)` enables `mirror_dir`/`mirror_schedule` in `PUT /api/settings`, `POST /api/mirror/run`, and the in-process scheduler (`config_dir()/mirror-state.json` tracks `last_succeeded_at`, `last_attempt_at`, `last_error`, `cards_mirrored` even when a target drive is disconnected). `DesktopMode(false)` rejects those endpoints (`400`) and exposes `synkban export <output-dir>` for cron or backup hooks.

## Considered and rejected

- **PDF/A-2u per card in the mirror:** Slow on large workspaces, non-deterministic `exported_at` timestamps, no bundled CJK fonts ([ADR-0012](0012-pdf-a-export.md)).
- **Human-readable folder names on disk:** Fragile across OSes (Windows 260-char `MAX_PATH`, reserved device names, case-insensitive clashes, title-edit folder churn).
- **Embedded `<style>` in every `card.html`:** Duplicates CSS across hundreds of cards; central `style.css` keeps cards pure semantic HTML and makes styling updates touch one file.
- **Calling it a "backup":** Misleading because permanent deletions propagate; "Readable Mirror" makes the one-way current-state semantics explicit.
- **Unauthenticated Web Mode path configuration:** Would let any client with network reach overwrite/prune arbitrary server paths.
