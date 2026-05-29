/**
 * store.test.ts — Source CRUD helper tests (Phase 5a Task 2).
 *
 * Uses a real tmpdir + real fs for integration-level coverage.
 * Stubs `reindexAffected` via `vi.mock('@/lib/cms/reindex')` so tests don't
 * need a real SQLite DB — the mock records calls without side effects.
 *
 * Test coverage:
 * 1. addSource (kind:'doc') → mints src_<8hex> id, returns {id,content_hash},
 *    _sources.json contains the new Source, _sources.md is rendered,
 *    reindexAffected called once with ('source','_sources').
 * 2. addSource (kind:'url') with url that collides on existing → throws with
 *    "already exists with id <id>"; JSON unchanged.
 * 3. updateSource with known id + partial patch → merges, bumps hash+updated_at,
 *    writes through.
 * 4. updateSource with unknown id → throws "not found: <id>".
 * 5. deleteSource with known id → returns {deleted:true}, doc.sources shorter,
 *    reindex fired.
 * 6. deleteSource with unknown id → returns {deleted:false}, no write, no reindex.
 * 7. Mirror write failure does NOT roll back the JSON write.
 * 8. listSources + getSourceById delegate to getCmsIndex.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';
import { writeSourcesJson } from '@/lib/cms/sources/json-store';
import { computeSourceHash } from '@/lib/cms/sources/source-hash';

// ── Mock reindexAffected before importing store ───────────────────────────────
// vi.mock hoists to the top of the module — the mock is in place before
// store.ts imports reindex.ts.

vi.mock('@/lib/cms/reindex', () => ({
  reindexAffected: vi.fn().mockResolvedValue({ ok: true }),
}));

// Import after the mock is registered
import { addSource, updateSource, deleteSource, listSources, getSourceById } from '@/lib/cms/sources/store';
import { reindexAffected } from '@/lib/cms/reindex';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> & { id: string }): Source {
  return {
    kind: 'url',
    title: 'Fixture Source',
    url: 'https://example.com/fixture',
    content_hash: computeSourceHash({ kind: 'url', title: 'Fixture Source', url: 'https://example.com/fixture' }),
    updated_at: 1000000,
    ...overrides,
  };
}

async function seedDoc(dir: string, sources: Source[]): Promise<void> {
  const doc: SourcesDoc = { version: 1, sources };
  await writeSourcesJson(dir, doc);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('addSource', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-store-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Test 1: addSource (kind:'doc') ───────────────────────────────────────
  it('mints src_<8hex> id, writes _sources.json, renders _sources.md, calls reindexAffected once', async () => {
    const result = await addSource(dir, {
      kind: 'doc',
      title: 'My Document Source',
      author: 'Jane Doe',
      cluster: 'Cluster 1',
    });

    // Returns {id, content_hash}
    expect(result.id).toMatch(/^src_[0-9a-f]{8}$/);
    expect(result.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // _sources.json contains the new Source
    const raw = await readFile(join(dir, '_sources.json'), 'utf8');
    const doc = JSON.parse(raw) as SourcesDoc;
    expect(doc.sources).toHaveLength(1);
    const src = doc.sources[0];
    expect(src.id).toBe(result.id);
    expect(src.kind).toBe('doc');
    expect(src.title).toBe('My Document Source');
    expect(src.author).toBe('Jane Doe');
    expect(src.cluster).toBe('Cluster 1');
    expect(src.content_hash).toBe(result.content_hash);
    // Real values (not placeholders)
    expect(src.updated_at).toBeGreaterThan(Date.now() - 5000);
    // fetched_at should be undefined for 'doc' kind
    expect(src.fetched_at).toBeUndefined();

    // _sources.md rendered
    const md = await readFile(join(dir, '_sources.md'), 'utf8');
    expect(md).toContain('type: source-library');
    expect(md).toContain('My Document Source');

    // reindexAffected called once with correct args
    expect(reindexAffected).toHaveBeenCalledTimes(1);
    expect(reindexAffected).toHaveBeenCalledWith(dir, 'source', '_sources');
  });

  // ── Test 1b: addSource (kind:'url') sets fetched_at ──────────────────────
  it('sets fetched_at for kind:url and leaves it undefined for other kinds', async () => {
    const before = Date.now();
    const urlResult = await addSource(dir, {
      kind: 'url',
      title: 'URL Source',
      url: 'https://example.com/new-unique-url',
    });
    const after = Date.now();

    const raw = await readFile(join(dir, '_sources.json'), 'utf8');
    const doc = JSON.parse(raw) as SourcesDoc;
    const src = doc.sources.find((s) => s.id === urlResult.id)!;
    expect(src.fetched_at).toBeGreaterThanOrEqual(before);
    expect(src.fetched_at).toBeLessThanOrEqual(after);
  });

  // ── Test 2: addSource with colliding URL → throws ────────────────────────
  it('throws "already exists with id S1" when url collides with an existing source', async () => {
    const existingSource = makeSource({ id: 'S1', url: 'https://example.com/collision' });
    await seedDoc(dir, [existingSource]);

    // Record the JSON content before the attempted add
    const jsonBefore = await readFile(join(dir, '_sources.json'), 'utf8');

    await expect(
      addSource(dir, {
        kind: 'url',
        title: 'Duplicate URL',
        url: 'https://example.com/collision',
      }),
    ).rejects.toThrow('already exists with id S1');

    // JSON must be unchanged (no write happened)
    const jsonAfter = await readFile(join(dir, '_sources.json'), 'utf8');
    expect(jsonAfter).toBe(jsonBefore);
  });
});

describe('updateSource', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-store-update-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Test 3: updateSource with known id ───────────────────────────────────
  it('merges patch into existing Source, bumps content_hash + updated_at, writes through', async () => {
    const existing = makeSource({
      id: 'S1',
      kind: 'url',
      title: 'Original Title',
      url: 'https://example.com/s1',
      cluster: 'Cluster A',
    });
    await seedDoc(dir, [existing]);

    const oldUpdatedAt = existing.updated_at;
    // Advance time by at least 1ms to ensure updated_at bumps
    await new Promise((r) => setTimeout(r, 2));

    const result = await updateSource(dir, 'S1', {
      title: 'Updated Title',
      summary: 'A summary',
    });

    expect(result.id).toBe('S1');
    expect(result.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const raw = await readFile(join(dir, '_sources.json'), 'utf8');
    const doc = JSON.parse(raw) as SourcesDoc;
    const src = doc.sources[0];
    expect(src.title).toBe('Updated Title');          // patched
    expect(src.summary).toBe('A summary');             // new field
    expect(src.cluster).toBe('Cluster A');             // preserved
    expect(src.url).toBe('https://example.com/s1');    // preserved
    expect(src.updated_at).toBeGreaterThan(oldUpdatedAt);
    expect(src.content_hash).toBe(result.content_hash);

    // reindexAffected called
    expect(reindexAffected).toHaveBeenCalledTimes(1);
    expect(reindexAffected).toHaveBeenCalledWith(dir, 'source', '_sources');
  });

  // ── Test 4: updateSource with unknown id → throws ────────────────────────
  it('throws "Source not found: <id>" for an unknown id', async () => {
    await seedDoc(dir, []);

    await expect(
      updateSource(dir, 'nonexistent', { title: 'New Title' }),
    ).rejects.toThrow('Source not found: nonexistent');

    // reindexAffected must NOT have been called
    expect(reindexAffected).not.toHaveBeenCalled();
  });
});

describe('deleteSource', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-store-delete-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Test 5: deleteSource with known id ───────────────────────────────────
  it('removes the source, returns {deleted:true}, writes through, reindexes', async () => {
    const s1 = makeSource({ id: 'S1', url: 'https://example.com/s1' });
    const s2 = makeSource({ id: 'S2', url: 'https://example.com/s2' });
    await seedDoc(dir, [s1, s2]);

    const result = await deleteSource(dir, 'S1');

    expect(result).toEqual({ deleted: true });

    const raw = await readFile(join(dir, '_sources.json'), 'utf8');
    const doc = JSON.parse(raw) as SourcesDoc;
    expect(doc.sources).toHaveLength(1);
    expect(doc.sources[0].id).toBe('S2');

    // reindexAffected called
    expect(reindexAffected).toHaveBeenCalledTimes(1);
    expect(reindexAffected).toHaveBeenCalledWith(dir, 'source', '_sources');
  });

  // ── Test 6: deleteSource with unknown id → returns {deleted:false} ───────
  it('returns {deleted:false} for unknown id without touching disk', async () => {
    const s1 = makeSource({ id: 'S1', url: 'https://example.com/s1' });
    await seedDoc(dir, [s1]);
    const jsonBefore = await readFile(join(dir, '_sources.json'), 'utf8');

    const result = await deleteSource(dir, 'does-not-exist');

    expect(result).toEqual({ deleted: false });

    // JSON unchanged
    const jsonAfter = await readFile(join(dir, '_sources.json'), 'utf8');
    expect(jsonAfter).toBe(jsonBefore);

    // reindexAffected NOT called
    expect(reindexAffected).not.toHaveBeenCalled();
  });
});

describe('store — mirror failure isolation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-store-mirror-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Test 7: mirror write failure does NOT roll back JSON ─────────────────
  it('does not roll back JSON when _sources.md write fails', async () => {
    // Stub writeMdMirror to simulate a failure
    const mirrorMod = await import('@/lib/cms/sources/write-md-mirror');
    const mirrorSpy = vi.spyOn(mirrorMod, 'writeMdMirror').mockRejectedValueOnce(
      new Error('simulated mirror write failure'),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await addSource(dir, {
        kind: 'doc',
        title: 'Source With Mirror Failure',
      });

      // The JSON MUST have been written (SoT is the JSON)
      const raw = await readFile(join(dir, '_sources.json'), 'utf8');
      const doc = JSON.parse(raw) as SourcesDoc;
      expect(doc.sources).toHaveLength(1);
      expect(doc.sources[0].title).toBe('Source With Mirror Failure');

      // A warning was emitted (not a throw)
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      mirrorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('listSources + getSourceById', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-store-read-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── Test 8: listSources and getSourceById delegate to getCmsIndex ────────
  it('listSources returns all sources in the doc', async () => {
    const s1 = makeSource({ id: 'S1', url: 'https://example.com/s1' });
    const s2 = makeSource({ id: 'S2', url: 'https://example.com/s2' });
    await seedDoc(dir, [s1, s2]);

    const sources = await listSources(dir);
    expect(sources).toHaveLength(2);
    const ids = sources.map((s) => s.id);
    expect(ids).toContain('S1');
    expect(ids).toContain('S2');
  });

  it('getSourceById returns the source when it exists', async () => {
    const s1 = makeSource({ id: 'S1', url: 'https://example.com/s1', title: 'S1 Title' });
    await seedDoc(dir, [s1]);

    const found = await getSourceById(dir, 'S1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('S1');
    expect(found!.title).toBe('S1 Title');
  });

  it('getSourceById returns undefined for an unknown id', async () => {
    await seedDoc(dir, []);

    const found = await getSourceById(dir, 'does-not-exist');
    expect(found).toBeUndefined();
  });
});
