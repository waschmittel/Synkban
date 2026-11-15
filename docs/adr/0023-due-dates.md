# Due dates: worded like the badge, own keyboard-first picker

The due date reads the same everywhere (`dueDate.ts`, unit-tested): **relative only within a week**, the date beyond that.

| Days from today | Card badge | Card detail chip |
|---|---|---|
| 0 / 1 | Today / Tomorrow | Tue, Nov 17 · today |
| 2–7 | in 3d | Fri, Nov 20 · in 3 days |
| > 7 | Nov 28 | Sat, Nov 28 |
| −1 … −7 | Overdue 3d | Sat, Nov 14 · overdue 3 days |
| < −7 | Overdue · Nov 2 | Mon, Nov 2 · overdue |

The year shows only when it isn't this year; dates use the browser locale. Tones (overdue / today / soon / future) colour badge and chip alike.

## Why

"in 43d" or "Overdue 120d" makes the reader do arithmetic; past a week the date itself is the useful fact. The native date input differs per platform (Electron, Safari, Chrome), can't be typed into consistently, and its `showPicker()` needs a user gesture.

## Rules

- **The detail shows a chip** (`DueDateSection`), "Set due date" when empty, plus a clear ×. Click, `Enter` or `Accel+U` opens **`DuePicker`**, portaled to `body` (the dialog body would clip it), registered via `focusTrap` so the card's trap yields.
- **Typing first:** the picker opens on a text field accepting `YYYY-MM-DD`, `today`/`tomorrow` (3+ letters), `+3`/`+3d`/`+2w`/`-1d`; Enter sets it, nonsense is marked invalid, empty Enter clears. `↓` enters the month grid: arrows ±day/week, `PgUp/PgDn` ±month (`Shift`: year), `Home/End` week start/end (locale's first weekday), `Enter`/`Space` pick. Quick buttons: Today, Tomorrow, Next week, Clear.
- The picker owns its keys via `dialogKeys`: `Esc` closes only the picker and returns focus to the chip; a card shortcut (`Accel+S`, `+G`, …) closes it and is re-sent from the chip (closing detaches the original event's target, so it would never reach the card). A pointer outside closes it.
- Stored value unchanged: `YYYY-MM-DD`, validated server-side (ADR-0007).

## Considered and rejected

- **Native `<input type="date">` + `showPicker()`** (the previous design): inconsistent across platforms, no typed shortcuts, and the visible ISO text field duplicated the badge's information less readably.
- **Relative wording at any distance** — see Why.
