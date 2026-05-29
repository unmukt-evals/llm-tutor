/**
 * ensure-json.ts — Idempotent one-shot migration runner.
 *
 * Ensures `<dir>/_sources.json` exists, creating it from `_sources.md` if
 * present, or bootstrapping an empty doc otherwise.  Safe to call on every
 * CMS cold boot.
 *
 * Public API:
 *   ensureSourcesJson(dir, fs?) → Promise<{ migrated: boolean }>
 *
 * Behaviour:
 *   1. `_sources.json` exists → return { migrated: false }. No work.
 *   2. `_sources.md` exists (no JSON) → parse with parseSourcesMd, write via
 *      writeSourcesJson, return { migrated: true }.  The .md stays in place.
 *   3. Neither file exists → write empty { version:1, sources:[] }, return
 *      { migrated: true }.
 *   4. Second call after success → JSON now exists, fires case 1.
 *
 * ENOENT on the JSON probe is handled silently (that's the migration trigger).
 * Any other I/O error on the JSON probe re-throws.
 */

import { join } from 'node:path';
import type { WritableFsLike } from '@/lib/cms/sources/json-store';
import { writeSourcesJson } from '@/lib/cms/sources/json-store';
import { parseSourcesMd } from '@/lib/cms/sources/migrate-from-md';
import type { SourcesDoc } from '@/lib/cms/types';

// ── ensureSourcesJson ─────────────────────────────────────────────────────────

export async function ensureSourcesJson(
  dir: string,
  fs?: WritableFsLike,
): Promise<{ migrated: boolean }> {
  const jsonPath = join(dir, '_sources.json');
  const mdPath = join(dir, '_sources.md');

  // ── 1. JSON already exists → no-op ──────────────────────────────────────
  const jsonExists = await probeExists(jsonPath, fs);
  if (jsonExists) {
    return { migrated: false };
  }

  // ── 2. MD exists → parse + write ────────────────────────────────────────
  const rawMd = await tryReadFile(mdPath, fs);
  let doc: SourcesDoc;
  if (rawMd !== null) {
    doc = parseSourcesMd(rawMd); // updated_at = Date.now()
  } else {
    // ── 3. Neither file → write empty doc ──────────────────────────────
    doc = { version: 1, sources: [] };
  }

  await writeSourcesJson(dir, doc, fs);
  return { migrated: true };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if the file at `path` exists and is readable.
 * Distinguishes ENOENT (→ false) from other I/O errors (→ rethrows).
 */
async function probeExists(path: string, fs?: WritableFsLike): Promise<boolean> {
  if (!fs) {
    // Default: use node:fs/promises directly
    const { promises: fsp } = await import('node:fs');
    try {
      await fsp.stat(path);
      return true;
    } catch (err: unknown) {
      if (isEnoent(err)) return false;
      throw err;
    }
  }
  try {
    await fs.stat(path);
    return true;
  } catch (err: unknown) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

/**
 * Returns the file content as a string, or null if ENOENT.
 * Re-throws on other errors.
 */
async function tryReadFile(path: string, fs?: WritableFsLike): Promise<string | null> {
  if (!fs) {
    const { promises: fsp } = await import('node:fs');
    try {
      return await fsp.readFile(path, 'utf8');
    } catch (err: unknown) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }
  try {
    return await fs.readFile(path);
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
