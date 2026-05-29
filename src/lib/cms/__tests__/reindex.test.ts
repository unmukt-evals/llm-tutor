// Phase 3 — reindexAffected facade round-trip.
// The watcher + apply route + future studio routes all go through this entry
// point; tests pin the contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, cp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { __resetCmsIndexForTests, getCmsIndex } from '@/lib/cms/index';
import { reindexAffected } from '@/lib/cms/reindex';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe('reindexAffected facade', () => {
  let dir: string;
  beforeEach(async () => {
    __resetCmsIndexForTests();
    dir = await mkdtemp(join(tmpdir(), 'cms-reindex-'));
    await cp(FIXTURE_DIR, dir, { recursive: true });
  });
  afterEach(async () => {
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('reindexes a module after disk edit', async () => {
    const cms = await getCmsIndex(dir);
    expect(cms.getModule('B01')?.whyThisMatters).toContain('confident lie');

    const p = join(dir, 'B01-eval-harnesses.md');
    const original = await readFile(p, 'utf8');
    await writeFile(
      p,
      original.replace('confident lie', 'REINDEX-FACADE-TEST'),
      'utf8',
    );

    // Result may show indexed=0 because getCmsIndex's lazyRefresh already
    // picked up the change before reindexAffected delegated — what we care
    // about is the resulting cms state.
    const res = (await reindexAffected(dir, 'module', 'B01')) as {
      indexed: number;
      skipped: number;
      error?: string;
    };
    expect(res.error).toBeUndefined();
    expect(cms.getModule('B01')?.whyThisMatters).toContain('REINDEX-FACADE-TEST');
  });

  it('reindexes a pool', async () => {
    const cms = await getCmsIndex(dir);
    const p = join(dir, 'mcq', 'B01.json');
    const json = JSON.parse(await readFile(p, 'utf8'));
    json.questions[0].explanation = 'POOL-FACADE-TEST';
    await writeFile(p, JSON.stringify(json, null, 2), 'utf8');

    const res = (await reindexAffected(dir, 'pool', 'B01')) as {
      indexed: number;
      skipped: number;
      error?: string;
    };
    expect(res.error).toBeUndefined();
    expect(cms.getPool('B01')?.questions[0].explanation).toBe('POOL-FACADE-TEST');
  });

  it('reindexes state', async () => {
    const cms = await getCmsIndex(dir);
    const p = join(dir, '_llmtutor-state.json');
    const json = JSON.parse(await readFile(p, 'utf8'));
    json.xp = { total: 12345, thisWeek: 0 };
    await writeFile(p, JSON.stringify(json, null, 2), 'utf8');

    const res = (await reindexAffected(dir, 'state')) as { ok: true };
    expect(res.ok).toBe(true);
    expect(cms.getAppState().xp.total).toBe(12345);
  });

  it('reindexAll runs', async () => {
    await getCmsIndex(dir);
    const res = (await reindexAffected(dir, 'all')) as {
      indexed: number;
      skipped: number;
      errors: unknown[];
    };
    expect(res.errors).toEqual([]);
    expect(res.indexed + res.skipped).toBeGreaterThan(0);
  });

  it('detects deleted module → drops rows', async () => {
    const cms = await getCmsIndex(dir);
    expect(cms.getModule('B01')).toBeDefined();

    await unlink(join(dir, 'B01-eval-harnesses.md'));
    const res = (await reindexAffected(dir, 'module', 'B01')) as {
      indexed: number;
      skipped: number;
      error?: string;
    };
    expect(res.error).toBeUndefined();
    expect(cms.getModule('B01')).toBeUndefined();
  });

  it('detects deleted pool → drops rows', async () => {
    const cms = await getCmsIndex(dir);
    expect(cms.getPool('B01')).not.toBeNull();

    await unlink(join(dir, 'mcq', 'B01.json'));
    const res = (await reindexAffected(dir, 'pool', 'B01')) as {
      indexed: number;
      skipped: number;
      error?: string;
    };
    expect(res.error).toBeUndefined();
    expect(cms.getPool('B01')).toBeNull();
  });

  it('throws when id is missing for kind that needs it', async () => {
    await expect(reindexAffected(dir, 'module' as const)).rejects.toThrow(
      /requires an id/,
    );
  });
});
