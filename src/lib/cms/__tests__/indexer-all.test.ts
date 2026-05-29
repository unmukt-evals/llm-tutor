import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, cp, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';
import { indexAll, selectModule, selectPool, selectFlashcards } from '@/lib/cms/indexer';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

async function cloneFixture(target: string): Promise<void> {
  await cp(FIXTURE_DIR, target, { recursive: true });
}

describe('indexAll', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cms-all-'));
    await cloneFixture(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('populates module + pool + flashcards + state rows in one pass', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    const report = await indexAll(db, dir);

    expect(report.indexed).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);

    const moduleCount = (db.prepare('SELECT COUNT(*) AS n FROM modules').get() as { n: number }).n;
    const poolCount = (db.prepare('SELECT COUNT(*) AS n FROM mcq_pools').get() as { n: number }).n;
    const cardCount = (db.prepare('SELECT COUNT(*) AS n FROM flashcards').get() as { n: number }).n;
    const modStateCount = (db.prepare('SELECT COUNT(*) AS n FROM module_state').get() as { n: number }).n;
    const appCount = (db.prepare('SELECT COUNT(*) AS n FROM app_state').get() as { n: number }).n;

    expect(moduleCount).toBe(1);
    expect(poolCount).toBe(1);
    expect(cardCount).toBeGreaterThan(0);
    expect(modStateCount).toBe(1);
    expect(appCount).toBe(1);

    expect(selectModule(db, 'B01')?.track).toBe('B');
    expect(selectPool(db, 'B01')?.questions.length).toBe(2);
    expect(selectFlashcards(db).length).toBe(2);
    db.close();
  });

  it('survives a single broken module file (logs + records the error, keeps the rest)', async () => {
    // Drop a malformed second module: a frontmatter block with deliberately
    // broken YAML so gray-matter throws when parseModule peeks at the id.
    await writeFile(
      join(dir, 'B02-broken.md'),
      '---\nmodule_id: [bad\n---\n\n# nope\n',
      'utf8',
    );

    const db = getDb(':memory:');
    runMigrations(db);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const report = await indexAll(db, dir);
    warn.mockRestore();

    // The good module still indexed; the bad one was skipped.
    const ids = (db.prepare('SELECT id FROM modules ORDER BY id').all() as { id: string }[]).map(
      (r) => r.id,
    );
    expect(ids).toEqual(['B01']);

    // Report carries a per-file error for the bad module.
    const moduleErrors = report.errors.filter((e) => e.kind === 'module');
    expect(moduleErrors.length).toBeGreaterThan(0);
    expect(moduleErrors.some((e) => typeof e.error === 'string' && e.error.length > 0)).toBe(true);

    // Pool + flashcards + state still made it through.
    expect(selectPool(db, 'B01')).not.toBeNull();
    expect(selectFlashcards(db).length).toBeGreaterThan(0);
    db.close();
  });

  it('is a no-op on a second call when nothing changed (idempotent via content_hash)', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexAll(db, dir);
    const beforeMod = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='module' AND entity_id='B01'").get() as {
        indexed_at: number;
      }
    ).indexed_at;
    const beforePool = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='pool' AND entity_id='B01'").get() as {
        indexed_at: number;
      }
    ).indexed_at;
    const beforeState = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='state' AND entity_id='_'").get() as {
        indexed_at: number;
      }
    ).indexed_at;

    const report = await indexAll(db, dir);

    const afterMod = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='module' AND entity_id='B01'").get() as {
        indexed_at: number;
      }
    ).indexed_at;
    const afterPool = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='pool' AND entity_id='B01'").get() as {
        indexed_at: number;
      }
    ).indexed_at;
    const afterState = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='state' AND entity_id='_'").get() as {
        indexed_at: number;
      }
    ).indexed_at;

    expect(afterMod).toBe(beforeMod);
    expect(afterPool).toBe(beforePool);
    expect(afterState).toBe(beforeState);
    expect(report.skipped).toBeGreaterThan(0);
    db.close();
  });

  it('works when there is no mcq/ directory and no _flashcards.md (state-only dir)', async () => {
    // Strip the fixture down to just the state sidecar.
    await rm(join(dir, 'mcq'), { recursive: true, force: true });
    await unlink(join(dir, '_flashcards.md'));

    const db = getDb(':memory:');
    runMigrations(db);

    const report = await indexAll(db, dir);

    // Module + state indexed; no pool / flashcards rows.
    expect((db.prepare('SELECT COUNT(*) AS n FROM modules').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM mcq_pools').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM flashcards').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM app_state').get() as { n: number }).n).toBe(1);
    expect(report.errors).toEqual([]);
    db.close();
  });
});
