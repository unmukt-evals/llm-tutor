import type {
  PerformanceMatrix, ChosenDistractor, MCQPool, Diagnosis, Dimension, DepthPass,
} from '@/lib/types';
import { accuracyByDimension } from './matrix';

const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/** build-spec §3.1 — dimension → content layer routing. */
export function routeRemediation(dim: Dimension): DepthPass | 'lab' | 'drill' {
  switch (dim) {
    case 'topic': return 'tenYearOld';
    case 'logic': return 'engineer';
    case 'example': return 'lab';
    case 'extension': return 'drill';
  }
}

/**
 * build-spec §3.5 — deterministic localizer, NO LLM.
 *
 *  1. The FAILING dimension is the lowest-accuracy KNOWN (tested) dimension.
 *     (Untested dimensions are ignored — we cannot localize a gap we never probed.)
 *  2. Tie-break: when several known dimensions tie on the worst accuracy, prefer
 *     the one whose chosen-distractor misconception strings recur MOST in the log.
 *     A further stable fallback uses the canonical DIMENSIONS order so the result
 *     is fully deterministic.
 *  3. confidence = the accuracy GAP between the best and worst KNOWN dimension,
 *     clamped to 0..1. This is NOT a model score — it is a transparent measure of
 *     how cleanly the failing dimension separates from the rest. A wide gap (one
 *     dimension is dragging while others are strong) → high confidence; a narrow
 *     gap (everything is roughly equally weak) → low confidence.
 *  4. evidence.qids = the distinct qids in the log implicating the chosen
 *     dimension (the learner's wrong picks there); recurringMisconceptions = the
 *     distinct distractorMisconception strings for those picks.
 *  5. remediation = routeRemediation(dimension) (build-spec §3.1).
 */
export function localize(m: PerformanceMatrix, log: ChosenDistractor[], pool: MCQPool): Diagnosis {
  const acc = accuracyByDimension(m);
  const known = DIMENSIONS.filter((d) => acc[d] !== null);

  // No tested dimension — degenerate guard. Fall back to the first dimension with
  // zero confidence so the caller still gets a well-formed Diagnosis.
  if (known.length === 0) {
    return {
      dimension: DIMENSIONS[0],
      confidence: 0,
      evidence: { qids: [], recurringMisconceptions: [] },
      remediation: routeRemediation(DIMENSIONS[0]),
    };
  }

  const accs = known.map((d) => acc[d] as number);
  const worstAccuracy = Math.min(...accs);
  const bestAccuracy = Math.max(...accs);

  // candidates = all known dimensions tied at the worst accuracy
  const candidates = known.filter((d) => acc[d] === worstAccuracy);

  // map qid → question for dimension lookup + misconception strings
  const qById = new Map(pool.questions.map((q) => [q.id, q]));

  // count recurring misconception strings per dimension from the distractor log
  const misconceptionCount = (dim: Dimension): { count: number; strings: string[] } => {
    const strings: string[] = [];
    for (const entry of log) {
      const q = qById.get(entry.qid);
      if (!q || q.dimension !== dim) continue;
      const s = q.distractorMisconception[String(entry.chose)];
      if (s) strings.push(s);
    }
    return { count: strings.length, strings };
  };

  // tie-break by recurrence; stable fallback on canonical DIMENSIONS order
  const chosen = candidates
    .map((d) => ({ d, ...misconceptionCount(d) }))
    .sort((a, b) => b.count - a.count || DIMENSIONS.indexOf(a.d) - DIMENSIONS.indexOf(b.d))[0];

  const dimension = chosen.d;

  // evidence: the distinct qids in the log implicating this dimension + the
  // distinct misconception strings for it.
  const failingQids = Array.from(new Set(
    log.filter((e) => qById.get(e.qid)?.dimension === dimension).map((e) => e.qid),
  ));
  const recurringMisconceptions = Array.from(new Set(chosen.strings));

  const confidence = Math.max(0, Math.min(1, bestAccuracy - worstAccuracy));

  return {
    dimension,
    confidence,
    evidence: { qids: failingQids, recurringMisconceptions },
    remediation: routeRemediation(dimension),
  };
}
