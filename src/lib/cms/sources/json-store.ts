/**
 * json-store.ts — load + atomic-write helpers for `_sources.json`.
 *
 * The two public entry points are:
 *   loadSourcesJson(dir, fs?)  — returns { version:1, sources:[] } on missing;
 *                                 throws on malformed JSON with file path in message.
 *   writeSourcesJson(dir, doc, fs?) — validates then atomic temp+rename (same
 *                                 recipe as src/lib/state/store.ts JsonStateStore.write).
 *
 * `FsLike` from indexer.ts covers reads only.  This module needs write ops too,
 * so it defines and exports `WritableFsLike` (a superset) that callers can stub
 * in tests.  The default implementation uses node:fs/promises directly.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { Source } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';
import type { FsLike } from '@/lib/cms/indexer';
import { computeContentHash } from '@/lib/cms/hash';

// ── Writable FS interface (extends the read-only FsLike from indexer) ────────

/**
 * Injectable FS abstraction for json-store operations.  Extends the read-only
 * `FsLike` from `@/lib/cms/indexer` with write primitives needed for atomic
 * temp+rename writes.  Tests inject an in-memory stub; production uses the
 * `defaultWritableFs` singleton which delegates to `node:fs/promises`.
 */
export interface WritableFsLike extends FsLike {
  writeFile(path: string, content: string): Promise<void>;
  rename(src: string, dst: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const defaultWritableFs: WritableFsLike = {
  readFile: (p) => fsp.readFile(p, 'utf8'),
  stat: async (p) => {
    const s = await fsp.stat(p);
    return { mtimeMs: s.mtimeMs };
  },
  readdir: async (p) => fsp.readdir(p),
  writeFile: async (p, content) => fsp.writeFile(p, content, 'utf8'),
  rename: async (src, dst) => fsp.rename(src, dst),
  unlink: async (p) => fsp.unlink(p),
};

// ── Fixed key order for on-disk Source serialization ────────────────────────
//
// Iterating this list and building a plain object guarantees byte-stable JSON
// regardless of the in-memory insertion order of the Source object.  Fields
// that are absent on the source are omitted (not written as `undefined`).

const SOURCE_KEY_ORDER: ReadonlyArray<keyof Source> = [
  'id',
  'kind',
  'title',
  'url',
  'author',
  'cluster',
  'summary',
  'thesis',
  'mechanism',
  'quotes',
  'grounds',
  'raw_text',
  'fetched_at',
  'content_hash',
  'updated_at',
];

/** Rebuild a Source with a deterministic key order for stable JSON serialization. */
function normalizeSourceKeyOrder(s: Source): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SOURCE_KEY_ORDER) {
    if (key in s && s[key] !== undefined) {
      out[key] = s[key];
    }
  }
  return out;
}

// ── content_hash canonical input ─────────────────────────────────────────────
//
// sha256 hex of JSON.stringify({kind,title,url,author,cluster,summary,thesis,
// mechanism,quotes,grounds,raw_text,fetched_at}) — same fixed key order, so
// the hash is independent of how the caller constructed the Source.

const HASH_KEY_ORDER: ReadonlyArray<keyof Source> = [
  'kind',
  'title',
  'url',
  'author',
  'cluster',
  'summary',
  'thesis',
  'mechanism',
  'quotes',
  'grounds',
  'raw_text',
  'fetched_at',
];

function canonicalHashInput(s: Source): string {
  const obj: Record<string, unknown> = {};
  for (const key of HASH_KEY_ORDER) {
    if (key in s && s[key] !== undefined) {
      obj[key] = s[key];
    }
  }
  return JSON.stringify(obj);
}

// ── loadSourcesJson ───────────────────────────────────────────────────────────

/**
 * Reads `<dir>/_sources.json` and returns the parsed `SourcesDoc`.
 *
 * - Missing file → returns `{ version: 1, sources: [] }` (no error).
 * - Malformed JSON → throws `Error` whose message includes the file path;
 *   the original parse error is nested as `cause` where possible.
 */
export async function loadSourcesJson(
  dir: string,
  fs: WritableFsLike = defaultWritableFs,
): Promise<SourcesDoc> {
  const filePath = join(dir, '_sources.json');
  let raw: string;
  try {
    raw = await fs.readFile(filePath);
  } catch (err: unknown) {
    if (isNotFound(err)) return { version: 1, sources: [] };
    throw err;
  }

  try {
    return JSON.parse(raw) as SourcesDoc;
  } catch (err: unknown) {
    throw new Error(
      `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

// ── writeSourcesJson ──────────────────────────────────────────────────────────

/**
 * Atomically writes `doc` to `<dir>/_sources.json`.
 *
 * Validation (throws BEFORE touching disk):
 *   - `doc.version` must be `1`.
 *   - Every `Source.id` must be non-empty and unique within `doc.sources`.
 *
 * Normalization (applied to a copy; the caller's doc is not mutated):
 *   - Sources missing `content_hash` or `updated_at` have them computed/filled.
 *   - Each Source is serialized with a deterministic fixed key order.
 *
 * Atomic: writes to `<file>.tmp`, then renames over the target.  If rename
 * throws, the `.tmp` is cleaned up (best-effort) and the original error
 * propagates — no partial `_sources.json` is left on disk.
 */
export async function writeSourcesJson(
  dir: string,
  doc: SourcesDoc,
  fs: WritableFsLike = defaultWritableFs,
): Promise<void> {
  // ── Validation (before any disk I/O) ────────────────────────────────────
  if (doc.version !== 1) {
    throw new Error(`writeSourcesJson: unsupported version ${String(doc.version)} (expected 1)`);
  }
  const seenIds = new Set<string>();
  for (const s of doc.sources) {
    if (!s.id) {
      throw new Error('writeSourcesJson: source has empty id');
    }
    if (seenIds.has(s.id)) {
      throw new Error(`writeSourcesJson: duplicate source id ${s.id}`);
    }
    seenIds.add(s.id);
  }

  // ── Normalize: fill missing content_hash + updated_at ───────────────────
  const normalizedSources: Source[] = doc.sources.map((s) => {
    const hasBoth = s.content_hash && s.updated_at;
    if (hasBoth) return s;
    return {
      ...s,
      content_hash: s.content_hash ?? computeContentHash(canonicalHashInput(s)),
      updated_at: s.updated_at ?? Date.now(),
    };
  });
  const normalizedDoc: SourcesDoc = { version: 1, sources: normalizedSources };

  // ── Serialize with fixed key order ──────────────────────────────────────
  const serialized: Record<string, unknown> = {
    version: normalizedDoc.version,
    sources: normalizedDoc.sources.map(normalizeSourceKeyOrder),
  };
  const content = JSON.stringify(serialized, null, 2) + '\n';

  // ── Atomic write: temp file → rename ────────────────────────────────────
  const filePath = join(dir, '_sources.json');
  const tmpPath = `${filePath}.tmp`;

  await fs.writeFile(tmpPath, content);
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err: unknown) {
    // Best-effort cleanup of orphaned .tmp; preserve the original error.
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
