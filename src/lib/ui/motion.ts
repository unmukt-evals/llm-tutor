// PURE motion policy + a thin browser probe. The policy is unit-tested; the
// probe is a one-line wrapper around matchMedia (untested — no jsdom in this
// project). Components read `prefersReducedMotion()` once, then feed the boolean
// into the pure helpers so all animation honors the OS setting (V1 spec §1).

/** Animation is allowed iff the user does NOT prefer reduced motion. */
export function animationEnabled(prefersReduced: boolean): boolean {
  return !prefersReduced;
}

/** A duration, collapsed to 0ms when the user prefers reduced motion. */
export function motionDurationMs(ms: number, prefersReduced: boolean): number {
  return prefersReduced ? 0 : ms;
}

/**
 * Browser probe: true if the OS/browser requests reduced motion.
 * SSR-safe: returns false when `window`/`matchMedia` is unavailable.
 * (Not unit-tested — node env has no matchMedia; covered by build/typecheck.)
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
