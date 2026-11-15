# Quick-add tokens; collapsed lists; due filter

## Quick-add

A new card's title may carry **`#label`** and **`due:…`** tokens: "Pay invoice #finance due:fri". `quickAdd.ts::parseQuickAdd` takes them out of the title; a live preview under the input shows the labels (dashed: to be created) and the due date. `#` must start a word and be followed by a letter (`#42` stays text); `due:` takes anything the date picker's field takes (ADR-0023, plus weekdays: the next one after today); a token that doesn't parse stays in the title. Only tokens and no title: not submitted ("Needs a title"). The card is created with labels and due date in one request (`POST /api/lists/:lid/cards {title, label_ids, due_date}`), no extra history entry.

**Labels match loosely** (ADR-0014): `labelKey` ignores case, whitespace and dashes ("In Progress" = `#in-progress`), in the frontend and in `store::labels::label_key`; `create_label` returns the existing label (200) instead of a duplicate.

## Collapsed lists

A board-view list can collapse into a 44 px strip (`List.collapsed`, stored in `list.json`, synced like the board's `mode`): count and vertical title; **"Add list" is the same strip** until opened. The strip is a button (`Enter` expands, focus to the title; collapsing focuses the strip); **`c`** collapses/expands the list holding the focus (board view only), part of `←/→` card navigation (`listFocus.ts::focusListEntry`), a drop target, and `Shift+←/→` moves a card onto it (end of list). Notes mode ignores it (lists are tabs). Every list header shows its card count ("shown/total" while filtering).

## Due filter

Beside text and labels: **Overdue** (before today), **This week** (the locale's calendar week) or **Until** a day chosen in the date picker (due on or before it, overdue included). One **button group** — a single outline, straight full-height separators, only the outer ends rounded; the selected segment fills its cell (the group clips it) — so only one can be selected; clicking the selected one clears it. AND with the rest, remembered with the filter (ADR-0021). Undated cards never match.

## Why

Typing a card with its label and date beats opening it three times. Loose label matching keeps "Bug", "bug" and "b-u-g" from becoming three labels. Collapsing gives finished or parked lists their screen width back; a 286 px dashed "Add list" column wasted the same.

## Considered and rejected

- **Collapse state per tab (sessionStorage)** — lost on desktop restart; per-device storage would need another config file for a minor preference.
- **"No date" filter** — not wanted.
- **"On a day"** (exact date) — "what's due by Friday" is the useful question.
- **`#` for any word** — would eat issue numbers.
