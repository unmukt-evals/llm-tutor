import 'server-only';
import { getCmsIndex } from '@/lib/cms/index';
import type { EntityKind } from '@/lib/cms/types';
import type { IndexAllReport } from '@/lib/cms/indexer';
import type { ReindexResult } from '@/lib/cms/index';

/**
 * Thin facade — resolves the CMS singleton for `dir` and dispatches to the
 * appropriate reindex method.
 *
 * Phase-3 entry point used by:
 *   - `/api/source/apply` (after `applyCandidate` writes a module + pool atomically),
 *   - `/api/cms/reindex` (the dev/admin trigger),
 *   - the watcher (when it sees a tracked file change),
 *   - future Studio routes (Phase 5).
 *
 * Named export, not a class — so tree-shaking + per-call-site import is trivial.
 */
export async function reindexAffected(
  dir: string,
  kind: EntityKind | 'all',
  id?: string,
): Promise<ReindexResult | { ok: true } | IndexAllReport> {
  const cms = await getCmsIndex(dir);
  if (kind === 'all') return cms.reindexAll();
  if (kind === 'state') return cms.reindexState();
  if (!id) {
    throw new Error(`reindexAffected: kind "${kind}" requires an id`);
  }
  return cms.reindexEntity(kind, id);
}
