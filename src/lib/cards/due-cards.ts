// src/lib/cards/due-cards.ts
// Pure due-card selection for the spaced-repetition deck.
//
// Reuses the canonical `isCardDue` from `@/lib/state/sr` — the SR "is it due?"
// rule lives there (now - lastTested >= intervalDays) and must not be
// reimplemented. This module only joins parsed Flashcards to their per-card
// FlashcardState and applies that rule.
//
// Rule: a card with NO FlashcardState entry has never been reviewed in-app and
// is therefore always due.

import type { FlashcardState } from '@/lib/types';
import { isCardDue } from '@/lib/state/sr';
import type { Flashcard } from '@/lib/cards/parse-flashcards';

export interface DueCard {
  card: Flashcard;
  state: FlashcardState;
}

// Synthetic state for a card that has never been reviewed in-app. lastTested ''
// makes `isCardDue` treat it as never-tested ⇒ due (sr.ts handles the empty
// string), and seeds a fresh 7-day interval for the first review.
const DEFAULT_STATE: FlashcardState = { lastTested: '', intervalDays: 7, ease: 'good' };

/**
 * Return all cards due for review as of `now`.
 * A card is due when it has no state entry (never reviewed) or when its existing
 * FlashcardState is due per `isCardDue`.
 */
export function dueCards(
  cards: Flashcard[],
  stateMap: Record<string, FlashcardState>,
  now: Date = new Date(),
): DueCard[] {
  const due: DueCard[] = [];
  for (const card of cards) {
    const existing = stateMap[card.id];
    if (!existing) {
      // Never reviewed in-app → always due.
      due.push({ card, state: { ...DEFAULT_STATE } });
      continue;
    }
    if (isCardDue(existing, now)) {
      due.push({ card, state: existing });
    }
  }
  return due;
}

/** Count due cards. Used by the homepage TopBar; thin wrapper over `dueCards`. */
export function countDueCards(
  cards: Flashcard[],
  stateMap: Record<string, FlashcardState>,
  now: Date = new Date(),
): number {
  return dueCards(cards, stateMap, now).length;
}
