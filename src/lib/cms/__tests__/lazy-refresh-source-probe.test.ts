/**
 * Tests for the _sources.json singleton probe in lazyRefresh (Section 3.5).
 *
 * Bug: lazyRefresh reconciled modules/pools/flashcards/state but did NOT probe
 * _sources.json. Pre-Phase-4 caches (or any cache without a 'source' row in
 * index_rows) would silently miss source updates until the SQLite file was nuked.
 *
 * Three tests:
 *   A — bug repro: cold boot without _sources.json, then warm boot WITH _sources.json
 *       → lazyRefresh must pick it up.
 *   B — warm-path short-circuit: unchanged file between two warm calls must NOT
 *       re-read the file.
 *   C — content-changed: mutated _sources.json between warm calls → new source appears.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';
import { defaultFs } from '@/lib/cms/indexer';
import type { SourcesDoc } from '@/lib/cms/types';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSourcesDoc(ids: string[]): SourcesDoc {
  return {
    version: 1,
    sources: ids.map((id) => ({
      id,
      kind: 'url' as const,
      title: `Source ${id}`,
      url: `https://example.com/${id}`,
      raw_text: '',
      content_hash: '',
      updated_at: Date.now(),
    })),
  };
}

// Minimal valid module markdown (needed so cold-boot indexAll has at least one
// entity and writes something to index_rows — establishing the "pre-Phase-4
// cache" scenario where a source row does not yet exist).
const MODULE_MD = `---
module_id: Z99
track: Z
name: Probe Test Module
prerequisites: []
primary_sources: []
---

# Probe Test Module

## Why this matters

Fixture for lazyRefresh source-probe tests.

## Anchor scenarios

1. Test scenario.

### 10-year-old pass

Simple explanation.

### Engineer pass

Technical explanation.

## Application drills

### Drill 1

**Scenario:** Test drill scenario.

## Stress-test pool

### Stress test 1

**Lens:** board
**Question:** Is this tested?

## Flashcard seeds

Test seed.

## Sources

(none)
`;

// ── Test A — bug repro ────────────────────────────────────────────────────────

describe('lazyRefresh source probe — Test A: pre-Phase-4 cache scenario', () => {
  it('picks up _sources.json added between cold boot and warm boot', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-source-probe-a-'));
    __resetCmsIndexForTests();
    try {
      // 1. Write a module file but NO _sources.json yet.
      await writeFile(join(tmp, 'Z99-probe-test-module.md'), MODULE_MD, 'utf8');

      // 2. Cold boot — indexAll runs. _sources.json doesn't exist → no 'source'
      //    row in index_rows. This simulates a pre-Phase-4 cache.
      const dbPath = join(tmp, 'cache.sqlite');
      await getCmsIndex(tmp, { dbPath });
      __resetCmsIndexForTests(); // close the DB / drop the singleton

      // 3. Now write _sources.json to disk (after the initial indexAll).
      const doc = makeSourcesDoc(['S1']);
      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');

      // 4. Warm boot — lazyRefresh runs. Without the fix, the source probe is
      //    missing and getSources() returns []. With the fix it returns 1.
      const cms = await getCmsIndex(tmp, { dbPath });
      expect(cms.getSources()).toHaveLength(1);
      expect(cms.getSources()[0].id).toBe('S1');
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── Test B — warm-path short-circuit ─────────────────────────────────────────

describe('lazyRefresh source probe — Test B: mtime short-circuit on unchanged file', () => {
  it('does NOT re-read _sources.json when mtime is unchanged between warm calls', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-source-probe-b-'));
    __resetCmsIndexForTests();
    try {
      const dbPath = join(tmp, 'cache.sqlite');

      // 1. Write _sources.json before cold boot.
      const doc = makeSourcesDoc(['S1', 'S2']);
      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');

      // 2. Cold boot — indexAll indexes the sources.
      await getCmsIndex(tmp, { dbPath });
      __resetCmsIndexForTests();

      // 3. First warm boot — lazyRefresh runs, reads the file (mtime mismatch
      //    possible on first warm call), marks it.
      await getCmsIndex(tmp, { dbPath });
      __resetCmsIndexForTests();

      // 4. Spy on the real defaultFs.readFile.
      const spy = vi.spyOn(defaultFs, 'readFile');

      // 5. Second warm boot — file is unchanged, mtime_ms cached → should
      //    short-circuit WITHOUT calling readFile for _sources.json.
      const cms = await getCmsIndex(tmp, { dbPath });

      // Verify sources still correct.
      expect(cms.getSources()).toHaveLength(2);

      // readFile should NOT have been called for _sources.json.
      const sourcesReadCalls = spy.mock.calls.filter(
        (args) => String(args[0]).endsWith('_sources.json'),
      );
      expect(sourcesReadCalls).toHaveLength(0);

      spy.mockRestore();
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── Test C — content changed ──────────────────────────────────────────────────

describe('lazyRefresh source probe — Test C: content change between warm calls', () => {
  it('picks up a newly added source after _sources.json is mutated', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-source-probe-c-'));
    __resetCmsIndexForTests();
    try {
      const dbPath = join(tmp, 'cache.sqlite');

      // 1. Cold boot with initial sources.
      const docV1 = makeSourcesDoc(['S1']);
      await writeFile(join(tmp, '_sources.json'), JSON.stringify(docV1), 'utf8');
      await getCmsIndex(tmp, { dbPath });
      __resetCmsIndexForTests();

      // 2. Mutate _sources.json — add S2.
      const docV2 = makeSourcesDoc(['S1', 'S2']);
      await writeFile(join(tmp, '_sources.json'), JSON.stringify(docV2), 'utf8');

      // 3. Warm boot — lazyRefresh should detect content change and reindex.
      const cms = await getCmsIndex(tmp, { dbPath });
      expect(cms.getSources()).toHaveLength(2);
      const ids = cms.getSources().map((s) => s.id).sort();
      expect(ids).toEqual(['S1', 'S2']);
    } finally {
      __resetCmsIndexForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
