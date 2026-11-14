# Settings live server-side in `synkban.toml`

User settings (`data_dir`, `startup_view`, `last_board_id`, `theme`) are stored in `~/.config/synkban/synkban.toml` (dir overridable with `SYNKBAN_CONFIG_DIR`) and served by `GET`/`PUT /api/settings`. `config.rs` owns it (`load()`/`update(mutate)` behind a process-wide mutex) in every mode. It is the only file I/O outside `store/`, and it sits outside the data dir on purpose.

## Why

The desktop shell serves the UI from a random port each launch; `localStorage` is per-origin (scheme+host+port), so client-side persistence never survives a restart. A broken custom `data_dir` must not strand the setting that fixes it, hence the config lives outside the data dir.

## Consequences

- Data directory resolution: `--data-dir` > `DATA_DIR` env > `data_dir` in the config > `~/.config/synkban/data`. Changing the folder in Settings writes the config and relaunches (desktop); existing data is not moved.
- `PUT` uses double-Option for `last_board_id`/`data_dir` (null clears, absent keeps); `theme` is validated (`system|light|dark`, else 400). `GET` self-heals: `last_board_id` is omitted when the board no longer exists or is archived.
- **Startup view:** `index.tsx::bootstrap` fetches settings only on `/` and rewrites to `/board/<id>` with `history.replaceState` before the router starts — only a fresh load bounces, deep links win, the query string (`?token=`) survives. `Board.tsx` records the id once per page load (deduped).
- **Settings dialog:** edits are buffered until Save (single `PUT`); Cancel/Escape/X/overlay discard. Exception: the theme radios preview live and every discard path reverts (ADR-0013). Rendered as a sibling of the header (the header is the Electron drag region).
- The settings e2e spec runs against a dedicated server (:8092) because settings are global state (ADR-0018).
