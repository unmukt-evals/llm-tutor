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
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
    // indexAll now processes sources BEFORE modules, so on a cold boot the
    // sources(id) rows exist when writeModule inserts into module_sources.
    // A single getCmsIndex call is sufficient — no re-touch or reindexEntity.
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

      // Single cold-boot pass — sources indexed first, then module. FK succeeds.
      const cms = await getCmsIndex(tmp, { dbPath: ':memory:' });

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

// ── 5. getModulesForSource() ──────────────────────────────────────────────────

describe('getModulesForSource()', () => {
  it('returns the modules that cite a source, ordered by id', async () => {
    // Arrange: a curriculum dir with S1, S2 sources + module B02 citing both.
    const tmp = await mkdtemp(join(tmpdir(), 'cms-modules-for-source-'));
    __resetCmsIndexForTests();
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const s2 = makeSource({ id: 'S2', title: 'Source Two' });
      const doc = makeDoc([s1, s2]);

      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');
      // B02_MD cites both S1 and S2 (defined above)
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:' });

      // S1 is cited by B02
      const mods = cms.getModulesForSource('S1');
      expect(mods).toHaveLength(1);
      expect(mods[0].id).toBe('B02');
      expect(mods[0].name).toBe('Test Module B02');
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns an empty array for an unknown source id', async () => {
    __resetCmsIndexForTests();
    const tmp = await mkdtemp(join(tmpdir(), 'cms-modules-for-source-miss-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const doc = makeDoc([s1]);
      const fs = makeSourcesOnlyFs(doc, tmp);

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:', fs });
      expect(cms.getModulesForSource('does-not-exist')).toEqual([]);
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── 6. Task 9 — ensureSourcesJson called in bootstrap ────────────────────────
//
// Scenario: curriculum dir has only `_sources.md` (no `_sources.json`).
// After `getCmsIndex(dir)`:
//   (a) `_sources.json` exists on disk (bootstrap created it).
//   (b) `getSources()` returns the migrated source list (non-empty, ids match).

// Small but real excerpt used as the _sources.md fixture.
// Two sources in two different clusters, one with a sub-letter id (S9a).
const BOOTSTRAP_SOURCES_MD = `---
type: source-library
verified: 2026-01-01
---

# Track B — Primary Source Library

Intro paragraph.

---

## Cluster 1 — RL post-training

### S2 · Why GRPO is important — Oxen.ai
- **URL:** https://ghost.oxen.ai/why-grpo/
- **What:** Practitioner walkthrough of GRPO.
- **Thesis:** Drops the value model, halves compute.
- **Grounds:** B2, B3

---

## Cluster 5 — Mechanistic interpretability

### S9a · Scaling Monosemanticity — Anthropic
- **URL:** https://transformer-circuits.pub/2024/scaling-monosemanticity/index.html
- **What:** Scaled sparse autoencoders to Claude 3 Sonnet.
- **Quote:** "The linear representation hypothesis..."
- **Grounds:** B7
`;

describe('Task 9 — bootstrap calls ensureSourcesJson', () => {
  it('migrates _sources.md to _sources.json on cold boot; getSources() returns migrated list', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-bootstrap-sources-'));
    __resetCmsIndexForTests();
    try {
      // Write _sources.md ONLY — no _sources.json.
      await writeFile(join(tmp, '_sources.md'), BOOTSTRAP_SOURCES_MD, 'utf8');

      // Cold boot — this should invoke ensureSourcesJson internally.
      const cms = await getCmsIndex(tmp, { dbPath: ':memory:' });

      // (a) _sources.json must now exist on disk.
      expect(existsSync(join(tmp, '_sources.json'))).toBe(true);

      // (b) getSources() must return the migrated sources.
      const sources = cms.getSources();
      expect(sources.length).toBeGreaterThanOrEqual(2);

      const ids = sources.map((s) => s.id);
      expect(ids).toContain('S2');
      expect(ids).toContain('S9a');

      // Spot-check a field to confirm parsing worked.
      const s2 = sources.find((s) => s.id === 'S2')!;
      expect(s2.title).toContain('GRPO');
      expect(s2.cluster).toContain('Cluster 1');

      // Verify the on-disk JSON is valid and contains the migrated sources.
      const jsonRaw = await readFile(join(tmp, '_sources.json'), 'utf8');
      const parsed = JSON.parse(jsonRaw) as { version: number; sources: { id: string }[] };
      expect(parsed.version).toBe(1);
      expect(parsed.sources.map((s) => s.id)).toContain('S2');
      expect(parsed.sources.map((s) => s.id)).toContain('S9a');
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('does not re-migrate if _sources.json already exists (idempotent bootstrap)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-bootstrap-idempotent-'));
    __resetCmsIndexForTests();
    try {
      // Write both files — _sources.json wins; _sources.md is ignored.
      const s1 = makeSource({ id: 'S1', title: 'Pre-existing Source' });
      const doc = makeDoc([s1]);
      await writeSourcesJson(tmp, doc);
      await writeFile(join(tmp, '_sources.md'), BOOTSTRAP_SOURCES_MD, 'utf8');

      const cms = await getCmsIndex(tmp, { dbPath: ':memory:' });

      // Only S1 should come back — the .md sources (S2, S9a) must NOT appear
      // because the JSON was already present (ensureSourcesJson is a no-op).
      const sources = cms.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('S1');
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
