// Barrel re-export of the S-MCQ engine public API.
// (Grows as later tasks land matrix / select / localize / etc.)
import path from 'node:path';
import type { MCQRepository } from '@/lib/types';
import { FileMCQRepository } from './repository';

export { FileMCQRepository, validatePool } from './repository';
export type { FileNamer } from './repository';
export { selectAssessment } from './select';
export { localize, routeRemediation } from './localize';

/**
 * Factory (00-shared-model §7). Pool files live at
 * `<curriculumDir>/mcq/<moduleId>.json`, so this points a FileMCQRepository at
 * the `mcq` subdirectory of the curriculum folder.
 */
export function getMcqRepository(curriculumDir: string): MCQRepository {
  return new FileMCQRepository(path.join(curriculumDir, 'mcq'));
}
