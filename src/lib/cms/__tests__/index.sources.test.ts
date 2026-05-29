/**
 * Task 8 — CMS read API: getSources / getSourceById / getSourcesForModule
 *
 * Uses getCmsIndex() with:
 *   - A stub FsLike whose readdir returns ['_sources.json'] for tests that
 *     only need the sources table populated (getSources, getSourceById).
 *   - A real tmpdir for getSourcesForModule (requires resolveModulePath's
 *     readdirSync to find the module file).
 *
 * Key insight: getCmsIndex cold-start → lazyRefresh → indexAll, which calls
 * fs.readdir(dir) first. readdir must include '_sources.json' for indexAll to
 * pick it up. Tests that used readdir:()=>[] had an empty sources table.
 *
 * For getSourcesForModule: indexAll processes modules before sources (by design),
 * so FK constraints fire on the first module pass and module_sources is empty.
 * After getCmsIndex, we call reindexEntity('module', ...) to re-establish links
 * once sources exist.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FsLike } from '@/lib/cms/indexer';
import type { SourcesDoc } from '@/lib/cms/types';
import type { Source } from '@/lib/types';
import { computeContentHash } from '@/lib/cms/hash';
import { writeSourcesJson } from '@/lib/cms/sources/json-store';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> & Pick<Source, 'id' | 'title'>): Source {
  const base: Source = {
    id: overrides.id,
    kind: overrides.kind ?? 'url',
    title: overrides.title,
    url: 'url' in overrides ? overrides.url : `https://example.com/${overrides.id}`,
    author: overrides.author,
    cluster: overrides.cluster,
    summary: overrides.summary,
    thesis: overrides.thesis,
    mechanism: overrides.mechanism,
    quotes: overrides.quotes,
    grounds: overrides.grounds,
    raw_text: overrides.raw_text ?? '',
    fetched_at: overrides.fetched_at,
    content_hash: '',
    updated_at: overrides.updated_at ?? Date.now(),
  };
  base.content_hash = computeContentHash(
    JSON.stringify({
      kind: base.kind,
      title: base.title,
      url: base.url,
      author: base.author,
      cluster: base.cluster,
      summary: base.summary,
      thesis: base.thesis,
      mechanism: base.mechanism,
      quotes: base.quotes,
      grounds: base.grounds,
      raw_text: base.raw_text,
      fetched_at: base.fetched_at,
    }),
  );
  return base;
}

function makeDoc(sources: Source[]): SourcesDoc {
  return { version: 1, sources };
}

/**
 * Build a FsLike that serves _sources.json and nothing else.
 * readdir returns ['_sources.json'] so indexAll cold-start picks it up.
 */
function makeSourcesOnlyFs(doc: SourcesDoc, dir: string): FsLike {
  const jsonStr = JSON.stringify(doc);
  const sourcesPath = `${dir}/_sources.json`;
  return {
    readFile: async (p) => {
      if (p === sourcesPath) return jsonStr;
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    stat: async () => ({ mtimeMs: 1_000_000 }),
    readdir: async (p) => {
      // Top-level dir: return only _sources.json so indexAll finds it.
      // Any sub-dir (e.g. mcq/): return empty.
      if (p === dir) return ['_sources.json'];
      return [];
    },
  };
}

// Minimal module markdown with primary_sources: ["S1","S2"]
const B02_MD = `---
module_id: B02
track: B
name: Test Module B02
prerequisites: []
primary_sources: [S1, S2]
---

# Test Module B02

## Why this matters

Testing.

## Anchor scenarios

1. Test anchor.

### 10-year-old pass

Simple.

### Engineer pass

Technical.

## Application drills

### Drill 1

**Scenario:** Test drill.

## Stress-test pool

### Stress test 1

**Lens:** board
**Question:** Is this tested?

## Flashcard seeds

Test seed.

## Sources

- S1
`;

// ── 1. getSources() ───────────────────────────────────────────────────────────

describe('getSources()', () => {
  it('returns all 3 sources ordered by id, every field matches input', async () => {
    __resetCmsIndexForTests();
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-read-'));
    try {
      const s1 = makeSource({
        id: 'S1', title: 'Alpha',
        summary: 'Summary A', author: 'Alice', cluster: 'Cluster 1',
        thesis: 'Thesis A', mechanism: 'Mechanism A',
        quotes: ['Q1', 'Q2'], grounds: ['B01'],
      });
      const s2 = makeSource({ id: 'S2', title: 'Beta', kind: 'doc', url: undefined });
      const s3 = makeSource({ id: 'S3', title: 'Gamma', kind: 'paper' });

      const doc = makeDoc([s1, s2, s3]);
      const fs = makeSourcesOnlyFs(doc, tmp);

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:', fs });
      const sources = cms.getSources();

      expect(sources).toHaveLength(3);
      // Ordered by id ASC
      expect(sources.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);

      const got1 = sources.find((s) => s.id === 'S1')!;
      expect(got1.title).toBe('Alpha');
      expect(got1.kind).toBe('url');
      expect(got1.summary).toBe('Summary A');
      expect(got1.author).toBe('Alice');
      expect(got1.cluster).toBe('Cluster 1');
      expect(got1.thesis).toBe('Thesis A');
      expect(got1.mechanism).toBe('Mechanism A');
      // quotes/grounds: always-array semantics per plan decision
      expect(got1.quotes).toEqual(['Q1', 'Q2']);
      expect(got1.grounds).toEqual(['B01']);

      const got2 = sources.find((s) => s.id === 'S2')!;
      expect(got2.url).toBeUndefined();
      expect(got2.author).toBeUndefined();
      expect(got2.cluster).toBeUndefined();
      expect(got2.summary).toBeUndefined();
      expect(got2.thesis).toBeUndefined();
      expect(got2.mechanism).toBeUndefined();
      // Default empty arrays for absent quotes/grounds (column DEFAULT '[]')
      expect(got2.quotes).toEqual([]);
      expect(got2.grounds).toEqual([]);
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns [] when the sources table is empty', async () => {
    __resetCmsIndexForTests();
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-empty-'));
    try {
      // No files at all — indexAll finds nothing, sources table stays empty.
      const emptyFs: FsLike = {
        readFile: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
        stat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
        readdir: async () => [],
      };
      const cms = await getCmsIndex(tmp, { dbPath: ':memory:', fs: emptyFs });
      expect(cms.getSources()).toEqual([]);
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── 2. getSourceById() ────────────────────────────────────────────────────────

describe('getSourceById()', () => {
  it('returns the matching Source when id exists', async () => {
    __resetCmsIndexForTests();
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-byid-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Alpha', summary: 'Summary A' });
      const s2 = makeSource({ id: 'S2', title: 'Beta' });
      const doc = makeDoc([s1, s2]);
      const fs = makeSourcesOnlyFs(doc, tmp);

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:', fs });

      const found = cms.getSourceById('S1');
      expect(found).toBeDefined();
      expect(found!.id).toBe('S1');
      expect(found!.title).toBe('Alpha');
      expect(found!.summary).toBe('Summary A');
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns undefined for an unknown id', async () => {
    __resetCmsIndexForTests();
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-byid-miss-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Alpha' });
      const doc = makeDoc([s1]);
      const fs = makeSourcesOnlyFs(doc, tmp);

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:', fs });
      expect(cms.getSourceById('does-not-exist')).toBeUndefined();
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── 3. getSourcesForModule() ──────────────────────────────────────────────────

describe('getSourcesForModule()', () => {
  it('returns exactly the 2 sources linked to B02, not the unlinked one', async () => {
    // Uses real tmpdir because resolveModulePath calls readdirSync.
    //
    // indexAll processes modules before sources (by design). On the first cold
    // pass, B02's FK inserts fail because sources aren't in the table yet.
    //
    // indexEntity has a hash-skip guard: if the module file hash hasn't changed
    // since the last index, it returns early and skips writeModule entirely.
    // To force a re-run of writeModule (so module_sources gets populated now
    // that sources exist), we append a trailing newline to the module file
    // between the initial getCmsIndex and the reindexEntity call. The changed
    // hash bypasses the guard, writeModule runs, FK succeeds.
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-formod-'));
    __resetCmsIndexForTests();
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const s2 = makeSource({ id: 'S2', title: 'Source Two' });
      const s3 = makeSource({ id: 'S3', title: 'Source Three — unlinked' });
      const doc = makeDoc([s1, s2, s3]);

      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');
      // B02 only references S1 and S2 (per B02_MD above)
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      // Cold start: indexAll runs module before sources → FK failures for S1/S2.
      // Sources ARE indexed by the end of indexAll, but module_sources is empty.
      const cms = await getCmsIndex(tmp, { dbPath: ':memory:' });

      // Bust the module file's hash so reindexEntity actually re-runs writeModule.
      // A trailing newline doesn't affect parsing but changes the sha256.
      const modPath = join(tmp, 'B02-test-module-b02.md');
      await writeFile(modPath, B02_MD + '\n', 'utf8');

      // Re-index B02 — now hash differs, writeModule runs, sources exist → FK ok.
      await cms.reindexEntity('module', 'B02');

      const forMod = cms.getSourcesForModule('B02');

      expect(forMod).toHaveLength(2);
      expect(forMod.map((s) => s.id).sort()).toEqual(['S1', 'S2']);
      // S3 must not appear
      expect(forMod.find((s) => s.id === 'S3')).toBeUndefined();
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns [] for a module with no source links', async () => {
    __resetCmsIndexForTests();
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-nolinks-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const doc = makeDoc([s1]);
      const fs = makeSourcesOnlyFs(doc, tmp);

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:', fs });
      expect(cms.getSourcesForModule('B99')).toEqual([]);
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── 4. Round-trip via writeSourcesJson → indexer → getSources() ──────────────

describe('round-trip: writeSourcesJson → indexer → getSources()', () => {
  it('produces sources deep-equal to the input doc (quotes/grounds default to [])', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-sources-roundtrip-'));
    __resetCmsIndexForTests();
    try {
      const s1 = makeSource({
        id: 'S1', title: 'Alpha',
        quotes: ['Quote A'], grounds: ['B01'],
      });
      const s2 = makeSource({ id: 'S2', title: 'Beta', kind: 'doc', url: undefined });
      const doc = makeDoc([s1, s2]);

      // Write via the json-store helper (atomic write to real tmpdir)
      await writeSourcesJson(tmp, doc);

      // Index via getCmsIndex (picks up the real file)
      const cms = await getCmsIndex(tmp, { dbPath: ':memory:' });
      const sources = cms.getSources();

      expect(sources).toHaveLength(2);

      // S1: explicit quotes/grounds round-trip correctly
      const got1 = sources.find((s) => s.id === 'S1')!;
      expect(got1.title).toBe('Alpha');
      expect(got1.quotes).toEqual(['Quote A']);
      expect(got1.grounds).toEqual(['B01']);

      // S2: no quotes/grounds in input → stored as '[]' → read back as []
      const got2 = sources.find((s) => s.id === 'S2')!;
      expect(got2.quotes).toEqual([]);
      expect(got2.grounds).toEqual([]);
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
