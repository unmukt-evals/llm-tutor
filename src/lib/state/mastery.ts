import type {
  Mastery,
  ModuleState,
  DepthPass,
  PerformanceMatrix,
  Difficulty,
  Dimension,
  DimensionProfile,
} from '@/lib/types';

const ALL_DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];
const ALL_PASSES: DepthPass[] = ['tenYearOld', 'engineer', 'operator'];
const ALL_LENSES: ('board' | 'researcher' | 'analyst')[] = ['board', 'researcher', 'analyst'];

/** Total correct answers in a difficulty band across all dimensions. */
function correctInBand(matrix: PerformanceMatrix, band: Difficulty): number {
  return Object.values(matrix[band]).reduce((sum, cell) => sum + (cell?.correct ?? 0), 0);
}

/** blank → fuzzy: ≥1 easy AND ≥1 medium correct, and no open diagnosis (build-spec §7). */
function qualifiesFuzzy(m: ModuleState): boolean {
  if (m.mcq.openDiagnosis) return false;
  return correctInBand(m.mcq.matrix, 'easy') >= 1 && correctInBand(m.mcq.matrix, 'medium') >= 1;
}

function noWeakDimension(profile: DimensionProfile): boolean {
  return ALL_DIMENSIONS.every((d) => profile[d] !== 'weak');
}

/**
 * fuzzy → solid (build-spec §7): all three depth passes read AND a drill
 * self-marked adequate AND the dimensionProfile has no 'weak' dimension.
 */
function qualifiesSolid(m: ModuleState, readPasses: DepthPass[], drillAdequate: boolean): boolean {
  const allPassesRead = ALL_PASSES.every((p) => readPasses.includes(p));
  return allPassesRead && drillAdequate && noWeakDimension(m.mcq.dimensionProfile);
}

/**
 * solid → verified (build-spec §7): hard-difficulty MCQs correct in ALL 4
 * dimensions (matrix.hard[dim].correct >= 1 for every dimension) AND all three
 * stress-test lenses self-marked 'passed'.
 */
function qualifiesVerified(m: ModuleState): boolean {
  const hardAllDims = ALL_DIMENSIONS.every((d) => (m.mcq.matrix.hard[d]?.correct ?? 0) >= 1);
  const allLensesPassed = ALL_LENSES.every((l) => m.stressTest[l] === 'passed');
  return hardAllDims && allLensesPassed;
}

/**
 * Pure mastery-transition function (build-spec §7). Structurally matches the
 * `NextMastery` type alias in `@/lib/types`. Never regresses mastery and never
 * skips a level. Decay (the SR/diagnosis dimension-drop path) is NOT handled
 * here — it lands on the SR/diagnosis path in a later plan.
 */
export function nextMastery(
  prev: Mastery,
  m: ModuleState,
  readPasses: DepthPass[],
  drillAdequate: boolean,
): Mastery {
  switch (prev) {
    case 'blank':
      return qualifiesFuzzy(m) ? 'fuzzy' : 'blank';
    case 'fuzzy':
      return qualifiesSolid(m, readPasses, drillAdequate) ? 'solid' : 'fuzzy';
    case 'solid':
      return qualifiesVerified(m) ? 'verified' : 'solid';
    default:
      return prev;
  }
}
