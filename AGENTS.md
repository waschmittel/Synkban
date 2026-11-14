# AGENTS.md — Agent Instructions for Synkban

Local-first, syncable kanban board. Rust backend (Actix Web), SolidJS frontend, file-based JSON storage. Single binary with embedded frontend. Optional Electron desktop shell wraps the web UI in a native window.

Decisions and the *why* behind non-obvious behaviour live in **`docs/adr/`** — read the ADRs touching the area you work in (index below). Domain vocabulary: `UBIQUITOUS_LANGUAGE.md`.

## Platform support (REQUIREMENT)

macOS, Linux and Windows, as web app and as Electron app. Every feature — especially every shortcut — must work on all three with the platform's conventions: never hardcode ⌘/Ctrl (use `platform.ts`), no Alt chords, letters over punctuation, no platform-specific layout/file handling (ADR-0008). The release workflow builds all three; a change that only works on one is a bug.

## Build, run, test

```bash
./build.sh                # frontend, then backend (assets embedded), then Playwright e2e
./build.sh --skip-tests   # same without e2e
./build.sh --desktop      # Electron app → electron/dist/
./run.sh                  # build (no e2e), start the server, open the browser
# Development (two terminals)
cd backend && cargo run   # :8080
cd frontend && pnpm run dev  # :3000, proxies /api → :8080
cd electron && pnpm install && pnpm start   # desktop dev (needs the release binary)
```

After any change:
1. **Backend:** `cd backend && cargo build` — zero warnings. `cargo test` (PDF goldens: `UPDATE_GOLDEN=1 cargo test --lib pdf` after an *intended* layout change, review the diff).
2. **Frontend:** `cd frontend && npx tsc --noEmit && npx vitest run && npx vite build`.
3. **E2E:** `cd frontend && pnpm run test:e2e` (boots `backend/target/release/synkban` on :8091 with temp dirs; needs `pnpm exec playwright install chromium` once). Conventions and caveats: ADR-0018.
4. **Smoke:** start the server; `curl localhost:8080/api/boards` returns `[]` on a fresh data dir.

- **Integration testing matters.** Extend e2e/golden/corner-case tests in the same change; improve tests rather than omit them. PDF-affecting changes add corner cases (ADR-0012); shortcut changes update `e2e/tooltips.spec.ts` (ADR-0008).
- `backend/static/` must exist for `cargo build` (dummy `index.html` for dev builds). Build order matters: frontend first.

## Working rules

- **Never commit or push on your own.** Leave changes in the working tree; commit only when the user explicitly asks.
- **Keep docs in step.** When a change touches documented behaviour or a design decision, update the ADRs (`docs/adr/`), `UBIQUITOUS_LANGUAGE.md` for new/changed terms, `ShortcutHelp.tsx` + tooltips for shortcuts, and this file if architecture or workflow changes. A new design decision gets a new ADR (short: decision, **Why**, rules/consequences, considered and rejected); don't duplicate ADR content here.
- Use current versions of everything and pin them (dependencies, Docker images, GitHub Actions SHAs).
- Be brief in code and comments.

## Architecture

### Backend (`backend/src/`)

- **`store/`** is the only data I/O (ADR-0001): `paths.rs` (pure), `io.rs` (JSON, file-op tracking, warnings), `boards.rs`, `labels.rs`, `lists.rs`, `cards.rs` (`CardLocation`, history), `card_index.rs`, `attachments.rs`, `gc.rs`, `walk.rs` (the only `read_dir` walker). `mod.rs` re-exports a flat API.
- **Handlers** are thin: extract, call store, return JSON; mutating ones log action + file list.
- `models.rs` all types/DTOs; `errors.rs` `AppError` (`NotFound`, `Io`, `TooLarge` 413, `BadRequest` 400); `config.rs` settings file (ADR-0002); `pdf.rs` PDF/A export (ADR-0012); static files via `include_dir!("$CARGO_MANIFEST_DIR/static")`.
- `lib.rs` exposes `run_server` and `run_desktop_server` (token + random port, ADR-0003); `main.rs` is a thin entry; `build.rs` is a no-op. `log_timestamp()` gives UTC `HH:MM:SS`.

### Frontend (`frontend/src/`)

- **SolidJS, not React**: `createSignal`/`createResource`/`Show`/`For`; never `useState`/`useEffect`; don't destructure props; `createMemo` for derived values. Router `@solidjs/router` (`index.tsx`, `pages/`).
- `api.ts` is the only backend access; `types.ts` mirrors `models.rs` (keep in sync). All styles in `styles/app.css` (no modules/Tailwind/CSS-in-JS).
- `pages/` `Home`, `Board` (coordinator); `components/` leaf and section components (cards, lists, CardDetail sections, dialogs, drawers); shared utilities at `src/` root, notably `platform.ts`, `shortcutRouter.ts`, `boardInput.ts` (`isInInput`), `focusTrap.ts`/`dialogKeys.ts`/`overlayLayers.ts` (ADR-0009), `focusRestoration.ts`/`changePoller.ts` (ADR-0010), `positions.ts`, `touchDrag.ts` (ADR-0011), `settings.ts`/`theme.ts` (ADR-0002/0013), `diff.ts` (ADR-0005), and the editor modules `schema.ts`, `proseEditor.ts`, `links.ts`, `autolink.ts`, `editorMenu.ts`, `tables.ts`, `tableIcons.ts` (ADR-0015–0017).
- Contexts: `LabelDrawerContext` (`useLabelDrawer`), `BoardHeaderContext` (`useBoardHeader`), wrapped in `App.tsx`.
- Inputs auto-focus with `ref={(el) => requestAnimationFrame(() => el.focus())}`, not `autofocus`. Focus styles use `:focus`, not `:focus-visible` (Safari/WebView).
- Card/label titles support `**bold**`/`*italic*` via `renderTitle()` (`innerHTML`; stored as markdown) and `handleMarkdownShortcut` on plain inputs.
- Board colour: `--board-color` set from `Board.tsx`; header uses a dark overlay, page background `color-mix` (ADR-0013). `BoardColorPicker` is a native colour input (live preview, commit on change, reset). Board rename is inline in the header (`BoardHeaderContext`, `commit-board-rename` event). The `.board-dock` pill must stay capped and scrollable (`max-width`, `overflow-x: auto`, active dot scrolled into view) — uncapped it hung off both edges past ~60 boards (`e2e/board.spec.ts`).

### Decisions index (`docs/adr/`)

| ADR | Topic |
|---|---|
| 0001 | JSON files, no database, `store/` |
| 0002 | Settings server-side (`synkban.toml`) |
| 0003 | Electron shell, token auth, title bar |
| 0004 | Attachments as sidecars + GC |
| 0005 | Card history snapshots |
| 0006 | Archive before delete |
| 0007 | Card content saved atomically |
| 0008 | Accelerator shortcuts, key selection |
| 0009 | Dialog focus & key ownership |
| 0010 | Refetch keeps focus & typing |
| 0011 | Native drag & drop |
| 0012 | PDF/A export |
| 0013 | Dark mode |
| 0014 | Labels |
| 0015 | Editor: document model & links |
| 0016 | Editor menu & text styles |
| 0017 | Editor tables |
| 0018 | Testing conventions |

## Data model (summary)

```
Board → Labels (per board) ; Board → Lists → Cards ; Card.label_ids → Label ids
```

IDs UUIDv4; `position: f64` fractional. Card fields: `title`, `description` (ProseMirror JSON **string**, `JSON.stringify` on save / `JSON.parse` on load), `label_ids`, `due_date` (`YYYY-MM-DD`), `checklist`, `archived`/`archived_at`, `history` (stripped from responses), `attachments` (from sidecars, not in card JSON). Board: `archived`, `position`, `color`, `labels`. New fields: `#[serde(default)]`.

```
data/boards/{board-id}/board.json
data/boards/{board-id}/lists/{list-id}/list.json
data/boards/{board-id}/lists/{list-id}/cards/{card-id}.json
data/boards/{board-id}/archived_cards/{card-id}.json
data/boards/{board-id}/attachments/{card-id}/{att-id}[ _thumb | .json ]
```

## API Endpoints

```
GET    /api/settings                          → SettingsResponse (startup_view, theme, last_board_id [self-healing: absent when the board no longer exists/is archived], data_dir, configured_data_dir, default_data_dir)
PUT    /api/settings  {startup_view?, theme?, last_board_id??, data_dir??}  → SettingsResponse — writes ~/.config/synkban/synkban.toml; theme ∈ {system,light,dark} (validated, 400 otherwise); double-Option fields (last_board_id/data_dir): null clears/reverts, absent leaves unchanged. data_dir change needs a restart to take effect.
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
PUT    /api/boards/:bid/labels/order {ids: string[]} → 204 — reorder labels (unlisted ids keep relative order at the end, unknown ids ignored)
DELETE /api/labels/:id                       → 204

POST   /api/boards/:bid/lists {title}        → List (201)
PUT    /api/lists/:id    {title?,pos?}       → List
DELETE /api/lists/:id                        → 204

GET    /api/boards/:bid/archive              → Card[] (archived cards, sorted by archival date desc)

POST   /api/lists/:lid/cards {title}         → Card (201)
PUT    /api/cards/:id  {title?,desc?,pos?,list_id?,label_ids?,archived?,due_date?,checklist?} → Card
DELETE /api/cards/:id                        → 204

GET    /api/cards/:id/history                 → { current: CardContent, entries: HistoryEntry[] } (newest first, ≤100)
GET    /api/cards/:id/pdf                     → application/pdf (PDF/A-2u, Content-Disposition: attachment, filename from the card title)

POST   /api/cards/:cid/attachments?filename=… → Attachment (201) — raw body bytes, Content-Type header
GET    /api/cards/:cid/attachments/:att_id    → binary (Content-Disposition: attachment)
GET    /api/cards/:cid/attachments/:att_id/thumb → JPEG thumbnail (404 if not image)
DELETE /api/cards/:cid/attachments/:att_id    → 204
```

## Adding things

- **Backend endpoint:** types in `models.rs` → store function (re-export in `store/mod.rs`) → handler in `handlers/*.rs` → route in `main.rs` → `cargo build` (zero warnings) → integration test.
- **Frontend page:** component in `pages/`, route in `index.tsx`, `api.ts`/`types.ts` as needed.
- **Frontend component:** `components/`, styles in `app.css`, import in parent.
- **Data model change:** `models.rs` → `types.ts` → store read/write → `api.ts`; document breaking changes; consider PDF/diff/filter (ADR-0012, 0005).
- **Shortcut:** ADR-0008 checklist (tooltip, help dialog, tooltips spec).

## Common pitfalls

- Reading an errored SolidJS resource throws; guard it in effects (ADR-0010).
- Position gaps are fine; don't normalise.
- A card/list lookup scans directories (no index).
- Code that rewrites a card must use `read_card` (keeps history, ADR-0005).

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

Single-context: `UBIQUITOUS_LANGUAGE.md` (domain glossary) + `docs/adr/` at repo root. See `docs/agents/domain.md`.
