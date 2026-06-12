import { api } from "./api";

export interface ChangePollerOptions {
  /// Called when the watched mtime changed since the last tick.
  onChange: () => void | Promise<void>;
  /// Skip the whole tick (no request, mtime memory untouched) — the next tick
  /// re-checks. Used while local writes are still in flight so a poll refetch
  /// can't clobber optimistic state.
  shouldSkip?: () => boolean;
  /// Pick the watched mtime from the /api/changes response. Defaults to the
  /// global mtime; the Board page watches its own board's entry instead so
  /// quiet boards don't refetch when another board changes.
  select?: (res: { mtime: number; boards: Record<string, number> }) => number;
  intervalMs?: number;
}

/// Owns the mtime-poll protocol shared by the Home and Board pages: a fixed
/// interval, the remembered last mtime, error swallowing (server restarts,
/// offline), and skip policy. Callers only say what "changed" means for them
/// (`select`) and what to do about it (`onChange`).
///
/// Returns a stop function — call it on cleanup.
export function startChangePoller(opts: ChangePollerOptions): () => void {
  let last = 0;
  const id = setInterval(async () => {
    if (opts.shouldSkip?.()) return;
    try {
      const res = await api.checkChanges();
      const mtime = opts.select?.(res) ?? res.mtime;
      if (mtime !== last) {
        last = mtime;
        await opts.onChange();
      }
    } catch {
      // Poll errors are expected (offline, server mid-restart) — retry next tick.
    }
  }, opts.intervalMs ?? 15000);
  return () => clearInterval(id);
}
