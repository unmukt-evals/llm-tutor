// src/lib/cards/review-queue.ts
// Pure queue-advancement logic for the flashcard review loop.
//
// The FlashcardReview component is a thin shell over this helper: it owns no
// branching about "is there a next card?" — it just calls `advanceQueue` after
// each self-graded recall and renders the returned phase. Keeping this pure
// means the loop logic is unit-tested in isolation, with no React render.

export type ReviewPhase = 'front' | 'back' | 'done';

export interface ReviewQueueState {
  /** Index of the card currently under review (meaningless once phase === 'done'). */
  index: number;
  /** Whether the front or back is shown — or the deck is exhausted. */
  phase: ReviewPhase;
}

/** The starting state for a deck of `total` due cards. */
export function initialQueueState(total: number): ReviewQueueState {
  return total > 0 ? { index: 0, phase: 'front' } : { index: 0, phase: 'done' };
}

/** Reveal the back of the current card. No-op once the deck is done. */
export function revealBack(current: ReviewQueueState): ReviewQueueState {
  if (current.phase === 'done') return current;
  return { index: current.index, phase: 'back' };
}

/**
 * Advance to the next card after grading the current one.
 * If the graded card was the last in the deck, the queue is `done`; otherwise
 * the next card is shown front-first.
 */
export function advanceQueue(
  current: ReviewQueueState,
  total: number,
): ReviewQueueState {
  const nextIndex = current.index + 1;
  if (nextIndex >= total) {
    return { index: current.index, phase: 'done' };
  }
  return { index: nextIndex, phase: 'front' };
}
