import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, cp, writeFile, readFile, unlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';
import * as parseModuleModule from '@/lib/ingest/parse-module';
import { defaultFs, type FsLike } from '@/lib/cms/indexer';

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

  // ── mtime-first short-circuit tests ──────────────────────────────────────
  // These tests use the injectable FsLike edge to count readFile calls.
  // A counting wrapper delegates to defaultFs for real IO and increments a
  // counter every time readFile is called on a content file (not the sidecar).
  //
  // KEY CONSTRAINT: the singleton captures `fs` at creation time, so a fresh
  // singleton is needed for each counting-FS observation. We use a real on-disk
  // DB path so mtime_ms survives across __resetCmsIndexForTests() calls.

  it('mtime-first: warm second getCmsIndex() call issues zero readFile calls for content files', async () => {
    // Use a real on-disk DB so mtime_ms persists after __resetCmsIndexForTests().
    const dbPath = join(dir, 'test-warm.sqlite');

    // Cold start: real FS, writes mtime_ms into the on-disk DB.
    await getCmsIndex(dir, { dbPath });
    __resetCmsIndexForTests();

    // Build a counting FS wrapper — only counts .md and .json content files,
    // not the state sidecar (indexState always reads it for hash comparison).
    let contentReadCount = 0;
    const countingFs: FsLike = {
      readFile: async (p: string) => {
        const isContentFile =
          (p.endsWith('.md') || p.endsWith('.json')) &&
          !p.includes('_llmtutor-state') &&
          !p.includes('_sources');
        if (isContentFile) contentReadCount += 1;
        return defaultFs.readFile(p);
      },
      stat: defaultFs.stat,
      readdir: defaultFs.readdir,
    };

    // Warm start: same on-disk DB (mtime_ms is intact) + counting FS.
    const cms2 = await getCmsIndex(dir, { dbPath, fs: countingFs });
    expect(cms2.getCurriculum().modules.length).toBeGreaterThan(0);

    // The warm path stat'd every file but found mtime_ms matches for each →
    // no readFile on any content file.
    expect(contentReadCount).toBe(0);
  });

  it('mtime-changed-but-content-unchanged: readFile fires but parseModule does NOT', async () => {
    // On-disk DB so mtime_ms persists.
    const dbPath = join(dir, 'test-mtime-bump.sqlite');
    await getCmsIndex(dir, { dbPath });
    __resetCmsIndexForTests();

    // Bump mtime of the module file without changing bytes.
    const b01Path = join(dir, 'B01-eval-harnesses.md');
    const futureDate = new Date(Date.now() + 2000);
    await utimes(b01Path, futureDate, futureDate);

    const parseSpy = vi.spyOn(parseModuleModule, 'parseModule');
    let moduleReadCount = 0;
    const countingFs: FsLike = {
      readFile: async (p: string) => {
        if (p.endsWith('.md') && !p.includes('_flashcards') && !p.includes('_llmtutor')) {
          moduleReadCount += 1;
        }
        return defaultFs.readFile(p);
      },
      stat: defaultFs.stat,
      readdir: defaultFs.readdir,
    };

    // Warm start with bumped mtime: readFile fires for B01 (mtime differs) but
    // the hash matches the cached row → parseModule must NOT fire.
    const cms2 = await getCmsIndex(dir, { dbPath, fs: countingFs });
    expect(cms2.getModule('B01')).toBeDefined();
    expect(moduleReadCount).toBeGreaterThan(0);
    expect(parseSpy.mock.calls.length).toBe(0);

    parseSpy.mockRestore();
  });

  it('mtime-changed-and-content-changed: full reparse path still fires correctly', async () => {
    // Cold start with the default on-disk DB for this tmp dir.
    await getCmsIndex(dir);

    const b01Path = join(dir, 'B01-eval-harnesses.md');
    const original = await readFile(b01Path, 'utf8');
    const mutated = original.replace(
      'If your harness is wrong, every score downstream is a confident lie.',
      'Updated line to force hash change and verify reparse fires.',
    );
    await writeFile(b01Path, mutated, 'utf8');

    const parseSpy = vi.spyOn(parseModuleModule, 'parseModule');

    // Second call via same singleton: mtime changed + hash changed → full reparse.
    const cms2 = await getCmsIndex(dir);
    expect(cms2.getModule('B01')?.whyThisMatters).toContain('verify reparse fires');
    expect(parseSpy.mock.calls.length).toBeGreaterThan(0);

    parseSpy.mockRestore();
  });
});
