// PURE juice detectors: decide WHEN celebratory effects fire. No React, no DOM.
// The juice React shells (XpPop, level-up flourish) call these against the
// previous vs next snapshot they hold, then animate. Keeping detection pure
// means the "did this just happen?" logic is unit-tested (V1 spec §1 juice).

import type { Mastery, TutorState } from '@/lib/types';

/** Positive XP gained between two totals; 0 if unchanged or decreased. */
export function xpDelta(prevTotal: number, nextTotal: number): number {
  return Math.max(0, nextTotal - prevTotal);
}

/**
 * Flatten a TutorState into the `Record<moduleId, Mastery>` snapshot the
 * level-up detector compares against. Pure so the earn-sites don't reinline
 * the `state.modules → mastery` projection (V1 spec: logic in tested helpers).
 */
export function masterySnapshot(state: TutorState): Record<string, Mastery> {
  const snap: Record<string, Mastery> = {};
  for (const [id, ms] of Object.entries(state.modules)) {
    snap[id] = ms.mastery;
  }
  return snap;
}

/**
 * Module ids that transitioned INTO 'verified' between two mastery snapshots.
 * A module qualifies only if it had a prior entry that was not already
 * 'verified' and its next value is 'verified'. Modules with no prior entry are
 * ignored (prevents a false flourish on first load / hydration).
 */
export function modulesReachingVerified(
  prev: Record<string, Mastery>,
  next: Record<string, Mastery>,
): string[] {
  const out: string[] = [];
  for (const id of Object.keys(next)) {
    const before = prev[id];
    if (before !== undefined && before !== 'verified' && next[id] === 'verified') {
      out.push(id);
    }
  }
  return out;
}
