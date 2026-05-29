import { describe, it, expect } from 'vitest';
import { getDb, runMigrations } from '@/lib/cms/db';

describe('cms/migrations — 002_sources_meta', () => {
  it('module_sources has a stale_at column after runMigrations', () => {
    const db = getDb(':memory:');
    runMigrations(db);

    const cols = db
      .prepare('PRAGMA table_info(module_sources)')
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);

    expect(names).toContain('stale_at');
    db.close();
  });

  it('sources has author, cluster, thesis, mechanism, quotes_json, grounds_json after runMigrations', () => {
    const db = getDb(':memory:');
    runMigrations(db);

    const cols = db
      .prepare('PRAGMA table_info(sources)')
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);

    for (const col of ['author', 'cluster', 'thesis', 'mechanism', 'quotes_json', 'grounds_json']) {
      expect(names).toContain(col);
    }
    db.close();
  });

  it('runMigrations is idempotent — second call does not error and does not re-apply 002', () => {
    const db = getDb(':memory:');
    runMigrations(db);

    const before = (
      db.prepare('SELECT COUNT(*) AS n FROM _schema_migrations').get() as { n: number }
    ).n;

    // Must not throw.
    runMigrations(db);

    const after = (
      db.prepare('SELECT COUNT(*) AS n FROM _schema_migrations').get() as { n: number }
    ).n;

    expect(after).toBe(before);
    db.close();
  });

  it('quotes_json and grounds_json default to empty array literal', () => {
    const db = getDb(':memory:');
    runMigrations(db);

    // Insert a minimal sources row — omit quotes_json and grounds_json to
    // confirm the column defaults fire.
    db.prepare(
      `INSERT INTO sources (id, kind, title, content_hash, updated_at)
       VALUES ('test_src', 'doc', 'Test', 'abc', 0)`,
    ).run();

    const row = db
      .prepare("SELECT quotes_json, grounds_json FROM sources WHERE id = 'test_src'")
      .get() as { quotes_json: string; grounds_json: string };

    expect(row.quotes_json).toBe('[]');
    expect(row.grounds_json).toBe('[]');
    db.close();
  });

  it('stale_at index is created on module_sources', () => {
    const db = getDb(':memory:');
    runMigrations(db);

    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_module_sources_stale'",
      )
      .get();

    expect(idx).toBeDefined();
    db.close();
  });
});
