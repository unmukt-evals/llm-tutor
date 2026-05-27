// Client-side juice event bus: a thin, shared wrapper so every earn-site
// (McqRunner, FlashcardReview, SelfRevealPanel) fires the same two window
// CustomEvents in the same shape. The "did it happen?" logic lives in the pure
// tested detectors in ./juice (xpDelta, modulesReachingVerified); this file
// only carries the event names + the dispatch, and the snapshot projection
// (masterySnapshot) it reuses. No detection logic is reinlined here.
//
// The toast/flourish components (XpPop, LevelUpFlourish) listen for these and
// run the pure detectors against their held baseline. Dispatch is a no-op
// outside the browser (SSR-safe) so callers can fire unconditionally.

import type { TutorState } from '@/lib/types';
import { masterySnapshot } from '@/lib/ui/juice';

/** Window event: detail is the new XP total. */
export const XP_EVENT = 'llmtutor:xp';
/** Window event: detail is the new Record<moduleId, Mastery> snapshot. */
export const MASTERY_EVENT = 'llmtutor:mastery';

/**
 * Announce a freshly-persisted TutorState to the juice layer. Dispatches the
 * new XP total and the new mastery snapshot; the listeners decide (via the pure
 * detectors) whether anything actually fires. Safe to call after every
 * successful patchState — both events are cheap and idempotent.
 */
export function announceState(next: TutorState): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(XP_EVENT, { detail: next.xp.total }));
  window.dispatchEvent(
    new CustomEvent(MASTERY_EVENT, { detail: masterySnapshot(next) }),
  );
}
