/**
 * apply-source.ts — Source entity write logic invoked by /api/source/apply.
 *
 * After `applyCandidate` succeeds, the route calls `applySourceToDir` with the
 * optional `source` metadata from the POST body. This module:
 *   1. Derives a Source id (URL-match reuse or new `src_<8hex>`).
 *   2. Upserts the Source into `_sources.json`.
 *   3. Re-renders `_sources.md` atomically (skipping the write if byte-identical).
 *   4. Calls `reindexAffected(dir, 'source', '_sources')`.
 *
 * Any error in steps 1–4 is swallowed with a warning — the module + pool already
 * landed and that's the user's expected outcome. This mirrors the Phase 3 reindex
 * try/catch pattern already in the route.
 *
 * The function is also testable in isolation (no Next.js dependencies).
 */

import type { Source } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';
import { loadSourcesJson, writeSourcesJson } from '@/lib/cms/sources/json-store';
import { computeSourceHash } from '@/lib/cms/sources/source-hash';
import { writeMdMirror } from '@/lib/cms/sources/write-md-mirror';
import { reindexAffected } from '@/lib/cms/reindex';

// ── SourceInput shape (mirrors the POST body `source` field) ─────────────────

export interface SourceInput {
  kind: 'url' | 'transcript';
  url?: string;    // required when kind === 'url'
  title?: string;  // optional; defaults are derived (see deriveTitle)
  text: string;    // the fetched body (url) or pasted text (transcript)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a default title from a URL-kind or transcript-kind source input. */
export function deriveTitle(input: SourceInput, now = Date.now()): string {
  if (input.title) return input.title;
  if (input.kind === 'url' && input.url) {
    try {
      const u = new URL(input.url);
      const path = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
      return u.host + path;
    } catch {
      return input.url;
    }
  }
  // Transcript kind — "Transcript: YYYY-MM-DD"
  return `Transcript: ${new Date(now).toISOString().slice(0, 10)}`;
}

/**
 * Find an existing Source in `doc.sources` by URL (for URL-kind sources).
 * Returns undefined when not found or when the input is a transcript.
 */
function findExistingByUrl(doc: SourcesDoc, url: string): Source | undefined {
  return doc.sources.find((s) => s.url === url);
}

// ── applySourceToDir ──────────────────────────────────────────────────────────

/**
 * Upsert a Source into `_sources.json`, re-render `_sources.md`, and reindex.
 * If `input` is undefined or null, returns immediately (legacy callers).
 *
 * All errors are swallowed with a warning — the module + pool that triggered
 * this call already landed. The function always resolves.
 */
export async function applySourceToDir(
  dir: string,
  input: SourceInput | undefined | null,
): Promise<void> {
  if (!input) return;

  try {
    const now = Date.now();
    const title = deriveTitle(input, now);

    // Load existing doc (creates empty {version:1,sources:[]} if missing)
    const doc = await loadSourcesJson(dir);

    // Determine the source id: reuse by URL match (URL-kind) or mint new.
    let existingSource: Source | undefined;
    if (input.kind === 'url' && input.url) {
      existingSource = findExistingByUrl(doc, input.url);
    }

    // Build the new/updated Source object
    const partialSource: Partial<Source> = {
      kind: input.kind,
      title,
      url: input.url,
      raw_text: input.text,
      fetched_at: now,
    };

    // Compute hash BEFORE minting id (id is derived from hash for new sources).
    // We must also set content_hash and updated_at here — writeSourcesJson's
    // normalization guard is `s.content_hash != null && s.updated_at != null`,
    // so '' and 0 both pass the guard and persist on disk unchanged.
    const hash = computeSourceHash(partialSource);
    const id = existingSource?.id ?? `src_${hash.slice(0, 8)}`;

    const source: Source = {
      id,
      kind: input.kind,
      title,
      url: input.url,
      raw_text: input.text,
      fetched_at: now,
      content_hash: hash,
      updated_at: now,
    };

    // Upsert: replace existing entry (same id) or append
    const idx = doc.sources.findIndex((s) => s.id === id);
    if (idx >= 0) {
      doc.sources[idx] = source;
    } else {
      doc.sources.push(source);
    }

    // Persist updated doc (content_hash + updated_at are already set above)
    await writeSourcesJson(dir, doc);

    // Render and write the .md mirror using the in-memory doc (skipping write
    // if byte-identical — no reload needed since we have fully-populated fields)
    await writeMdMirror(dir, doc);

    // Propagate to SQLite cache
    await reindexAffected(dir, 'source', '_sources');
  } catch (err) {
    console.warn(
      `[apply-source] source write failed (module write succeeded): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
