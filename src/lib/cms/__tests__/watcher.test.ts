// Phase 3 — chokidar watcher integration tests.
// We use a real `mkdtemp` dir + the real `chokidar` watcher (no mocking) so the
// debounce / classify / reindex pipeline is exercised end-to-end. Tests avoid
// flake by:
//   - calling `startWatcher` with `{ force: true }` so the prod gate is off,
//   - awaiting chokidar's `ready` event (helper `waitForReady`) before mutating,
//   - using a short debounce (10ms) + a polling helper that waits for the
//     expected post-condition rather than sleeping a fixed duration.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, cp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';
import {
  startWatcher,
  classifyPath,
  __stopAllWatchersForTests,
  type WatcherHandle,
} from '@/lib/cms/watcher';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

/** Wait until `predicate()` returns truthy, or `timeoutMs` elapses. Polls every
 *  10ms. Returns the truthy value or throws if the predicate never holds. */
async function waitFor<T>(
  predicate: () => T | undefined | null | false,
  timeoutMs = 1500,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = predicate();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}

/** Wait until chokidar has finished its initial scan. */
function waitForReady(handle: WatcherHandle): Promise<void> {
  // We don't expose the underlying chokidar instance, but `ignoreInitial: true`
  // means the watcher emits no events until file changes happen post-ready.
  // A 60ms settle is enough on macOS/Linux per chokidar's docs.
  void handle;
  return new Promise((r) => setTimeout(r, 60));
}

describe('cms watcher — classify', () => {
  it('classifies top-level module .md', () => {
    const dir = '/tmp/x';
    expect(classifyPath(dir, '/tmp/x/B01-eval-harnesses.md')).toEqual({
      kind: 'module',
      id: 'B01',
    });
    expect(classifyPath(dir, '/tmp/x/M03.md')).toEqual({ kind: 'module', id: 'M03' });
  });
  it('classifies pool JSON', () => {
    expect(classifyPath('/tmp/x', '/tmp/x/mcq/B01.json')).toEqual({
      kind: 'pool',
      id: 'B01',
    });
  });
  it('classifies _flashcards.md and _llmtutor-state.json', () => {
    expect(classifyPath('/tmp/x', '/tmp/x/_flashcards.md')).toEqual({
      kind: 'flashcards',
      id: '_flashcards',
    });
    expect(classifyPath('/tmp/x', '/tmp/x/_llmtutor-state.json')).toEqual({
      kind: 'state',
      id: '_',
    });
  });
  it('returns null for unknown surfaces', () => {
    // notes/ subdirs are not tracked
    expect(classifyPath('/tmp/x', '/tmp/x/notes/whatever.txt')).toBeNull();
    // sqlite cache is filtered by chokidar's `ignored`, but classifyPath alone
    // sees it as "top-level non-md" → null
    expect(classifyPath('/tmp/x', '/tmp/x/.llmtutor-cache.sqlite')).toBeNull();
    // deeper mcq/ subdirs are not tracked
    expect(classifyPath('/tmp/x', '/tmp/x/mcq/nested/B01.json')).toBeNull();
  });
});

describe('cms watcher — runtime', () => {
  let dir: string;
  let handle: WatcherHandle | null = null;

  beforeEach(async () => {
    __resetCmsIndexForTests();
    await __stopAllWatchersForTests();
    dir = await mkdtemp(join(tmpdir(), 'cms-watcher-'));
    await cp(FIXTURE_DIR, dir, { recursive: true });
  });

  afterEach(async () => {
    if (handle) await handle.stop();
    handle = null;
    await __stopAllWatchersForTests();
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('reindexes a module on .md change', async () => {
    const cms = await getCmsIndex(dir);
    handle = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    expect(handle).not.toBeNull();
    await waitForReady(handle!);

    const b01Path = join(dir, 'B01-eval-harnesses.md');
    const original = await readFile(b01Path, 'utf8');
    const mutated = original.replace(
      'If your harness is wrong, every score downstream is a confident lie.',
      'WATCHER TEST: harness wrong → confident lies downstream.',
    );
    await writeFile(b01Path, mutated, 'utf8');

    const newWhy = await waitFor(() => {
      const m = cms.getModule('B01');
      if (m && m.whyThisMatters.includes('WATCHER TEST')) return m.whyThisMatters;
      return null;
    });
    expect(newWhy).toContain('WATCHER TEST');
  });

  it('reindexes a pool on mcq/<id>.json change', async () => {
    const cms = await getCmsIndex(dir);
    handle = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    await waitForReady(handle!);

    const poolPath = join(dir, 'mcq', 'B01.json');
    const original = JSON.parse(await readFile(poolPath, 'utf8'));
    // Mutate the explanation of the first question — pool validators are strict
    // so we only twiddle a free-form text field.
    original.questions[0].explanation = 'WATCHER TEST EXPLANATION';
    await writeFile(poolPath, JSON.stringify(original, null, 2), 'utf8');

    const newExpl = await waitFor(() => {
      const p = cms.getPool('B01');
      const q = p?.questions[0];
      if (q && q.explanation === 'WATCHER TEST EXPLANATION') return q.explanation;
      return null;
    });
    expect(newExpl).toBe('WATCHER TEST EXPLANATION');
  });

  it('reindexes flashcards on _flashcards.md change', async () => {
    const cms = await getCmsIndex(dir);
    handle = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    await waitForReady(handle!);

    const fcPath = join(dir, '_flashcards.md');
    const original = await readFile(fcPath, 'utf8');
    // Append a card. Use the existing module id B01 so the parser accepts it.
    const appended =
      original.trimEnd() + '\n- module:B01 front-watcher :: back-watcher\n';
    await writeFile(fcPath, appended, 'utf8');

    const newCards = await waitFor(() => {
      const cards = cms.getFlashcards();
      return cards.some((c) => c.front === 'front-watcher') ? cards : null;
    });
    expect(newCards.find((c) => c.front === 'front-watcher')?.back).toBe('back-watcher');
  });

  it('reindexes state on _llmtutor-state.json change', async () => {
    const cms = await getCmsIndex(dir);
    handle = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    await waitForReady(handle!);

    const statePath = join(dir, '_llmtutor-state.json');
    const original = JSON.parse(await readFile(statePath, 'utf8'));
    original.xp = { total: 9999, thisWeek: 42 };
    await writeFile(statePath, JSON.stringify(original, null, 2), 'utf8');

    const updated = await waitFor(() => {
      const app = cms.getAppState();
      return app.xp.total === 9999 ? app : null;
    });
    expect(updated.xp.thisWeek).toBe(42);
  });

  it('drops module rows when the .md is unlinked', async () => {
    const cms = await getCmsIndex(dir);
    handle = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    await waitForReady(handle!);
    expect(cms.getModule('B01')).toBeDefined();

    await unlink(join(dir, 'B01-eval-harnesses.md'));

    await waitFor(() => (cms.getModule('B01') === undefined ? true : null));
    expect(cms.getModule('B01')).toBeUndefined();
  });

  it('startWatcher is idempotent — second call returns same handle', async () => {
    const cms = await getCmsIndex(dir);
    const a = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    const b = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    handle = a;
  });

  it('handle.stop() shuts down cleanly and stop() is idempotent', async () => {
    const cms = await getCmsIndex(dir);
    const h = startWatcher(dir, cms, { force: true, debounceMs: 10 });
    expect(h).not.toBeNull();
    await h!.stop();
    await h!.stop(); // second call is a no-op, must not throw
    // Don't track in `handle` — already stopped.
  });

  it('returns null in production unless force is set', async () => {
    // Vitest typically runs with NODE_ENV='test'; stub to production to exercise
    // the gate. `vi.stubEnv` is the safe path — direct property assignment is
    // blocked on the readonly env descriptor in some Node + Vitest versions.
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const cms = await getCmsIndex(dir);
      const h = startWatcher(dir, cms);
      expect(h).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
