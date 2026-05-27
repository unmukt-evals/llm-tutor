import type { PerformanceMatrix, Difficulty, Dimension } from '../types';
import { accuracyByDimension } from './matrix';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/**
 * build-spec §3.4 — fire when EITHER:
 *  (a) mixed-within-a-band: within easy OR medium, the learner has both correct and incorrect answers
 *      (the "medium right then medium wrong" signal). HARD is excluded — hard being mixed is the frontier.
 *  (b) dimension imbalance: one dimension <60% accuracy while >=2 others are >80%.
 * Returns false when there is too little data to judge (no band with >=2 answers, no imbalance).
 */
export function detectInconsistency(m: PerformanceMatrix): boolean {
  // (a) mixed within easy or medium (NOT hard — hard mixed = frontier)
  for (const diff of ['easy', 'medium'] as Difficulty[]) {
    let seen = 0;
    let correct = 0;
    for (const dim of DIMENSIONS) {
      const cell = m[diff][dim];
      if (cell) { seen += cell.seen; correct += cell.correct; }
    }
    if (seen >= 2 && correct > 0 && correct < seen) return true;
  }

  // (b) dimension imbalance
  const acc = accuracyByDimension(m);
  const known = DIMENSIONS.map((d) => acc[d]).filter((a): a is number => a !== null);
  const below60 = known.filter((a) => a < 0.6).length;
  const above80 = known.filter((a) => a > 0.8).length;
  if (below60 >= 1 && above80 >= 2) return true;

  return false;
}

export { DIFFICULTIES, DIMENSIONS };
