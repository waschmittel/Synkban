import { describe, it, expect, vi } from "vitest";
import { createMutationQueue } from "./mutationQueue";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createMutationQueue", () => {
  it("runs ops strictly one at a time, in order", async () => {
    const q = createMutationQueue();
    const first = deferred<void>();
    const events: string[] = [];

    q.enqueue(() => {
      events.push("a:start");
      return first.promise;
    });
    q.enqueue(async () => {
      events.push("b:start");
    });

    await Promise.resolve();
    expect(events).toEqual(["a:start"]); // b must wait for a

    first.resolve();
    await q.flush();
    expect(events).toEqual(["a:start", "b:start"]);
  });

  it("a rejected op does not stall later ops", async () => {
    const q = createMutationQueue();
    const ran = vi.fn();
    q.enqueue(() => Promise.reject(new Error("boom")));
    q.enqueue(async () => ran());
    await q.flush();
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("flush resolves only after everything enqueued so far settled", async () => {
    const q = createMutationQueue();
    const slow = deferred<void>();
    let flushed = false;

    q.enqueue(() => slow.promise);
    const f = q.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    expect(flushed).toBe(false);

    slow.resolve();
    await f;
    expect(flushed).toBe(true);
  });

  it("flush never rejects, even when the chain ends in a rejection", async () => {
    const q = createMutationQueue();
    q.enqueue(() => Promise.reject(new Error("boom")));
    await expect(q.flush()).resolves.toBeUndefined();
  });
});
