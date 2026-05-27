// src/lib/mcq/runner.ts
// Pure orchestration helpers for the MCQ assessment loop (plan-03 Task 13).
//
// McqRunner.tsx is a thin React shell; ALL non-trivial state-folding lives here
// so it is exhaustively unit-testable (no React, no I/O, no LLM). Mirrors the
// S-CARDS pattern (sr-update.ts): a pure transform + the matching /api/state
// PATCH descriptor consumed by api-client `patchState`.
//
// The "mcq" slice is ModuleState['mcq']:
//   { matrix, distractorLog, dimensionProfile, recentCorrect, openDiagnosis? }

import type {
  ModuleState,
  MCQQuestion,
  MCQAnswer,
  MCQPool,
} from '@/lib/types';
import { updateMatrix, profileFromMatrix } from './matrix';
import { detectInconsistency } from './inconsistency';
import { localize } from './localize';
import { applyDiagnosisToState, clearDiagnosisIfResolved } from './remediation';

export type McqState = ModuleState['mcq'];

/**
 * Fold a single graded answer into the mcq state. Pure — returns a new slice,
 * never mutates the input.
 *   - matrix: incremented in the (difficulty,dimension) cell (updateMatrix)
 *   - dimensionProfile: recomputed from the new matrix
 *   - on WRONG: appends a ChosenDistractor to distractorLog (feeds localize)
 *   - on CORRECT: appends { qid, at } to recentCorrect (anti-farm source, §7)
 * openDiagnosis is left untouched here — it is set/cleared at end-of-set.
 */
export function foldAnswer(
  mcq: McqState,
  question: MCQQuestion,
  answer: MCQAnswer,
): McqState {
  const matrix = updateMatrix(mcq.matrix, answer, question);
  const distractorLog = answer.correct
    ? mcq.distractorLog
    : [...mcq.distractorLog, { qid: question.id, chose: answer.chosenIndex, at: answer.at }];
  const recentCorrect = answer.correct
    ? [...mcq.recentCorrect, { qid: question.id, at: answer.at }]
    : mcq.recentCorrect;

  return {
    ...mcq,
    matrix,
    distractorLog,
    recentCorrect,
    dimensionProfile: profileFromMatrix(matrix),
  };
}

/**
 * End-of-set resolution (§3.4/§3.5/§3.6). Pure.
 *   1. clear any open diagnosis whose dimension is no longer weak;
 *   2. if no diagnosis remains open AND detectInconsistency fires → localize
 *      the failing dimension and record it as openDiagnosis (routed remediation
 *      lives on the Diagnosis as `.remediation`).
 * Returns the updated mcq slice. dimensionProfile is always reconciled with the
 * matrix (clearDiagnosisIfResolved recomputes it).
 */
export function finalizeAssessment(
  mcq: McqState,
  pool: MCQPool,
  now: string,
): McqState {
  // Wrap the slice in a minimal ModuleState so we can reuse the pure
  // remediation helpers, which operate on ModuleState.
  const shell: ModuleState = {
    mastery: 'blank',
    masteryHistory: [],
    mcq,
    stressTest: {},
  };

  const cleared = clearDiagnosisIfResolved(shell);

  let next = cleared;
  if (!cleared.mcq.openDiagnosis && detectInconsistency(cleared.mcq.matrix)) {
    const diag = localize(cleared.mcq.matrix, cleared.mcq.distractorLog, pool);
    next = applyDiagnosisToState(cleared, diag, now);
  }

  return next.mcq;
}

export interface McqPatch {
  path: ['modules', string, 'mcq'];
  value: McqState;
}

/**
 * Build the `/api/state` PATCH descriptor for persisting the mcq slice.
 * Pairs with `patchState(patch.path, patch.value)` in the api-client.
 */
export function mcqPatch(moduleId: string, mcq: McqState): McqPatch {
  return {
    path: ['modules', moduleId, 'mcq'],
    value: mcq,
  };
}
