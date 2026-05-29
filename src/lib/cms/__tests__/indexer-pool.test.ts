import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';
import { indexEntity, selectPool } from '@/lib/cms/indexer';
import { validatePool } from '@/lib/mcq/repository';
import type { MCQPool } from '@/lib/types';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe("indexEntity('pool', 'B01')", () => {
  it('round-trips: indexed pool deep-equals validatePool(file bytes) with moduleId normalized', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'pool', 'B01');

    const fromCache = selectPool(db, 'B01');
    expect(fromCache).not.toBeNull();

    const raw = await readFile(resolve(FIXTURE_DIR, 'mcq/B01.json'), 'utf8');
    const validated = validatePool(JSON.parse(raw));
    // Mirror FileMCQRepository.loadPool: trust the pool's moduleId on every q.
    const normalized: MCQPool = {
      moduleId: validated.moduleId,
      questions: validated.questions.map((q) => ({ ...q, moduleId: validated.moduleId })),
    };

    expect(fromCache).toEqual(normalized);
    db.close();
  });

  it('writes an index_rows row for the pool with sha256 content_hash', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'pool', 'B01');

    const row = db
      .prepare("SELECT content_hash FROM index_rows WHERE kind='pool' AND entity_id='B01'")
      .get() as { content_hash: string } | undefined;
    expect(row?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it('returns null for an unknown pool id', () => {
    const db = getDb(':memory:');
    runMigrations(db);
    expect(selectPool(db, 'NOPE')).toBeNull();
    db.close();
  });

  it('skips a second index call when the content hash is unchanged', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'pool', 'B01');
    const before = (
      db
        .prepare("SELECT indexed_at FROM index_rows WHERE kind='pool' AND entity_id='B01'")
        .get() as { indexed_at: number }
    ).indexed_at;

    await indexEntity(db, FIXTURE_DIR, 'pool', 'B01');
    const after = (
      db
        .prepare("SELECT indexed_at FROM index_rows WHERE kind='pool' AND entity_id='B01'")
        .get() as { indexed_at: number }
    ).indexed_at;

    expect(after).toBe(before);
    db.close();
  });
});
