// src/lib/studio/write-pool.ts
// Phase 5b — Studio's pool-only atomic writer. Writes mcq/<id>.json after
// re-validating against validatePool and asserting moduleId matches the url id.
//
// Contract:
//   1. JSON.parse the body. Throw on bad JSON.
//   2. validatePool(parsed). Throw with human-readable message on failure.
//   3. parsed.moduleId MUST equal url id (defense-in-depth path-traversal guard
//      across the api-route → writer boundary).
//   4. Atomic write — `<file>.tmp` then `rename` over the target. Same fs.
//   5. mcq/ dir is created if missing.
//
// This intentionally does NOT call reindexEntity — the API route does, after
// the file is on disk.

import { writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { assertSafePathComponent } from '@/lib/source/apply';
import { validatePool } from '@/lib/mcq/repository';

export interface WritePoolResult {
  /** Relative file path inside `dir`, e.g. `mcq/M99.json`. */
  file: string;
}

/**
 * Atomically write `poolJson` for pool `id` inside `dir`. Re-validates the
 * pool, asserts parsed.moduleId === id, then writes pretty-printed JSON via
 * `<file>.tmp` + rename. Returns the relative file path written.
 */
export async function writePool(
  dir: string,
  id: string,
  poolJson: string,
): Promise<WritePoolResult> {
  assertSafePathComponent(id, 'id');

  let parsed: unknown;
  try {
    parsed = JSON.parse(poolJson);
  } catch {
    throw new Error('Pool body is not valid JSON');
  }
  const pool = validatePool(parsed);

  if (pool.moduleId !== id) {
    throw new Error(
      `pool moduleId mismatch: url id "${id}" does not match pool.moduleId "${pool.moduleId}"`,
    );
  }

  const rel = join('mcq', `${id}.json`);
  const abs = join(dir, rel);
  const tmp = `${abs}.tmp`;
  const pretty = `${JSON.stringify(pool, null, 2)}\n`;

  await mkdir(dirname(abs), { recursive: true });

  let tmpWritten = false;
  try {
    await writeFile(tmp, pretty, 'utf8');
    tmpWritten = true;
    await rename(tmp, abs);
  } catch (err) {
    if (tmpWritten) await unlink(tmp).catch(() => {});
    throw err;
  }

  return { file: rel };
}
