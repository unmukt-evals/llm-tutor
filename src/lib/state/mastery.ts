import type {
  Mastery,
  ModuleState,
  DepthPass,
  PerformanceMatrix,
  Difficulty,
} from '@/lib/types';

/** Total correct answers in a difficulty band across all dimensions. */
function correctInBand(matrix: PerformanceMatrix, band: Difficulty): number {
  return Object.values(matrix[band]).reduce((sum, cell) => sum + (cell?.correct ?? 0), 0);
}

/** blank → fuzzy: ≥1 easy AND ≥1 medium correct, and no open diagnosis (build-spec §7). */
function qualifiesFuzzy(m: ModuleState): boolean {
  if (m.mcq.openDiagnosis) return false;
  return correctInBand(m.mcq.matrix, 'easy') >= 1 && correctInBand(m.mcq.matrix, 'medium') >= 1;
}

/**
 * Pure mastery-transition function (build-spec §7). Structurally matches the
 * `NextMastery` type alias in `@/lib/types`.
 *
 * Task 11 implements ONLY the blank→fuzzy rule. fuzzy→solid and solid→verified
 * (which consume `readPasses` and `drillAdequate`) land in Task 12 — those params
 * are already in the signature so it stays stable. This function never regresses
 * mastery and never skips a level.
 */
export function nextMastery(
  prev: Mastery,
  m: ModuleState,
  _readPasses: DepthPass[],
  _drillAdequate: boolean,
): Mastery {
  if (prev === 'blank') {
    return qualifiesFuzzy(m) ? 'fuzzy' : 'blank';
  }
  return prev;
}
