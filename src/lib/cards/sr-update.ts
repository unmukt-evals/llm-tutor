// src/lib/cards/sr-update.ts
// Pure SR state transition on recall, plus the matching /api/state PATCH shape.
//
// Reuses the canonical `nextSrInterval` from `@/lib/state/sr` (interval
// progression 7→14→30 on 'good', reset to 7 on 'again', stamps lastTested).
// Do NOT reimplement that schedule here. This module is the thin card-layer
// wrapper that keeps the pure transform separate from IO: the actual write
// happens via the api-client `patchState`, fed by `srPatch`.

import type { FlashcardState } from '@/lib/types';
import { nextSrInterval } from '@/lib/state/sr';

export type Recall = 'again' | 'good';

/**
 * Compute the next FlashcardState after a recall attempt. Pure; returns a new
 * object and never mutates the input. Delegates the schedule to `nextSrInterval`.
 */
export function applyRecall(
  current: FlashcardState,
  recall: Recall,
  now: Date = new Date(),
): FlashcardState {
  return nextSrInterval(current, recall, now);
}

export interface SrPatch {
  path: ['flashcards', string];
  value: FlashcardState;
}

/**
 * Build the `/api/state` PATCH descriptor for persisting a recall result.
 * Pairs with `patchState(patch.path, patch.value)` in the api-client — keeps the
 * pure transform (`applyRecall`) decoupled from the network call.
 */
export function srPatch(
  cardId: string,
  current: FlashcardState,
  recall: Recall,
  now: Date = new Date(),
): SrPatch {
  return {
    path: ['flashcards', cardId],
    value: applyRecall(current, recall, now),
  };
}
