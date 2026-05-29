import 'server-only';
import Database, { type Database as BSDatabase } from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Opens (or creates) a better-sqlite3 connection at `dbPath` with sane pragmas:
 *   - journal_mode = WAL    (skipped for ':memory:' — WAL is illegal there)
 *   - synchronous  = NORMAL
 *   - foreign_keys = ON
 *   - busy_timeout = 5000ms
 *
 * Caller passes the path; tests pass ':memory:' so they are hermetic. Does NOT
 * run migrations — call `runMigrations(db)` next. Server-only: importing this
 * module from a client component fails the Next build.
 */
export function getDb(dbPath: string): BSDatabase {
  if (dbPath !== ':memory:') {
    const parent = dirname(dbPath);
    if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
  }
  const db = new Database(dbPath);
  // WAL is unsupported on in-memory DBs; keep them as the default "memory"
  // journal mode to avoid a confusing silent fallback.
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Directory holding numbered `.sql` migration files, resolved from this module. */
function defaultMigrationsDir(): string {
  // `import.meta.url` resolves to `.../src/lib/cms/db.ts` in dev/test and to
  // the compiled file under `.next` at runtime; in both cases the migrations
  // directory sits beside it.
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

/**
 * Applies every migration file under `dir` in lexicographic order, tracking
 * applied names in `_schema_migrations`. Idempotent: a second call is a no-op.
 * Each migration runs inside a single transaction so a syntax error rolls back
 * cleanly and the bookkeeping row is not recorded.
 *
 * Bootstrap quirk: a fresh DB does not yet have `_schema_migrations`. The
 * runner creates it first (CREATE TABLE IF NOT EXISTS); 001_initial.sql may
 * itself re-declare it with the same `IF NOT EXISTS` guard — both idempotent.
 */
export function runMigrations(db: BSDatabase, dir: string = defaultMigrationsDir()): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     );`,
  );

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (
      db.prepare('SELECT name FROM _schema_migrations').all() as {
        name: string;
      }[]
    ).map((r) => r.name),
  );

  const insert = db.prepare(
    'INSERT INTO _schema_migrations(name, applied_at) VALUES (?, ?)',
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(file, Date.now());
    });
    tx();
  }
}
