// Barrel re-export of the S-MCQ engine public API.
import path from 'node:path';
import type { MCQRepository } from '@/lib/types';
import { FileMCQRepository } from './repository'; // used by getMcqRepository factory below

// Repository
export { validatePool } from './repository';

// Performance matrix
export { emptyMatrix, updateMatrix, accuracyByDimension, profileFromMatrix, statusFor } from './matrix';

// Inconsistency detector
export { detectInconsistency } from './inconsistency';

// Localizer + remediation router
export { localize, routeRemediation } from './localize';

// Stratified selection
export { selectAssessment } from './select';

// Grading + feedback
export { gradeAnswer, feedbackFor } from './grade';
export type { QuestionFeedback } from './grade';

// Remediation loop
export {
  applyDiagnosisToState,
  buildRemediationAssessment,
  clearDiagnosisIfResolved,
  masteryBlockedByWeakDimension,
} from './remediation';

// S-SELF: self-graded-reveal helpers
export { revealForDrill, revealForStressTest, applyStressSelfMark } from './self';
export type { DrillReveal, StressReveal, SelfMark } from './self';

// Runner orchestration (pure): per-answer fold + end-of-set finalize + patch shape
export { foldAnswer, finalizeAssessment, mcqPatch } from './runner';
export type { McqState, McqPatch } from './runner';

/**
 * Factory (00-shared-model §7). Pool files live at
 * `<curriculumDir>/mcq/<moduleId>.json`, so this points a FileMCQRepository at
 * the `mcq` subdirectory of the curriculum folder.
 */
export function getMcqRepository(curriculumDir: string): MCQRepository {
  return new FileMCQRepository(path.join(curriculumDir, 'mcq'));
}
