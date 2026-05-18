/// Pure helpers for fractional-position math used by drag-drop and keyboard moves.
/// Extracted from Card.tsx / Board.tsx for testability.

/// Position when moving a card one slot down within the same list.
/// `nextPos` is the position of the card currently after it; `afterNextPos`
/// is the one after that (undefined if there isn't one — moving to the end).
export function withinListMoveDown(nextPos: number, afterNextPos: number | undefined): number {
  const p2 = afterNextPos ?? nextPos + 2;
  return (nextPos + p2) / 2;
}

/// Position when moving a card one slot up within the same list.
/// `prevPos` is the position of the card currently before it; `beforePrevPos`
/// is the one before that (undefined if there isn't one — moving to the start).
export function withinListMoveUp(prevPos: number, beforePrevPos: number | undefined): number {
  const p1 = beforePrevPos ?? 0;
  return (p1 + prevPos) / 2;
}

/// Position when moving a card to an adjacent list, preserving its index where possible.
/// `adjPositions` are positions of cards in the target list, sorted ascending.
/// `currentIdx` is the source card's index in its current list.
export function crossListInsertPosition(adjPositions: number[], currentIdx: number): number {
  if (adjPositions.length === 0) return 1;
  if (currentIdx <= 0) return adjPositions[0] / 2;
  if (currentIdx >= adjPositions.length) return adjPositions[adjPositions.length - 1] + 1;
  return (adjPositions[currentIdx - 1] + adjPositions[currentIdx]) / 2;
}

/// Position when dropping a list at `insertIndex` into a sequence of lists
/// with the given positions (sorted ascending, dragged list excluded).
export function listDropPosition(positions: number[], insertIndex: number): number {
  if (positions.length === 0) return 1;
  if (insertIndex <= 0) return positions[0] / 2;
  if (insertIndex >= positions.length) return positions[positions.length - 1] + 1;
  return (positions[insertIndex - 1] + positions[insertIndex]) / 2;
}
