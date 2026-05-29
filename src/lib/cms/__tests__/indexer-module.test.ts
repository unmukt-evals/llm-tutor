import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';
import { indexEntity, selectModule } from '@/lib/cms/indexer';
import { parseModule } from '@/lib/ingest/parse-module';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/curriculum');

describe("indexEntity('module', 'B01')", () => {
  it('round-trips: indexed Module deep-equals parseModule(file bytes)', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'module', 'B01');

    const fromCache = selectModule(db, 'B01');
    expect(fromCache).not.toBeNull();

    const raw = await readFile(resolve(FIXTURE_DIR, 'B01-eval-harnesses.md'), 'utf8');
    const fromDisk = parseModule(raw);

    expect(fromCache).toEqual(fromDisk);
    db.close();
  });

  it('writes an index_rows entry with a 64-char sha256 content_hash', async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'module', 'B01');

    const row = db
      .prepare(
        "SELECT kind, entity_id, content_hash, mtime_ms FROM index_rows WHERE kind='module' AND entity_id='B01'",
      )
      .get() as { kind: string; entity_id: string; content_hash: string; mtime_ms: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.mtime_ms).toBeGreaterThan(0);
    db.close();
  });

  it("skips a second index call when the content hash hasn't changed (no-op)", async () => {
    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, FIXTURE_DIR, 'module', 'B01');
    const firstIndexedAt = (
      db
        .prepare("SELECT indexed_at FROM index_rows WHERE kind='module' AND entity_id='B01'")
        .get() as { indexed_at: number }
    ).indexed_at;
    const firstModuleUpdatedAt = (
      db.prepare("SELECT updated_at FROM modules WHERE id='B01'").get() as { updated_at: number }
    ).updated_at;

    await indexEntity(db, FIXTURE_DIR, 'module', 'B01');
    const secondIndexedAt = (
      db
        .prepare("SELECT indexed_at FROM index_rows WHERE kind='module' AND entity_id='B01'")
        .get() as { indexed_at: number }
    ).indexed_at;
    const secondModuleUpdatedAt = (
      db.prepare("SELECT updated_at FROM modules WHERE id='B01'").get() as { updated_at: number }
    ).updated_at;

    expect(secondIndexedAt).toBe(firstIndexedAt);
    expect(secondModuleUpdatedAt).toBe(firstModuleUpdatedAt);
    db.close();
  });

  it('reparses + replaces child rows when content changes (drills survive a shrink)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-mod-'));
    try {
      await cp(FIXTURE_DIR, tmp, { recursive: true });
      const db = getDb(':memory:');
      runMigrations(db);

      await indexEntity(db, tmp, 'module', 'B01');
      const firstDrillCount = (
        db.prepare("SELECT COUNT(*) AS n FROM module_drills WHERE module_id='B01'").get() as {
          n: number;
        }
      ).n;
      expect(firstDrillCount).toBe(2);

      // Drop one drill section by rewriting the file.
      const modulePath = join(tmp, 'B01-eval-harnesses.md');
      const original = await readFile(modulePath, 'utf8');
      const mutated = original.replace(
        /### Drill 2[\s\S]*?(?=## Stress-test pool)/,
        '',
      );
      await writeFile(modulePath, mutated, 'utf8');

      await indexEntity(db, tmp, 'module', 'B01');
      const secondDrillCount = (
        db.prepare("SELECT COUNT(*) AS n FROM module_drills WHERE module_id='B01'").get() as {
          n: number;
        }
      ).n;
      expect(secondDrillCount).toBe(1);

      // Round-trip still equals parser.
      const fromCache = selectModule(db, 'B01');
      const fromDisk = parseModule(await readFile(modulePath, 'utf8'));
      expect(fromCache).toEqual(fromDisk);

      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
