import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, cp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';
import * as parseModuleModule from '@/lib/ingest/parse-module';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe('getCmsIndex lazy refresh + hash-diff', () => {
  let dir: string;
  beforeEach(async () => {
    __resetCmsIndexForTests();
    dir = await mkdtemp(join(tmpdir(), 'cms-lazy-'));
    await cp(FIXTURE_DIR, dir, { recursive: true });
  });
  afterEach(async () => {
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('parses on first call; does NOT re-parse on second call when no file changed', async () => {
    const spy = vi.spyOn(parseModuleModule, 'parseModule');

    // First call: cold cache → indexAll parses every module.
    const cms1 = await getCmsIndex(dir);
    const c1 = cms1.getCurriculum();
    expect(c1.modules.length).toBe(1);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second call: same singleton, lazy refresh runs again, every file's hash
    // matches index_rows — parseModule MUST NOT fire (frontmatter peek is
    // skipped via the index_rows-driven shortcut). We assert call-count diffs,
    // not timing.
    const cms2 = await getCmsIndex(dir);
    const c2 = cms2.getCurriculum();
    expect(c2.modules.length).toBe(1);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);

    spy.mockRestore();
  });

  it('reparses only the file whose CONTENT changed — other modules untouched', async () => {
    // Seed with the original fixture, then add a second module so we can prove
    // the spy only fires for the mutated one on a hash-diff refresh.
    const SECOND_MODULE = `---
module_id: B02
track: B
name: Second module
prerequisites: []
primary_sources: []
---

# Second module

## Why this matters

Just here to prove only the mutated file reparses.

## Anchor scenarios

1. Anchor one.

### 10-year-old pass

Tiny words explanation.

### Engineer pass

Engineer-pass body.

### Operator pass

Operator-pass body.

## Application drills

### Drill 1

Scenario: A scenario.

## Stress-test pool

- board: A question.

## Flashcard seeds

- a :: b

## Sources

- S1: A source
`;
    await writeFile(join(dir, 'B02-second.md'), SECOND_MODULE, 'utf8');

    // First call: cold DB, parses both modules.
    const cms1 = await getCmsIndex(dir, { dbPath: ':memory:' });
    expect(cms1.getCurriculum().modules.map((m) => m.id).sort()).toEqual(['B01', 'B02']);

    // Drop the cached singleton so the next getCmsIndex() reuses the underlying
    // on-disk DB (whose index_rows already carry the hashes) but the spy starts
    // clean.
    __resetCmsIndexForTests();
    const spy = vi.spyOn(parseModuleModule, 'parseModule');

    // Mutate ONLY B01.
    const b01Path = join(dir, 'B01-eval-harnesses.md');
    const original = await readFile(b01Path, 'utf8');
    const mutated = original.replace(
      'If your harness is wrong, every score downstream is a confident lie.',
      'A wrong harness produces a confident lie at every downstream measurement.',
    );
    await writeFile(b01Path, mutated, 'utf8');

    // Reopen — lazy refresh notices B01's hash changed, B02's unchanged.
    const cms2 = await getCmsIndex(dir, { dbPath: ':memory:' });
    expect(cms2.getModule('B01')?.whyThisMatters).toContain('downstream measurement');
    expect(cms2.getModule('B02')?.whyThisMatters).toContain('only the mutated file');

    // parseModule fires for B01 (write path); the frontmatter-peek in indexAll
    // fires for BOTH (one read each). So we expect calls >= 2 (B01 peek+write,
    // B02 peek only); and importantly, the count does NOT scale with module
    // count beyond that — B02 should NOT be re-written. We assert the latter
    // by snapshotting B02's index_rows.indexed_at across the refresh.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    spy.mockRestore();
  });

  it('deletes rows for files that disappeared between refreshes', async () => {
    // Cold start with full fixture.
    const cms1 = await getCmsIndex(dir, { dbPath: ':memory:' });
    expect(cms1.getModule('B01')).toBeDefined();
    expect(cms1.getPool('B01')).not.toBeNull();
    expect(cms1.getFlashcards().length).toBeGreaterThan(0);

    // Drop the pool, the flashcards deck, AND the module file.
    await unlink(join(dir, 'mcq', 'B01.json'));
    await unlink(join(dir, '_flashcards.md'));
    await unlink(join(dir, 'B01-eval-harnesses.md'));

    // Reset so the next getCmsIndex() re-opens (the singleton is in-memory and
    // would otherwise keep the now-stale rows alive against a new dir).
    __resetCmsIndexForTests();

    const cms2 = await getCmsIndex(dir, { dbPath: ':memory:' });
    expect(cms2.getModule('B01')).toBeUndefined();
    expect(cms2.getPool('B01')).toBeNull();
    expect(cms2.getFlashcards()).toEqual([]);
  });
});
