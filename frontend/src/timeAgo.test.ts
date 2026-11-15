import { describe, expect, it } from "vitest";
import { timeAgo } from "./timeAgo";

const now = new Date(2026, 10, 17, 12, 0).getTime();
const ago = (sec: number) => timeAgo(now - sec * 1000, now, "en-US");

describe("timeAgo", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [-30, "just now"], // clock skew
    [60, "1 min. ago"],
    [59 * 60, "59 min. ago"],
    [3600, "1 hr. ago"],
    [23 * 3600, "23 hr. ago"],
    [86400, "yesterday"],
    [6 * 86400, "6 days ago"],
    [7 * 86400, "Nov 10"],
  ])("%is → %s", (sec, out) => expect(ago(sec)).toBe(out));

  it("shows the year for older years", () => {
    expect(timeAgo(new Date(2025, 0, 2).getTime(), now, "en-US")).toBe("Jan 2, 2025");
  });
});
