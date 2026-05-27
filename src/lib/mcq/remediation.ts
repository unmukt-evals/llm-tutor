import type {
  ModuleState, Diagnosis, MCQPool, MCQQuestion, Dimension, Difficulty, DimensionStatus,
} from '../types';
import { profileFromMatrix } from './matrix';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** §3.6 — record the open diagnosis on the module state (pure). */
export function applyDiagnosisToState(state: ModuleState, diag: Diagnosis, openedAt: string): ModuleState {
  return {
    ...state,
    mcq: { ...state.mcq, openDiagnosis: { ...diag, openedAt } },
  };
}

/**
 * §3.6 — a fresh dimension-targeted mini-assessment: `count` questions all in `dim`,
 * spanning difficulties (one per difficulty first, then fill from what remains).
 */
export function buildRemediationAssessment(pool: MCQPool, dim: Dimension, count = 3): MCQQuestion[] {
  const inDim = pool.questions.filter((q) => q.dimension === dim);
  const picked: MCQQuestion[] = [];
  const ids = new Set<string>();
  for (const diff of DIFFICULTIES) {
    const q = inDim.find((x) => x.difficulty === diff && !ids.has(x.id));
    if (q) { picked.push(q); ids.add(q.id); }
  }
  for (const q of inDim) {
    if (picked.length >= count) break;
    if (!ids.has(q.id)) { picked.push(q); ids.add(q.id); }
  }
  return picked.slice(0, count);
}

/** §7 — mastery cannot advance while any dimension is 'weak'. */
export function masteryBlockedByWeakDimension(state: ModuleState): boolean {
  return Object.values(state.mcq.dimensionProfile).some((s) => s === 'weak');
}

/**
 * §3.6 PINNED — an open diagnosis "resolves" only when its weak dimension recovers
 * to a *tested* non-weak status. `untested` (no new evidence yet) keeps it open;
 * the plan's literal `!== 'weak'` would have spuriously cleared on an empty matrix.
 */
function isResolvedStatus(status: DimensionStatus): boolean {
  return status === 'solid' || status === 'fuzzy';
}

/**
 * §3.6 — recompute the dimension profile from the matrix; clear openDiagnosis
 * once the previously-weak dimension recovers above the bar (solid/fuzzy).
 * Keeps it open while the dimension is still 'weak' or merely 'untested'. Pure.
 */
export function clearDiagnosisIfResolved(state: ModuleState): ModuleState {
  const dimensionProfile = profileFromMatrix(state.mcq.matrix);
  const open = state.mcq.openDiagnosis;
  const resolved = open ? isResolvedStatus(dimensionProfile[open.dimension]) : false;
  return {
    ...state,
    mcq: {
      ...state.mcq,
      dimensionProfile,
      openDiagnosis: resolved ? undefined : open,
    },
  };
}
