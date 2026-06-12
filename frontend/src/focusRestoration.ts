import { createSignal, createEffect, untrack, type Accessor } from "solid-js";

/// Owns the small state machine that keeps a card focused across SolidJS
/// resource refetches and async DOM recreations.
///
/// Callers tell it which card *should* be focused (`preserve`, `restore`,
/// `capturePending`); a single `createEffect` then re-applies focus once the
/// watched resource resolves. Centralising this in one module means move,
/// archive, polling and save handlers don't each open-code their own
/// `setPendingFocusCardId` + `createEffect` pair — they just say
/// "preserve focus on this card" and stop caring.
export interface FocusRestoration {
  /// Card the user most recently interacted with. Read by board-area click
  /// handlers that want to re-focus the last card after clicking empty space.
  lastFocused: Accessor<string | null>;
  setLastFocused: (cardId: string | null) => void;
  /// Schedule focus restoration on a card by id. Tries immediately (covers the
  /// "no refetch happens" path) AND queues a follow-up after the next resource
  /// update (covers the "DOM recreates from refetch" path).
  preserve: (cardId: string) => void;
  /// Capture whatever card currently has focus and preserve it. Use right
  /// before triggering a polling refetch so focus survives DOM recreation.
  capturePending: () => void;
}

export function createFocusRestoration(
  watch: Accessor<unknown>,
  selector: (cardId: string) => string = (id) => `[data-card-id="${id}"]`,
): FocusRestoration {
  const [pending, setPending] = createSignal<string | null>(null);
  const [lastFocused, setLastFocused] = createSignal<string | null>(null);

  createEffect(() => {
    watch();
    const cardId = untrack(pending);
    if (!cardId) return;
    setPending(null);
    requestAnimationFrame(() => {
      (document.querySelector(selector(cardId)) as HTMLElement | null)?.focus();
    });
  });

  const preserve = (cardId: string) => {
    setPending(cardId);
    requestAnimationFrame(() => {
      (document.querySelector(selector(cardId)) as HTMLElement | null)?.focus();
    });
  };

  return {
    lastFocused,
    setLastFocused,
    preserve,
    capturePending: () => {
      const active = document.activeElement as HTMLElement | null;
      const cardId = active?.dataset.cardId;
      if (cardId) setPending(cardId);
    },
  };
}
