/**
 * source-hash.ts — Shared hash recipe for Source content hashing.
 *
 * Single source of truth for the canonical serialization used to compute
 * `content_hash` on a Source.  Both `json-store.ts` and `migrate-from-md.ts`
 * import from here so a future field-order change is one edit, not two.
 *
 * Exports:
 *   HASH_KEY_ORDER        — the ordered subset of Source keys that go into the hash
 *   canonicalHashInput(s) — JSON.stringify over HASH_KEY_ORDER (omits undefined)
 *   computeSourceHash(s)  — sha256 hex of canonicalHashInput(s)
 */

import type { Source } from '@/lib/types';
import { computeContentHash } from '@/lib/cms/hash';

// ── Canonical field order for content_hash serialization ─────────────────────
//
// sha256 hex of JSON.stringify({ kind, title, url, author, cluster, summary,
// thesis, mechanism, quotes, grounds, raw_text, fetched_at }) in this fixed
// key order — so the hash is independent of the in-memory insertion order of
// the Source object.

export const HASH_KEY_ORDER: ReadonlyArray<keyof Source> = [
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

/** Build the canonical JSON string that is hashed into `content_hash`. */
export function canonicalHashInput(s: Partial<Source>): string {
  const obj: Record<string, unknown> = {};
  for (const key of HASH_KEY_ORDER) {
    const val = (s as Record<string, unknown>)[key];
    if (val !== undefined) {
      obj[key] = val;
    }
  }
  return JSON.stringify(obj);
}

/** sha256 hex of the canonical hash input for a source. */
export function computeSourceHash(s: Partial<Source>): string {
  return computeContentHash(canonicalHashInput(s));
}
