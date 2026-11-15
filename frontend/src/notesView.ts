// Pure selection rules of the Notes mode (ADR-0022): which list is active and
// which card the detail pane shows after a selection change or a refetch.

import type { ListWithCards } from "./types";

/// First of `preferred` that is a card of `list`, else its first card, else null.
export function pickCard(
  list: ListWithCards | undefined,
  ...preferred: (string | null | undefined)[]
): string | null {
  if (!list) return null;
  for (const id of preferred) if (id && list.cards.some((c) => c.id === id)) return id;
  return list.cards[0]?.id ?? null;
}

/// The list holding card `cardId`, if any.
export const listOfCard = (lists: ListWithCards[], cardId: string | null | undefined) =>
  cardId ? lists.find((l) => l.cards.some((c) => c.id === cardId)) : undefined;

export interface Selection {
  listId: string | null;
  cardId: string | null;
  /// The selected card is gone from the board but its dirty edits are kept.
  removed: boolean;
}

/// Re-resolve the selection against a (re)fetched board.
/// - A card that still exists wins and pulls the active list along (moved
///   elsewhere, or moved by the user).
/// - A vanished card stays selected (`removed`) while it has unsaved edits;
///   otherwise its old index in the active list picks the replacement.
/// - A vanished list falls back to the first list.
export function resolveSelection(
  lists: ListWithCards[],
  prev: { listId: string | null; cardId: string | null; index: number },
  dirty: boolean,
): Selection {
  const holder = listOfCard(lists, prev.cardId);
  if (holder) return { listId: holder.id, cardId: prev.cardId, removed: false };
  const list = lists.find((l) => l.id === prev.listId) ?? lists[0];
  if (prev.cardId && dirty) return { listId: list?.id ?? null, cardId: prev.cardId, removed: true };
  if (!list) return { listId: null, cardId: null, removed: false };
  const cards = list.cards;
  const cardId = cards.length ? cards[Math.min(Math.max(prev.index, 0), cards.length - 1)].id : null;
  return { listId: list.id, cardId: prev.cardId ? cardId : pickCard(list), removed: false };
}

/// Neighbour list in `dir` from `listId`, no wrap-around.
export function adjacentList(lists: ListWithCards[], listId: string | null, dir: -1 | 1) {
  const i = lists.findIndex((l) => l.id === listId);
  return i < 0 ? undefined : lists[i + dir];
}
