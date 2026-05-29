import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';
import { indexEntity, selectFlashcards } from '@/lib/cms/indexer';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe("indexEntity('flashcards', '_flashcards')", () => {
  it('round-trips: indexed cards deep-equal parseFlashcards(file bytes)', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'flashcards', '_flashcards');

    const fromCache = selectFlashcards(db);
    const raw = await readFile(resolve(FIXTURE_DIR, '_flashcards.md'), 'utf8');
    const fromDisk = parseFlashcards(raw);

    expect(fromCache).toEqual(fromDisk);
    expect(fromCache.length).toBe(2);
    expect(fromCache[0].lastTested).toBe('2026-05-20');
    expect(fromCache[1].lastTested).toBeNull();
    db.close();
  });

  it('writes a per-card content_hash on each row', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'flashcards', '_flashcards');

    const rows = db
      .prepare('SELECT id, content_hash FROM flashcards ORDER BY ord')
      .all() as { id: string; content_hash: string }[];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Per-card: different cards yield different hashes.
    expect(rows[0].content_hash).not.toBe(rows[1].content_hash);
    db.close();
  });

  it('writes an index_rows row keyed by _flashcards and is idempotent', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'flashcards', '_flashcards');
    const first = (
      db
        .prepare("SELECT indexed_at FROM index_rows WHERE kind='flashcards' AND entity_id='_flashcards'")
        .get() as { indexed_at: number }
    ).indexed_at;

    await indexEntity(db, FIXTURE_DIR, 'flashcards', '_flashcards');
    const second = (
      db
        .prepare("SELECT indexed_at FROM index_rows WHERE kind='flashcards' AND entity_id='_flashcards'")
        .get() as { indexed_at: number }
    ).indexed_at;

    expect(second).toBe(first);
    db.close();
  });
});
