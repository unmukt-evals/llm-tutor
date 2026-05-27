import type { MCQPool, MCQQuestion, ModuleState, AssessmentSpec, Difficulty, Dimension } from '../types';
import { accuracyByDimension } from './matrix';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/** Fisher–Yates shuffle driven by the injected rng (deterministic given a seeded rng). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hasDim(qs: MCQQuestion[], dim: Dimension): boolean {
  return qs.some((q) => q.dimension === dim);
}

/** True if the candidate set can span all 3 difficulties AND >=3 distinct dimensions. */
function canSatisfyGuarantees(qs: MCQQuestion[]): boolean {
  const diffs = new Set(qs.map((q) => q.difficulty));
  const dims = new Set(qs.map((q) => q.dimension));
  return DIFFICULTIES.every((d) => diffs.has(d)) && dims.size >= 3;
}

/** Higher weight = more likely to fill a spare slot. weak > untested > fuzzy > solid. */
function dimensionWeights(state: ModuleState): Record<Dimension, number> {
  const acc = accuracyByDimension(state.mcq.matrix);
  const profile = state.mcq.dimensionProfile;
  const out = {} as Record<Dimension, number>;
  for (const dim of DIMENSIONS) {
    const status = profile[dim];
    let base: number;
    if (status === 'weak') base = 4;
    else if (status === 'untested') base = 3;
    else if (status === 'fuzzy') base = 2;
    else base = 1; // solid
    // staleness nudge: dimensions with no data get a small bump
    if (acc[dim] === null) base += 0.5;
    out[dim] = base;
  }
  return out;
}

/**
 * Stratified selection (build-spec §3.2 / shared-model §3, §7).
 *   - GUARANTEES >=1 easy, >=1 medium, >=1 hard
 *   - GUARANTEES >=3 distinct dimensions
 *   - excludes recently-correct ids (anti-farm) when guarantees stay satisfiable;
 *     if honoring the excludes would break the difficulty/dimension guarantee, falls back
 *     to the full pool (the representation guarantee wins over anti-farm).
 *   - remaining slots weighted toward weak/untested dimensions
 *   - DEGRADES GRACEFULLY: a pool too small to meet the guarantees returns what it can
 *     (no throw), never repeating a question.
 * Deterministic given `rng`. Defaults to Math.random.
 */
export function selectAssessment(
  pool: MCQPool,
  state: ModuleState,
  spec: AssessmentSpec,
  rng: () => number = Math.random,
): MCQQuestion[] {
  const { count } = spec;
  const exclude = new Set(spec.excludeIds ?? []);

  // Anti-farm filter. If honoring excludes would make the guarantees impossible,
  // fall back to the full pool (representation guarantee > anti-farm).
  const filtered = pool.questions.filter((q) => !exclude.has(q.id));
  const usable = canSatisfyGuarantees(filtered) ? filtered : pool.questions;

  const picked: MCQQuestion[] = [];
  const pickedIds = new Set<string>();
  const take = (q: MCQQuestion | undefined): void => {
    if (q && !pickedIds.has(q.id) && picked.length < count) {
      picked.push(q);
      pickedIds.add(q.id);
    }
  };

  // 1) one of each difficulty (guarantee A) — random within stratum
  for (const diff of DIFFICULTIES) {
    const stratum = shuffle(usable.filter((q) => q.difficulty === diff && !pickedIds.has(q.id)), rng);
    take(stratum[0]);
  }

  // 2) ensure >=3 distinct dimensions (guarantee B): prefer questions in not-yet-covered dimensions
  const dimsCovered = (): number => new Set(picked.map((q) => q.dimension)).size;
  if (dimsCovered() < 3) {
    const byNewDim = shuffle(usable.filter((q) => !pickedIds.has(q.id)), rng);
    for (const q of byNewDim) {
      if (dimsCovered() >= 3 || picked.length >= count) break;
      if (!hasDim(picked, q.dimension)) take(q);
    }
  }

  // 3) fill remaining slots, weighted toward weak/untested dimensions
  const weight = dimensionWeights(state);
  const remaining = shuffle(usable.filter((q) => !pickedIds.has(q.id)), rng).sort(
    (a, b) => weight[b.dimension] - weight[a.dimension],
  );
  for (const q of remaining) {
    if (picked.length >= count) break;
    take(q);
  }

  return picked;
}
