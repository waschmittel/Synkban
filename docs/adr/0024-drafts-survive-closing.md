# Crash safety: the open card's unsaved edits survive the app closing

Only one card can be open (dialog or Notes pane). While it is **dirty**, its edits are **the draft** — a single one per machine: `PUT /api/draft/:card_id` (debounced 300 ms, and once more with `keepalive` on `pagehide`) replaces whatever was there. Saving, reverting to the stored content or discarding drops it (`DELETE /api/draft/:card_id`, which only removes that card's draft). **Starting the app** (a load of `/`) with a draft goes to its board instead of the startup view (`index.tsx`); the board reopens the card from the edits, with a "Restored your unsaved edits … Discard" banner — **only if the card is unchanged since the draft began** (`base` equals the stored content, `cardContent.ts::draftCard`); otherwise, or if its board or card is gone, the draft is deleted.

## Why

Closing the window, a crash or a reload lost everything typed since the last Save. It's crash safety, not a stash: there is never more than the one card being edited. Restoring over a card someone changed meanwhile (another instance, a sync) would undo their change on the next Save, so such a draft is dropped.

## Rules

- **Per machine, outside the data dir:** `config_dir()/draft.json` (`drafts.rs`), beside `synkban.toml`, never synced. Not localStorage: the desktop shell's random port changes the origin every launch (ADR-0002). Card ids are checked (`[A-Za-z0-9-]`, ≤ 64), the write is atomic, an unreadable file counts as none. Draft requests aren't logged (they come while typing).
- **The server stores the client's JSON** (`{card_id, board_id, base, draft, saved_at}`; `base`/`draft` are `DraftContent`, the normalised content `CardDetail` compares for dirtiness). Content only: attachments save immediately anyway (ADR-0004).
- An in-app close (Save, Discard, Revert, typing back to the stored text) drops the draft; only an unload keeps it — Solid cleanups don't run then.
- Only app start follows the draft; a board URL (reload, link) stays where it is, and that board reopens the draft's card only if the draft is its own.
- `CardDetail` reads `props.draft` **once**: the board hands it out a single time (`takeDraft`), so a later remount starts from the stored card.
- **Tests:** `SYNKBAN_DRAFTS=0` turns drafts off; the shared e2e servers use it (a test ending dirty would redirect another's start), `drafts.spec.ts` has its own server (ADR-0018).

## Considered and rejected

- **A draft per card** (the first version) — this is crash safety for the one open card, not a set of stashed edits.
- **localStorage** — lost on every desktop restart (random port).
- **The draft in the data dir** — would sync half-typed edits to other machines.
- **Restoring regardless of later changes** (with a conflict banner) — changed elsewhere means the draft is stale.
