import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';

describe('cms/db', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cms-db-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('opens an on-disk DB and sets WAL + foreign_keys ON + synchronous NORMAL', () => {
    const db = getDb(join(dir, 'cache.sqlite'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL == 1
    db.close();
  });

  it('opens an in-memory DB when path is ":memory:" — WAL is skipped, foreign_keys still ON', () => {
    const db = getDb(':memory:');
    // In-memory DBs do NOT support WAL; better-sqlite3 reports "memory" mode.
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).not.toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const row = db.prepare('SELECT 1 AS one').get();
    expect(row).toEqual({ one: 1 });
    db.close();
  });

  it('runMigrations applies all migrations exactly once on a fresh DB', () => {
    const db = getDb(':memory:');
    runMigrations(db);
    const applied = db
      .prepare('SELECT name FROM _schema_migrations ORDER BY name')
      .all() as { name: string }[];
    expect(applied.map((r) => r.name)).toEqual(['001_initial.sql', '002_sources_meta.sql']);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of [
      'modules', 'module_passes', 'module_visuals', 'module_diagrams',
      'module_drills', 'module_stress_tests', 'module_flashcard_seeds',
      'mcq_pools', 'mcq_questions',
      'flashcards', 'flashcard_state',
      'sources', 'module_sources',
      'module_state', 'app_state',
      'index_rows', 'revisions',
      '_schema_migrations',
    ]) {
      expect(names).toContain(t);
    }

    // Spot-check an index made it through.
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_modules_track'")
      .get();
    expect(idx).toBeDefined();

    db.close();
  });

  it('is idempotent — a second runMigrations call is a no-op', () => {
    const db = getDb(':memory:');
    runMigrations(db);
    const before = (db.prepare('SELECT COUNT(*) AS n FROM _schema_migrations').get() as { n: number }).n;
    runMigrations(db);
    const after = (db.prepare('SELECT COUNT(*) AS n FROM _schema_migrations').get() as { n: number }).n;
    expect(after).toBe(before);
    // 001_initial.sql + 002_sources_meta.sql
    expect(after).toBe(2);
    db.close();
  });

  it("bootstrap quirk: works when _schema_migrations doesn't exist AND when 001 also CREATE-IF-NOT-EXISTS's it", () => {
    // The runner must (a) create the bookkeeping table if missing, and (b)
    // tolerate the migration file itself also declaring `CREATE TABLE IF NOT
    // EXISTS _schema_migrations` (which 001_initial.sql does).
    const db = getDb(':memory:');
    // Confirm precondition: the table really is missing.
    const pre = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'",
    ).get();
    expect(pre).toBeUndefined();
    runMigrations(db);
    const post = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_migrations'",
    ).get() as { name: string } | undefined;
    expect(post?.name).toBe('_schema_migrations');
    db.close();
  });

  it('applies a hand-rolled 002 fixture migration alongside 001', async () => {
    const migDir = join(dir, 'migrations');
    await mkdir(migDir, { recursive: true });
    // Copy the real 001 + add a tiny 002.
    const real001 = await import('node:fs').then((m) =>
      m.readFileSync(
        join(__dirname, '..', 'migrations', '001_initial.sql'),
        'utf8',
      ),
    );
    await writeFile(join(migDir, '001_initial.sql'), real001);
    await writeFile(
      join(migDir, '002_add_test_table.sql'),
      'CREATE TABLE _phase1_test (id INTEGER PRIMARY KEY, label TEXT NOT NULL);',
    );

    const db = getDb(':memory:');
    runMigrations(db, migDir);

    const applied = db
      .prepare('SELECT name FROM _schema_migrations ORDER BY name')
      .all() as { name: string }[];
    expect(applied.map((r) => r.name)).toEqual([
      '001_initial.sql',
      '002_add_test_table.sql',
    ]);
    // The 002 table actually exists.
    const present = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_phase1_test'")
      .get();
    expect(present).toBeDefined();
    db.close();
  });

  it('rolls back a broken migration — _schema_migrations stays unchanged', async () => {
    const migDir = join(dir, 'migrations');
    await mkdir(migDir, { recursive: true });
    const real001 = await import('node:fs').then((m) =>
      m.readFileSync(
        join(__dirname, '..', 'migrations', '001_initial.sql'),
        'utf8',
      ),
    );
    await writeFile(join(migDir, '001_initial.sql'), real001);
    // 002 contains an intentional syntax error after a valid CREATE — the
    // transaction must roll BOTH back together so the table never appears
    // and the migration is NOT recorded in _schema_migrations.
    await writeFile(
      join(migDir, '002_broken.sql'),
      "CREATE TABLE _wont_persist (id INTEGER PRIMARY KEY);\nTHIS IS NOT SQL;",
    );

    const db = getDb(':memory:');
    expect(() => runMigrations(db, migDir)).toThrow();

    // 001 was already applied successfully before 002 broke; it stays.
    const applied = db
      .prepare('SELECT name FROM _schema_migrations ORDER BY name')
      .all() as { name: string }[];
    expect(applied.map((r) => r.name)).toEqual(['001_initial.sql']);
    // 002's CREATE was rolled back.
    const wontExist = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_wont_persist'")
      .get();
    expect(wontExist).toBeUndefined();
    db.close();
  });
});
