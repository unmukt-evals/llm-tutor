import type {
  MCQAnswer, MCQQuestion, PerformanceMatrix, Cell, Dimension, DimensionStatus, DimensionProfile,
} from '../types';

const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/** A fresh, empty PerformanceMatrix (one empty bucket per difficulty). */
export function emptyMatrix(): PerformanceMatrix {
  return { easy: {}, medium: {}, hard: {} };
}

/**
 * Pure: returns a NEW matrix with the answer's (difficulty,dimension) cell
 * incremented. `seen` +1 always; `correct` +1 only when the answer was correct.
 * Initializes the cell from {seen:0,correct:0} when absent. Does not mutate `m`.
 */
export function updateMatrix(m: PerformanceMatrix, a: MCQAnswer, q: MCQQuestion): PerformanceMatrix {
  const prev: Cell = m[q.difficulty][q.dimension] ?? { seen: 0, correct: 0 };
  const cell: Cell = { seen: prev.seen + 1, correct: prev.correct + (a.correct ? 1 : 0) };
  return {
    easy: { ...m.easy },
    medium: { ...m.medium },
    hard: { ...m.hard },
    [q.difficulty]: { ...m[q.difficulty], [q.dimension]: cell },
  };
}

/**
 * Per-dimension accuracy (0..1) aggregated across all difficulties.
 * Returns null for a dimension with no answers (seen === 0) → "untested".
 */
export function accuracyByDimension(m: PerformanceMatrix): Record<Dimension, number | null> {
  const out = {} as Record<Dimension, number | null>;
  for (const dim of DIMENSIONS) {
    let seen = 0;
    let correct = 0;
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const cell = m[diff][dim];
      if (cell) {
        seen += cell.seen;
        correct += cell.correct;
      }
    }
    out[dim] = seen === 0 ? null : correct / seen;
  }
  return out;
}

/**
 * Map a per-dimension accuracy to a DimensionStatus.
 * Thresholds (00-shared-model §7 leaves these unpinned; we fix them here and test them):
 *   null (no data) → 'untested'
 *   accuracy >= 0.8 → 'solid'
 *   0.6 <= accuracy < 0.8 → 'fuzzy'
 *   accuracy < 0.6 → 'weak'
 */
export function statusFor(accuracy: number | null): DimensionStatus {
  if (accuracy === null) return 'untested';
  if (accuracy >= 0.8) return 'solid';
  if (accuracy >= 0.6) return 'fuzzy';
  return 'weak';
}

/** A DimensionProfile (status for all 4 dimensions) derived from the matrix. */
export function profileFromMatrix(m: PerformanceMatrix): DimensionProfile {
  const acc = accuracyByDimension(m);
  return {
    topic: statusFor(acc.topic),
    logic: statusFor(acc.logic),
    example: statusFor(acc.example),
    extension: statusFor(acc.extension),
  };
}
