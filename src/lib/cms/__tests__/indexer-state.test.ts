import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';
import { indexState, selectModuleState, selectAppState } from '@/lib/cms/indexer';
import { JsonStateStore } from '@/lib/state/store';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe('indexState', () => {
  it('mirrors modules[id] from the sidecar into module_state rows', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexState(db, FIXTURE_DIR);

    const fromCache = selectModuleState(db, 'B01');
    const fromSidecar = await new JsonStateStore(FIXTURE_DIR).getModule('B01');
    expect(fromCache).toEqual(fromSidecar);
    // Non-default values from the fixture round-trip cleanly.
    expect(fromCache.mastery).toBe('solid');
    expect(fromCache.masteryHistory.length).toBe(2);
    expect(fromCache.stressTest.board).toBe('passed');
    db.close();
  });

  it('mirrors xp / streak / sessionLog / version into the app_state singleton', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexState(db, FIXTURE_DIR);

    const app = selectAppState(db);
    const sidecar = await new JsonStateStore(FIXTURE_DIR).read();

    expect(app.version).toBe(sidecar.version);
    expect(app.xp).toEqual(sidecar.xp);
    expect(app.streak).toEqual(sidecar.streak);
    expect(app.sessionLog).toEqual(sidecar.sessionLog);
    db.close();
  });

  it('mirrors flashcards[card_id] into flashcard_state rows', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexState(db, FIXTURE_DIR);

    const rows = db
      .prepare('SELECT card_id, last_tested, interval_days, ease FROM flashcard_state ORDER BY card_id')
      .all() as { card_id: string; last_tested: string; interval_days: number; ease: string }[];
    expect(rows).toEqual([
      { card_id: 'B01-c01', last_tested: '2026-05-20', interval_days: 14, ease: 'good' },
    ]);
    db.close();
  });

  it('updates index_rows with kind=state, entity_id=_, and a sha256 hash', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexState(db, FIXTURE_DIR);

    const row = db
      .prepare("SELECT content_hash FROM index_rows WHERE kind='state' AND entity_id='_'")
      .get() as { content_hash: string } | undefined;
    expect(row?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it('is idempotent on unchanged input (no-op skip via content_hash)', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexState(db, FIXTURE_DIR);
    const first = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='state' AND entity_id='_'").get() as {
        indexed_at: number;
      }
    ).indexed_at;

    await indexState(db, FIXTURE_DIR);
    const second = (
      db.prepare("SELECT indexed_at FROM index_rows WHERE kind='state' AND entity_id='_'").get() as {
        indexed_at: number;
      }
    ).indexed_at;

    expect(second).toBe(first);
    db.close();
  });

  it('falls back to default state when the sidecar is missing (empty dir)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-state-empty-'));
    try {
      const db = getDb(':memory:');
      runMigrations(db);

      await indexState(db, tmp);

      const app = selectAppState(db);
      expect(app.version).toBe(1);
      expect(app.xp).toEqual({ total: 0, thisWeek: 0 });
      expect(app.streak.count).toBe(0);
      expect(app.sessionLog).toEqual([]);

      // No module_state rows (defaults have an empty `modules` map).
      const modRows = (
        db.prepare('SELECT COUNT(*) AS n FROM module_state').get() as { n: number }
      ).n;
      expect(modRows).toBe(0);
      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
