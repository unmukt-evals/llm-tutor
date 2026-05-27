// PURE mapping: a module's Mastery (+ whether it has an open diagnosis) →
// the visual properties a progress ring needs. No React, no DOM — unit-tested.
// Fractions per V1 spec §1: blank=0, fuzzy=1/3, solid=2/3, verified=full.
// An open diagnosis is a distinct state: it overrides the color to a warning
// token but keeps the mastery's fill fraction so the ring still reads progress.

import type { Mastery } from '@/lib/types';

/**
 * Stroke colors as raw hex (consumed by an SVG `stroke` attribute, not a
 * Tailwind class — SVG strokes can't use Tailwind text/bg tokens reliably).
 * Slate/emerald/amber chosen to match the existing slate-based UI.
 */
export const RING_COLORS = {
  blank: '#cbd5e1', // slate-300
  fuzzy: '#fbbf24', // amber-400
  solid: '#38bdf8', // sky-400
  verified: '#34d399', // emerald-400
  openDiagnosis: '#f97316', // orange-500 — distinct "needs attention"
} as const;

export interface RingVisual {
  /** 0..1 fraction of the circle to fill. */
  fraction: number;
  /** SVG stroke color (hex). */
  color: string;
  /** Accessible label describing the state. */
  label: string;
}

const FRACTION: Record<Mastery, number> = {
  blank: 0,
  fuzzy: 1 / 3,
  solid: 2 / 3,
  verified: 1,
};

const COLOR: Record<Mastery, string> = {
  blank: RING_COLORS.blank,
  fuzzy: RING_COLORS.fuzzy,
  solid: RING_COLORS.solid,
  verified: RING_COLORS.verified,
};

const LABEL: Record<Mastery, string> = {
  blank: 'Not started',
  fuzzy: 'Fuzzy',
  solid: 'Solid',
  verified: 'Verified',
};

/**
 * Map a mastery level (+ open-diagnosis flag) to ring visuals.
 * openDiagnosis overrides color + label but preserves the mastery fraction.
 */
export function ringVisual(mastery: Mastery, openDiagnosis = false): RingVisual {
  return {
    fraction: FRACTION[mastery],
    color: openDiagnosis ? RING_COLORS.openDiagnosis : COLOR[mastery],
    label: openDiagnosis ? 'Needs attention' : LABEL[mastery],
  };
}
