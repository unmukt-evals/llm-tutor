/**
 * store.ts — Source CRUD helper (Phase 5a Task 2).
 *
 * Server-only CRUD layer over the Source entity. The five exports are:
 *   addSource    — mint a new Source and persist it
 *   updateSource — merge a patch into an existing Source
 *   deleteSource — remove a Source (idempotent on unknown id)
 *   listSources  — thin read facade over getCmsIndex
 *   getSourceById — thin read facade over getCmsIndex
 *
 * Post-mutation pipeline (same shape as apply-source.ts):
 *   1. writeSourcesJson — atomic temp+rename, fills content_hash + updated_at
 *   2. writeMdMirror    — render + atomic-write _sources.md (skip-on-identical)
 *   3. reindexAffected  — propagate to the SQLite cache
 *
 * Steps 2 and 3 are best-effort: failures emit console.warn but do NOT roll back
 * the JSON write. The JSON is the SoT; the watcher re-converges on mtime tick.
 */

import 'server-only';
import type { Source } from '@/lib/types';
import { getCmsIndex } from '@/lib/cms/index';
import { loadSourcesJson, writeSourcesJson } from '@/lib/cms/sources/json-store';
import { computeSourceHash } from '@/lib/cms/sources/source-hash';
import { writeMdMirror } from '@/lib/cms/sources/write-md-mirror';
import { reindexAffected } from '@/lib/cms/reindex';

// ── Public input / result types ───────────────────────────────────────────────

export interface AddSourceInput {
  kind: 'url' | 'transcript' | 'doc' | 'paper';
  title: string;
  url?: string;
  author?: string;
  cluster?: string;
  summary?: string;
  thesis?: string;
  mechanism?: string;
  quotes?: string[];
  grounds?: string[];
  raw_text?: string;
}

export interface UpdateSourceInput extends Partial<AddSourceInput> {}

export interface CrudResult {
  id: string;
  content_hash: string;
}

// ── Post-mutation pipeline ────────────────────────────────────────────────────

/**
 * After writeSourcesJson succeeds, best-effort render the .md mirror and
 * reindex. Failures are swallowed with console.warn — the JSON is the SoT.
 */
async function runPostWritePipeline(dir: string, doc: import('@/lib/cms/types').SourcesDoc): Promise<void> {
  try {
    await writeMdMirror(dir, doc);
  } catch (err) {
    console.warn(
      `[store] _sources.md mirror write failed (JSON write succeeded): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await reindexAffected(dir, 'source', '_sources');
  } catch (err) {
    console.warn(
      `[store] reindexAffected failed (JSON write succeeded): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── addSource ─────────────────────────────────────────────────────────────────

/**
 * Mint a new Source from `input` and append it to `_sources.json`.
 *
 * URL-kind collision: if a Source with the same `url` already exists, throws
 *   `Source with url "<url>" already exists with id <id>`
 * (the Studio POST route maps this to 409).
 *
 * ID minting: `src_<8hex>` from `computeSourceHash` over a canonical view of
 * the input — same recipe as `/api/source/apply`.
 *
 * `content_hash` and `updated_at` are filled BEFORE calling `writeSourcesJson`
 * (Phase 4 Task 10 fix: `hasBoth` is null-strict, so 0 persists as 0).
 */
export async function addSource(dir: string, input: AddSourceInput): Promise<CrudResult> {
  const doc = await loadSourcesJson(dir);

  // URL collision check (URL-kind only)
  if (input.kind === 'url' && input.url) {
    const existing = doc.sources.find((s) => s.url === input.url);
    if (existing) {
      throw new Error(
        `Source with url "${input.url}" already exists with id ${existing.id}`,
      );
    }
  }

  const now = Date.now();

  // Build a partial view for hash computation
  const partial: Partial<Source> = {
    kind: input.kind,
    title: input.title,
    url: input.url,
    author: input.author,
    cluster: input.cluster,
    summary: input.summary,
    thesis: input.thesis,
    mechanism: input.mechanism,
    quotes: input.quotes,
    grounds: input.grounds,
    raw_text: input.raw_text,
    fetched_at: input.kind === 'url' ? now : undefined,
  };

  const id = `src_${computeSourceHash(partial).slice(0, 8)}`;
  const content_hash = computeSourceHash(partial);

  const source: Source = {
    id,
    kind: input.kind,
    title: input.title,
    url: input.url,
    author: input.author,
    cluster: input.cluster,
    summary: input.summary,
    thesis: input.thesis,
    mechanism: input.mechanism,
    quotes: input.quotes ?? [],
    grounds: input.grounds ?? [],
    raw_text: input.raw_text,
    fetched_at: input.kind === 'url' ? now : undefined,
    content_hash,
    updated_at: now,
  };

  doc.sources.push(source);

  // JSON is the SoT — this must succeed (throws on failure)
  await writeSourcesJson(dir, doc);

  // Best-effort post-mutation pipeline
  await runPostWritePipeline(dir, doc);

  return { id, content_hash };
}

// ── updateSource ──────────────────────────────────────────────────────────────

/**
 * Merge `patch` into the existing Source identified by `id`, recompute
 * `content_hash`, bump `updated_at`, and persist.
 *
 * Unknown id → throws `Source not found: <id>` (route maps to 404).
 */
export async function updateSource(
  dir: string,
  id: string,
  patch: UpdateSourceInput,
): Promise<CrudResult> {
  const doc = await loadSourcesJson(dir);
  const idx = doc.sources.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`Source not found: ${id}`);

  const now = Date.now();
  const merged: Source = { ...doc.sources[idx], ...patch };
  merged.content_hash = computeSourceHash(merged);
  merged.updated_at = now;
  doc.sources[idx] = merged;

  // JSON is the SoT — this must succeed (throws on failure)
  await writeSourcesJson(dir, doc);

  // Best-effort post-mutation pipeline
  await runPostWritePipeline(dir, doc);

  return { id, content_hash: merged.content_hash };
}

// ── deleteSource ──────────────────────────────────────────────────────────────

/**
 * Remove the Source identified by `id` from `_sources.json`.
 *
 * Unknown id → returns `{deleted: false}` WITHOUT touching disk (idempotent).
 * Known id   → splices the entry, persists, renders mirror, reindexes.
 */
export async function deleteSource(
  dir: string,
  id: string,
): Promise<{ deleted: boolean }> {
  const doc = await loadSourcesJson(dir);
  const idx = doc.sources.findIndex((s) => s.id === id);
  if (idx < 0) return { deleted: false };

  doc.sources.splice(idx, 1);

  // JSON is the SoT — this must succeed (throws on failure)
  await writeSourcesJson(dir, doc);

  // Best-effort post-mutation pipeline
  await runPostWritePipeline(dir, doc);

  return { deleted: true };
}

// ── listSources ───────────────────────────────────────────────────────────────

/**
 * Return all Sources in the current index.
 *
 * Thin facade over `getCmsIndex(dir).getSources()` — goes through the indexer
 * so the cache path is exercised and reads stay consistent with mutations that
 * call `reindexAffected` after writing.
 */
export async function listSources(dir: string): Promise<Source[]> {
  const cms = await getCmsIndex(dir);
  return cms.getSources();
}

// ── getSourceById ─────────────────────────────────────────────────────────────

/**
 * Return a single Source by id, or `undefined` if not found.
 *
 * Thin facade over `getCmsIndex(dir).getSourceById(id)`.
 */
export async function getSourceById(
  dir: string,
  id: string,
): Promise<Source | undefined> {
  const cms = await getCmsIndex(dir);
  return cms.getSourceById(id);
}
