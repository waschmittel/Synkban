import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startChangePoller } from "./changePoller";
import { api } from "./api";

describe("startChangePoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const respond = (mtime: number, boards: Record<string, number> = {}) =>
    vi.spyOn(api, "checkChanges").mockResolvedValue({ mtime, boards });

  it("fires onChange when the mtime changes, not on every tick", async () => {
    const check = respond(1);
    const onChange = vi.fn();
    const stop = startChangePoller({ onChange, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Same mtime — no further onChange.
    await vi.advanceTimersByTimeAsync(200);
    expect(onChange).toHaveBeenCalledTimes(1);

    check.mockResolvedValue({ mtime: 2, boards: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("shouldSkip suppresses the tick without consuming the change", async () => {
    respond(7);
    const onChange = vi.fn();
    let busy = true;
    const stop = startChangePoller({ onChange, shouldSkip: () => busy, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).not.toHaveBeenCalled();

    // Once no longer busy, the change is still picked up.
    busy = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("select picks the watched mtime (per-board)", async () => {
    const check = respond(1, { b1: 5, b2: 9 });
    const onChange = vi.fn();
    const stop = startChangePoller({
      onChange,
      select: (r) => r.boards["b1"] ?? r.mtime,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Another board changes — global mtime moves, watched board doesn't.
    check.mockResolvedValue({ mtime: 2, boards: { b1: 5, b2: 11 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);

    check.mockResolvedValue({ mtime: 3, boards: { b1: 6, b2: 11 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("swallows request errors and retries on the next tick", async () => {
    const check = vi.spyOn(api, "checkChanges").mockRejectedValue(new Error("offline"));
    const onChange = vi.fn();
    const stop = startChangePoller({ onChange, intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(200);
    expect(onChange).not.toHaveBeenCalled();

    check.mockResolvedValue({ mtime: 4, boards: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stop() ends polling", async () => {
    respond(1);
    const onChange = vi.fn();
    const stop = startChangePoller({ onChange, intervalMs: 100 });
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(onChange).not.toHaveBeenCalled();
  });
});
