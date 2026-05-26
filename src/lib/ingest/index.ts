// S-INGEST public surface. Per 00-shared-model.md §7, callers depend on the
// `getCurriculumRepository()` factory rather than constructing the impl directly.
import type { CurriculumRepository } from '@/lib/types';
import { CurriculumRepositoryImpl } from '@/lib/ingest/repository';

export { parseModule } from '@/lib/ingest/parse-module';
export { CurriculumRepositoryImpl } from '@/lib/ingest/repository';

/** §7 factory: returns the concrete CurriculumRepository for the app to use. */
export function getCurriculumRepository(): CurriculumRepository {
  return new CurriculumRepositoryImpl();
}
