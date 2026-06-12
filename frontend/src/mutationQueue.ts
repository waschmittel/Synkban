export interface MutationQueue {
  /// Append an operation. It starts only after every previously enqueued
  /// operation has settled (resolved or rejected).
  enqueue: (op: () => Promise<unknown>) => void;
  /// Resolves once everything enqueued so far has settled. Never rejects.
  flush: () => Promise<void>;
}

/// Serializes writes against a single backend resource. The card file is
/// read-modify-written as a whole on the server, so overlapping requests
/// clobber each other — ops are optimistic in the UI but must hit the server
/// one at a time. A failed op doesn't stall the queue: later ops still run.
export function createMutationQueue(): MutationQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue(op) {
      tail = tail.then(op, op);
    },
    flush() {
      return tail.then(
        () => undefined,
        () => undefined
      );
    },
  };
}
