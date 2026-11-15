/// "just now", "5 min ago", "3 hr ago", "yesterday", "4 days ago"; older: the date.
export function timeAgo(ms: number, now = Date.now(), locale?: string): string {
  const s = Math.max(0, (now - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  const days = Math.floor(s / 86400);
  if (days < 7) return rtf.format(-days, "day");
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
