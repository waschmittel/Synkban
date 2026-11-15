import { describe, expect, it } from "vitest";
import { addMonths, dueInfo, firstDayOfWeek, monthGrid, parseDueInput, parseIso, toIso } from "./dueDate";

const today = new Date(2026, 10, 17); // Tue, Nov 17 2026
const info = (iso: string) => dueInfo(iso, today, "en-US");

describe("dueInfo", () => {
  it("is null for missing or invalid dates", () => {
    expect(dueInfo(null, today)).toBeNull();
    expect(dueInfo("", today)).toBeNull();
    expect(dueInfo("2026-02-30", today)).toBeNull();
    expect(dueInfo("17.11.2026", today)).toBeNull();
  });

  it("today and tomorrow", () => {
    expect(info("2026-11-17")).toMatchObject({ days: 0, tone: "today", short: "Today", long: "Tue, Nov 17 · today" });
    expect(info("2026-11-18")).toMatchObject({ days: 1, tone: "soon", short: "Tomorrow", long: "Wed, Nov 18 · tomorrow" });
  });

  it("relative up to 7 days ahead, then the date", () => {
    expect(info("2026-11-24")).toMatchObject({ days: 7, tone: "future", short: "in 7d", long: "Tue, Nov 24 · in 7 days" });
    expect(info("2026-11-25")).toMatchObject({ days: 8, short: "Nov 25", long: "Wed, Nov 25" });
  });

  it("overdue: days within a week, else overdue and the date", () => {
    expect(info("2026-11-16")).toMatchObject({ days: -1, tone: "overdue", short: "Overdue 1d", long: "Mon, Nov 16 · overdue 1 day" });
    expect(info("2026-11-10")).toMatchObject({ days: -7, short: "Overdue 7d", long: "Tue, Nov 10 · overdue 7 days" });
    expect(info("2026-11-09")).toMatchObject({ days: -8, short: "Overdue · Nov 9", long: "Mon, Nov 9 · overdue" });
  });

  it("shows the year only when it differs", () => {
    expect(info("2027-01-05")!.short).toBe("Jan 5, 2027");
    expect(info("2025-12-31")!.short).toBe("Overdue · Dec 31, 2025");
  });

  it("counts calendar days across DST changes", () => {
    expect(dueInfo("2026-03-30", new Date(2026, 2, 28, 23, 30), "en-US")!.days).toBe(2);
    expect(dueInfo("2026-10-26", new Date(2026, 9, 24, 0, 30), "en-US")!.days).toBe(2);
  });
});

describe("parseDueInput", () => {
  it.each([
    ["2026-12-01", "2026-12-01"],
    [" 2026-12-01 ", "2026-12-01"],
    ["today", "2026-11-17"],
    ["tod", "2026-11-17"],
    ["Tomorrow", "2026-11-18"],
    ["tom", "2026-11-18"],
    ["+3", "2026-11-20"],
    ["+3d", "2026-11-20"],
    ["+2w", "2026-12-01"],
    ["-1d", "2026-11-16"],
    ["+20", "2026-12-07"],
  ])("%s → %s", (input, out) => expect(parseDueInput(input, today)).toBe(out));

  it.each(["", "to", "2026-13-01", "2026-02-29", "next week", "+", "3"])("rejects %j", (input) =>
    expect(parseDueInput(input, today)).toBeNull(),
  );
});

describe("calendar helpers", () => {
  it("parseIso/toIso round-trip", () => {
    expect(toIso(parseIso("2028-02-29")!)).toBe("2028-02-29");
  });

  it("monthGrid starts on the week's first day and covers the month", () => {
    const mon = monthGrid(today, 1);
    expect(mon).toHaveLength(42);
    expect(toIso(mon[0])).toBe("2026-10-26"); // Monday before Nov 1 (a Sunday)
    const sun = monthGrid(today, 0);
    expect(toIso(sun[0])).toBe("2026-11-01");
  });

  it("addMonths clamps to the month's last day", () => {
    expect(toIso(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28");
    expect(toIso(addMonths(new Date(2026, 0, 31), -2))).toBe("2025-11-30");
  });

  it("firstDayOfWeek follows the locale", () => {
    expect(firstDayOfWeek("de-DE")).toBe(1);
    expect(firstDayOfWeek("en-US")).toBe(0);
    expect(firstDayOfWeek("not a locale!")).toBe(1);
  });
});
