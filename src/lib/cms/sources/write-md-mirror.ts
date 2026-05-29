/**
 * write-md-mirror.ts — Shared helper for atomically writing `_sources.md`.
 *
 * Extracted from `apply-source.ts` (Phase 4 Task 10) so that both
 * `apply-source.ts` (Phase 4) and `store.ts` (Phase 5a) can share the
 * recipe without duplicating ~15 lines.
 *
 * Guarantees:
 *   - Skip write if `<dir>/_sources.md` already contains byte-identical content
 *     (prevents an unnecessary fs touch that would trigger the watcher).
 *   - Atomic temp+rename: writes to `_sources.md.tmp`, then renames over target.
 *   - If rename throws, the `.tmp` is cleaned up (best-effort) and the error
 *     propagates. Callers decide whether to swallow or rethrow.
 */

import { writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SourcesDoc } from '@/lib/cms/types';
import { renderSourcesMd } from '@/lib/cms/sources/render-md';

/**
 * Atomically write `_sources.md` to `<dir>/_sources.md`.
 * If the file already exists with byte-identical content, skip the write.
 */
export async function writeMdMirror(dir: string, doc: SourcesDoc): Promise<void> {
  const content = renderSourcesMd(doc);
  const mdPath = join(dir, '_sources.md');

  // Skip write if already byte-identical
  try {
    const existing = await readFile(mdPath, 'utf8');
    if (existing === content) return;
  } catch {
    // File doesn't exist yet — proceed with write
  }

  // Atomic temp+rename (same recipe as writeSourcesJson)
  const tmpPath = `${mdPath}.tmp`;
  await writeFile(tmpPath, content, 'utf8');
  try {
    await rename(tmpPath, mdPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}
