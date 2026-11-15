/// Due dates (`YYYY-MM-DD`, local days): display and keyboard entry.
/// Relative wording only within a week; further out the date says more.

export type DueTone = "overdue" | "today" | "soon" | "future";

export interface DueInfo {
  /// Days from today (negative: overdue).
  days: number;
  tone: DueTone;
  /// Card badge: "Today", "in 3d", "Nov 28", "Overdue 3d", "Overdue · Nov 2".
  short: string;
  /// Card detail: the date, with the relative part within a week.
  long: string;
}

const DAY = 86_400_000;
/// Relative wording up to this many days either way.
export const RELATIVE_DAYS = 7;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/// Local date of an ISO day, or null if it isn't a real one ("2026-02-30").
export function parseIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);

function formatDate(d: Date, today: Date, locale?: string, weekday = false): string {
  return d.toLocaleDateString(locale, {
    weekday: weekday ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function dueInfo(iso: string | null | undefined, today = new Date(), locale?: string): DueInfo | null {
  const due = iso ? parseIso(iso) : null;
  if (!due) return null;
  const days = daysBetween(today, due);
  const date = formatDate(due, today, locale);
  const long = formatDate(due, today, locale, true);
  const near = Math.abs(days) <= RELATIVE_DAYS;
  if (days < 0) {
    return near
      ? { days, tone: "overdue", short: `Overdue ${-days}d`, long: `${long} · overdue ${plural(-days)}` }
      : { days, tone: "overdue", short: `Overdue · ${date}`, long: `${long} · overdue` };
  }
  if (days === 0) return { days, tone: "today", short: "Today", long: `${long} · today` };
  if (days === 1) return { days, tone: "soon", short: "Tomorrow", long: `${long} · tomorrow` };
  return near
    ? { days, tone: "future", short: `in ${days}d`, long: `${long} · in ${plural(days)}` }
    : { days, tone: "future", short: date, long };
}

/// Typed entry in the date picker: `YYYY-MM-DD`, `today`, `tomorrow`, or an
/// offset `+3` / `+3d` / `+2w` / `-1d`. Null when not understood.
export function parseDueInput(text: string, today = new Date()): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const iso = parseIso(t);
  if (iso) return toIso(iso);
  if ("today".startsWith(t) && t.length >= 3) return toIso(startOfDay(today));
  if ("tomorrow".startsWith(t) && t.length >= 3) return toIso(addDays(today, 1));
  const m = /^([+-])\s*(\d{1,4})\s*([dw]?)$/.exec(t);
  if (m) {
    const n = +m[2] * (m[3] === "w" ? 7 : 1) * (m[1] === "-" ? -1 : 1);
    return toIso(addDays(today, n));
  }
  return null;
}

/// First day of the week for the UI locale (0 = Sunday), Monday if unknown.
export function firstDayOfWeek(locale = navigator.language): number {
  try {
    const l = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay;
    if (first) return first % 7; // Intl: 1 = Monday … 7 = Sunday
  } catch {
    // unknown locale
  }
  return 1;
}

/// The 6×7 days shown for `month` (any day in it), starting on `firstDay`.
export function monthGrid(month: Date, firstDay: number): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() - firstDay + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/// Same day of the month `n` months on, clamped to its last day (Jan 31 + 1 → Feb 28).
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}
