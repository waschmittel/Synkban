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

function focusCard(selector: (cardId: string) => string, cardId: string) {
  (document.querySelector(selector(cardId)) as HTMLElement | null)?.focus();
}

export function createFocusRestoration(
  watch: Accessor<unknown>,
  selector: (cardId: string) => string = (id) => `[data-card-id="${id}"]`,
): FocusRestoration {
  const [pending, setPending] = createSignal<string | null>(null);
  const [lastFocused, setLastFocused] = createSignal<string | null>(null);

  createEffect(() => {
    // Reading an errored resource throws; an uncaught throw here would abort
    // the whole effect-queue run and silently kill *later* effects watching
    // the same resource. Nothing to restore focus onto anyway.
    try {
      watch();
    } catch {
      return;
    }
    const cardId = untrack(pending);
    if (!cardId) return;
    setPending(null);
    // Synchronously first: a user effect runs with the DOM already patched, and
    // deferring the whole restore to the next frame leaves one frame where
    // focus sits on <body> — long enough to swallow a fast follow-up keypress
    // (a second Shift+Arrow lands nowhere and the card doesn't move). The rAF
    // stays as a fallback for nodes that only exist a frame later.
    focusCard(selector, cardId);
    requestAnimationFrame(() => focusCard(selector, cardId));
  });

  const preserve = (cardId: string) => {
    setPending(cardId);
    requestAnimationFrame(() => focusCard(selector, cardId));
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
