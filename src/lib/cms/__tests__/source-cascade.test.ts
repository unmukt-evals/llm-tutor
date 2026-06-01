/**
 * source-cascade.test.ts — Phase 6 Piece A.
 *
 * When `updateSource` mutates a hash-relevant field on a Source, every
 * `module_sources` row pointing at that source must have `stale_at` set to
 * `Date.now()`. When the patch does NOT change the content_hash, `stale_at`
 * must be left alone.
 *
 * Also covers the three new CmsIndex read/write helpers:
 *   - getStaleModulesForSource(sourceId)
 *   - getStaleSourceLinks()
 *   - clearStaleFlag(moduleId, sourceId)
 *
 * Uses real tmpdir + real on-disk SQLite (default dbPath) because updateSource
 * dispatches through reindexAffected → getCmsIndex(dir), which always uses the
 * default cache file. Each test gets a unique tmpdir and resets the singleton
 * cache.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourcesDoc } from '@/lib/cms/types';
import type { Source } from '@/lib/types';
import { computeSourceHash } from '@/lib/cms/sources/source-hash';
import { updateSource } from '@/lib/cms/sources/store';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';

// ── fixtures ─────────────────────────────────────────────────────────────────

// Module B02 cites S1 and S2 (both are in _sources.json below).
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

// Module B03 cites S1 only.
const B03_MD = `---
module_id: B03
track: B
name: Test Module B03
prerequisites: []
primary_sources: [S1]
---

# Test Module B03

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

function makeSource(overrides: Partial<Source> & Pick<Source, 'id' | 'title'>): Source {
  const base: Source = {
    id: overrides.id,
    kind: overrides.kind ?? 'doc',
    title: overrides.title,
    url: overrides.url,
    author: overrides.author,
    cluster: overrides.cluster,
    summary: overrides.summary,
    thesis: overrides.thesis,
    mechanism: overrides.mechanism,
    quotes: overrides.quotes,
    grounds: overrides.grounds,
    raw_text: overrides.raw_text,
    fetched_at: overrides.fetched_at,
    content_hash: '',
    updated_at: overrides.updated_at ?? 1_000_000,
  };
  base.content_hash = computeSourceHash(base);
  return base;
}

async function seedCurriculum(dir: string): Promise<void> {
  const s1 = makeSource({ id: 'S1', title: 'Source One', cluster: 'Cluster A', summary: 'First summary' });
  const s2 = makeSource({ id: 'S2', title: 'Source Two', cluster: 'Cluster B' });
  const s3 = makeSource({ id: 'S3', title: 'Source Three — unlinked', cluster: 'Cluster C' });
  const doc: SourcesDoc = { version: 1, sources: [s1, s2, s3] };
  await writeFile(join(dir, '_sources.json'), JSON.stringify(doc), 'utf8');
  await writeFile(join(dir, 'B02-test-module-b02.md'), B02_MD, 'utf8');
  await writeFile(join(dir, 'B03-test-module-b03.md'), B03_MD, 'utf8');
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('source cascade staleness', () => {
  let dir: string;

  beforeEach(async () => {
    __resetCmsIndexForTests();
    dir = await mkdtemp(join(tmpdir(), 'cms-cascade-'));
  });

  afterEach(async () => {
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('does NOT flip stale_at when the patch does not change content_hash', async () => {
    await seedCurriculum(dir);

    // Cold boot — sources + modules indexed, module_sources populated.
    {
      const cms = await getCmsIndex(dir);
      // Pre-condition: no stale flags exist anywhere.
      expect(cms.getStaleSourceLinks()).toEqual([]);
    }

    // Patch S1 with the SAME values it already has — hash will be identical.
    await updateSource(dir, 'S1', {
      cluster: 'Cluster A',
      summary: 'First summary',
    });

    const cms = await getCmsIndex(dir);
    // Nothing got marked stale because hash didn't change.
    expect(cms.getStaleSourceLinks()).toEqual([]);
    expect(cms.getStaleModulesForSource('S1')).toEqual([]);
  });

  it('flips stale_at on every citing module when a hash-relevant field changes', async () => {
    await seedCurriculum(dir);
    await getCmsIndex(dir); // cold boot

    const before = Date.now();
    await updateSource(dir, 'S1', { title: 'Source One — renamed' });
    const after = Date.now();

    const cms = await getCmsIndex(dir);
    const stale = cms.getStaleModulesForSource('S1');
    // B02 and B03 both cite S1 → both marked stale.
    expect(stale.map((s) => s.moduleId).sort()).toEqual(['B02', 'B03']);
    for (const row of stale) {
      expect(row.staleAt).toBeGreaterThanOrEqual(before);
      expect(row.staleAt).toBeLessThanOrEqual(after + 5);
    }

    // S2 is only cited by B02; S2 itself wasn't updated → not stale.
    expect(cms.getStaleModulesForSource('S2')).toEqual([]);
    // S3 has no citing modules → empty.
    expect(cms.getStaleModulesForSource('S3')).toEqual([]);
  });

  it('getStaleSourceLinks returns exactly the rows with stale_at NOT NULL, joining source title', async () => {
    await seedCurriculum(dir);
    await getCmsIndex(dir);

    // Update S1 (cited by B02 + B03) — both rows get stale.
    await updateSource(dir, 'S1', { summary: 'Updated summary' });

    const cms = await getCmsIndex(dir);
    const links = cms.getStaleSourceLinks();
    expect(links.length).toBe(2);

    // Sort for stable assertion.
    const sorted = [...links].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
    expect(sorted[0].moduleId).toBe('B02');
    expect(sorted[0].sourceId).toBe('S1');
    expect(sorted[0].sourceTitle).toBe('Source One');
    expect(sorted[0].staleAt).toBeGreaterThan(0);
    expect(sorted[1].moduleId).toBe('B03');
    expect(sorted[1].sourceId).toBe('S1');
    expect(sorted[1].sourceTitle).toBe('Source One');

    // The B02 ↔ S2 link must NOT appear (S2 wasn't updated).
    expect(links.find((l) => l.sourceId === 'S2')).toBeUndefined();
  });

  it('clearStaleFlag clears just the targeted (moduleId, sourceId) row', async () => {
    await seedCurriculum(dir);
    await getCmsIndex(dir);

    await updateSource(dir, 'S1', { title: 'Renamed' });

    // Both B02 and B03 are stale wrt S1.
    let cms = await getCmsIndex(dir);
    expect(cms.getStaleModulesForSource('S1').map((s) => s.moduleId).sort()).toEqual(['B02', 'B03']);

    // Clear just the B02 ↔ S1 row.
    cms.clearStaleFlag('B02', 'S1');

    cms = await getCmsIndex(dir);
    // Only B03 remains stale wrt S1.
    expect(cms.getStaleModulesForSource('S1').map((s) => s.moduleId)).toEqual(['B03']);

    // Global view: exactly one stale link left.
    const links = cms.getStaleSourceLinks();
    expect(links).toHaveLength(1);
    expect(links[0].moduleId).toBe('B03');
  });

  it('clearStaleFlag is a no-op for an unknown (moduleId, sourceId) pair', async () => {
    await seedCurriculum(dir);
    const cms = await getCmsIndex(dir);

    expect(() => cms.clearStaleFlag('NOPE', 'S1')).not.toThrow();
    expect(() => cms.clearStaleFlag('B02', 'NOPE')).not.toThrow();
    // No stale flags should exist (nothing was set).
    expect(cms.getStaleSourceLinks()).toEqual([]);
  });
});
