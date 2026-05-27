import type { FlashcardState } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A card is due when (now - lastTested) ≥ intervalDays (shared-model §5/§7).
 * An empty or unparseable lastTested is treated as never-tested ⇒ due.
 * Matches the `IsCardDue` type alias in `@/lib/types`.
 */
export function isCardDue(card: FlashcardState, now: Date): boolean {
  if (!card.lastTested) return true;
  const last = new Date(card.lastTested).getTime();
  if (Number.isNaN(last)) return true;
  const elapsedDays = (now.getTime() - last) / DAY_MS;
  return elapsedDays >= card.intervalDays;
}

/**
 * Compute the next flashcard state after a review (shared-model §5/§7).
 * - 'good': advance interval 7→14→30 (cap 30), stamp lastTested = now.
 * - 'again' (a miss): reset interval to 7, stamp lastTested = now.
 * Pure: returns a NEW object; never mutates the input. Mastery decay on a miss
 * is applied by the caller in a later task — this owns only interval/ease.
 *
 * §7 divergence: the shared `NextSrInterval` signature is
 * `(card, recall) => FlashcardState` with no `now`. We add a defaulted
 * `now = new Date()` so the function is deterministic for tests while still
 * being callable with the §7 two-argument signature.
 */
export function nextSrInterval(
  card: FlashcardState,
  recall: 'again' | 'good',
  now: Date = new Date(),
): FlashcardState {
  const at = now.toISOString();
  if (recall === 'again') {
    return { lastTested: at, intervalDays: 7, ease: 'again' };
  }
  const advanced: 7 | 14 | 30 = card.intervalDays === 7 ? 14 : 30;
  return { lastTested: at, intervalDays: advanced, ease: 'good' };
}
