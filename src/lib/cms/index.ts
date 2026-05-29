import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as BSDatabase } from 'better-sqlite3';

import { getDb, runMigrations } from '@/lib/cms/db';
import {
  defaultFs,
  indexAll,
  indexEntity,
  indexState,
  selectAppState,
  selectFlashcards,
  selectModule,
  selectModuleState,
  selectPool,
  type FsLike,
  type IndexAllReport,
} from '@/lib/cms/indexer';
import { computeContentHash } from '@/lib/cms/hash';
import type {
  Curriculum,
  EntityKind,
  Flashcard,
  MCQPool,
  Module,
  ModuleState,
  SourceRowsAsRendered,
  TutorState,
} from '@/lib/cms/types';
import type { TrackId } from '@/lib/types';

const CACHE_FILE = '.llmtutor-cache.sqlite';

/** Construction options. `dbPath` overrides the default `<dir>/<CACHE_FILE>` so
 *  tests can use `':memory:'` and a stub fs without leaving artifacts behind. */
export interface CmsIndexOptions {
  dbPath?: string;
  fs?: FsLike;
}

/** Read-and-write API surface that Phase 2 swaps existing call sites onto. */
export interface CmsIndex {
  // Read side — shapes mirror what the existing learner reads today.
  getCurriculum(): Curriculum;
  getModule(id: string): Module | undefined;
  getPool(id: string): MCQPool | null;
  getFlashcardsText(): string | null;
  getFlashcards(): Flashcard[];
  getModuleState(id: string): ModuleState;
  getAppState(): Pick<TutorState, 'version' | 'xp' | 'streak' | 'sessionLog'>;
  getSources(): SourceRowsAsRendered[];

  // Phase-3 write helpers (wrappers around the indexer's per-kind writers).
  reindexEntity(kind: EntityKind, id: string): Promise<ReindexResult>;
  reindexState(): Promise<{ ok: true }>;
  reindexAll(): Promise<IndexAllReport>;
}

export interface ReindexResult {
  indexed: number;
  skipped: number;
  error?: string;
}

interface Singleton {
  dir: string;
  dbPath: string;
  db: BSDatabase;
  fs: FsLike;
}

// One open connection per (dir + dbPath) for the life of the process. Tests
// can call `__resetCmsIndexForTests()` to clear this map and close DBs.
const singletons = new Map<string, Singleton>();

function singletonKey(dir: string, dbPath: string): string {
  return `${dir}::${dbPath}`;
}

/**
 * Open (or return the cached) CmsIndex for `dir`. Every call runs a LAZY
 * REFRESH against the directory:
 *   - every tracked file on disk is stat'd and hashed
 *   - rows whose hash already matches index_rows are left untouched (the
 *     existing per-kind writers short-circuit on hash match, but the
 *     factory's lazy walk also avoids the frontmatter PEEK that indexAll
 *     does — so a clean second call is truly zero-parse)
 *   - files that disappeared since the last index have their rows deleted
 *   - genuinely-new or content-changed files are routed through indexEntity
 *
 * Cold start (empty DB or fresh `:memory:`): falls back to indexAll for
 * the full curriculum sweep — that's unavoidable and matches the spec.
 *
 * Per-method checks would be cleaner in theory but would force every read
 * to walk the disk; a single startup pass is cheaper and matches the
 * existing CurriculumRepositoryImpl's "load once" mental model.
 */
export async function getCmsIndex(
  dir: string,
  opts: CmsIndexOptions = {},
): Promise<CmsIndex> {
  const dbPath = opts.dbPath ?? join(dir, CACHE_FILE);
  const fs = opts.fs ?? defaultFs;
  const key = singletonKey(dir, dbPath);

  let s = singletons.get(key);
  if (!s) {
    const db = getDb(dbPath);
    runMigrations(db);
    s = { dir, dbPath, db, fs };
    singletons.set(key, s);
  }

  await lazyRefresh(s);
  return makeIndex(s);
}

/**
 * Walk the curriculum dir once and reconcile it with `index_rows`:
 *   - cold start (empty modules table) → run full indexAll
 *   - warm start → hash-precheck every file; reparse only the stale ones;
 *     drop rows for files that vanished
 */
async function lazyRefresh(s: Singleton): Promise<void> {
  const cold =
    (s.db.prepare('SELECT COUNT(*) AS n FROM index_rows').get() as { n: number }).n === 0;
  if (cold) {
    await indexAll(s.db, s.dir, s.fs);
    return;
  }

  // Touched (kind, id) pairs — anything from index_rows we DON'T touch during
  // the walk is treated as a deletion and pruned at the end.
  const touched = new Set<string>();
  const mark = (kind: EntityKind, id: string): void => {
    touched.add(`${kind}::${id}`);
  };

  // Pre-read all current hashes so we can do hash-only lookups without parsing.
  const hashIndex = s.db.prepare(
    'SELECT entity_id, content_hash FROM index_rows WHERE kind = ?',
  );

  // 1. Modules. We walk the dir, hash each .md, and if the hash already exists
  //    in index_rows[kind='module'] we skip the parse entirely (the stored
  //    entity_id IS the module's id). Otherwise we delegate to indexEntity
  //    which will reparse + rewrite.
  let topEntries: string[] = [];
  try {
    topEntries = await s.fs.readdir(s.dir);
  } catch {
    topEntries = [];
  }

  const moduleRows = hashIndex.all('module') as { entity_id: string; content_hash: string }[];
  const moduleByHash = new Map(moduleRows.map((r) => [r.content_hash, r.entity_id]));

  for (const f of topEntries.filter((n) => n.endsWith('.md') && !n.startsWith('_')).sort()) {
    try {
      const raw = await s.fs.readFile(join(s.dir, f));
      const hash = computeContentHash(raw);
      const knownId = moduleByHash.get(hash);
      if (knownId) {
        mark('module', knownId);
        continue;
      }
      // Stale or new — parse to learn the id and route through indexEntity.
      // (Importing parseModule here would create a duplicate read path; defer
      // to indexEntity which already does the right thing.)
      const { parseModule } = await import('@/lib/ingest/parse-module');
      const peeked = parseModule(raw);
      if (!peeked.id) continue;
      await indexEntity(s.db, s.dir, 'module', peeked.id, s.fs);
      mark('module', peeked.id);
    } catch (err) {
      console.warn(`[cms.lazyRefresh] skipping module ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Pools. Basename minus `.json` IS the entity id, so we can hash-precheck
  //    directly against index_rows without any parse.
  let mcqEntries: string[] = [];
  try {
    mcqEntries = await s.fs.readdir(join(s.dir, 'mcq'));
  } catch {
    // no mcq/ dir — fine
  }
  for (const f of mcqEntries.filter((n) => n.endsWith('.json')).sort()) {
    const id = f.replace(/\.json$/, '');
    try {
      const raw = await s.fs.readFile(join(s.dir, 'mcq', f));
      const hash = computeContentHash(raw);
      const prev = s.db
        .prepare("SELECT content_hash FROM index_rows WHERE kind='pool' AND entity_id=?")
        .get(id) as { content_hash: string } | undefined;
      if (prev?.content_hash === hash) {
        mark('pool', id);
        continue;
      }
      await indexEntity(s.db, s.dir, 'pool', id, s.fs);
      mark('pool', id);
    } catch (err) {
      console.warn(`[cms.lazyRefresh] skipping pool ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Flashcards (single sentinel id `_flashcards`).
  if (topEntries.includes('_flashcards.md')) {
    try {
      const raw = await s.fs.readFile(join(s.dir, '_flashcards.md'));
      const hash = computeContentHash(raw);
      const prev = s.db
        .prepare("SELECT content_hash FROM index_rows WHERE kind='flashcards' AND entity_id='_flashcards'")
        .get() as { content_hash: string } | undefined;
      if (prev?.content_hash !== hash) {
        await indexEntity(s.db, s.dir, 'flashcards', '_flashcards', s.fs);
      }
      mark('flashcards', '_flashcards');
    } catch (err) {
      console.warn(`[cms.lazyRefresh] skipping _flashcards.md: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. State — JsonStateStore.read() returns defaults on missing sidecar, so
  //    we always run indexState (its own hash-skip handles the no-op path).
  try {
    await indexState(s.db, s.dir, s.fs);
    mark('state', '_');
  } catch (err) {
    console.warn(`[cms.lazyRefresh] skipping state: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Delete rows for entities whose source file disappeared. We rely on
  //    FK ON DELETE CASCADE for the entity tables (module_passes, mcq_questions,
  //    etc.); the parent rows are deleted by direct DELETE on the typed table.
  const allRows = s.db
    .prepare('SELECT kind, entity_id FROM index_rows')
    .all() as { kind: EntityKind; entity_id: string }[];

  const deletes = allRows.filter((r) => !touched.has(`${r.kind}::${r.entity_id}`));
  if (deletes.length > 0) {
    const tx = s.db.transaction(() => {
      for (const d of deletes) {
        switch (d.kind) {
          case 'module':
            s.db.prepare('DELETE FROM modules WHERE id = ?').run(d.entity_id);
            break;
          case 'pool':
            s.db.prepare('DELETE FROM mcq_pools WHERE module_id = ?').run(d.entity_id);
            break;
          case 'flashcards':
            s.db.prepare('DELETE FROM flashcards').run();
            break;
          case 'state':
            s.db.prepare('DELETE FROM app_state WHERE id = 1').run();
            s.db.prepare('DELETE FROM module_state').run();
            s.db.prepare('DELETE FROM flashcard_state').run();
            break;
          case 'source':
            s.db.prepare('DELETE FROM sources WHERE id = ?').run(d.entity_id);
            break;
        }
        s.db
          .prepare('DELETE FROM index_rows WHERE kind = ? AND entity_id = ?')
          .run(d.kind, d.entity_id);
      }
    });
    tx();
  }
}

function makeIndex(s: Singleton): CmsIndex {
  const { db, dir, fs } = s;
  return {
    getCurriculum(): Curriculum {
      // Order by id ASC — matches CurriculumRepositoryImpl's
      // sorted-filename behavior for our `<id>-<slug>.md` convention.
      const rows = db
        .prepare('SELECT id FROM modules ORDER BY id ASC')
        .all() as { id: string }[];
      const modules: Module[] = [];
      for (const r of rows) {
        const m = selectModule(db, r.id);
        if (m) modules.push(m);
      }
      const tracks = Array.from(new Set(modules.map((m) => m.track))).sort() as TrackId[];
      const index = new Map(modules.map((m) => [m.id, m]));
      return {
        tracks,
        modules,
        byId(id: string) {
          return index.get(id);
        },
      };
    },

    getModule(id: string) {
      return selectModule(db, id) ?? undefined;
    },

    getPool(id: string) {
      return selectPool(db, id);
    },

    getFlashcardsText(): string | null {
      // Returns the raw deck text so callers that need parseFlashcards-on-text
      // (e.g. the home page's due-count) keep working unchanged. We re-read
      // from disk because the deck is small and the cache already validated
      // its hash during lazyRefresh; if the file vanished between refresh and
      // read we surface null rather than throw.
      const filePath = join(dir, '_flashcards.md');
      if (!existsSync(filePath)) return null;
      try {
        return readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
    },

    getFlashcards() {
      return selectFlashcards(db);
    },

    getModuleState(id: string) {
      return selectModuleState(db, id);
    },

    getAppState() {
      return selectAppState(db);
    },

    getSources() {
      // Phase 1: the `sources` table is empty (Phase 4 will populate from
      // _sources.json). Returning [] keeps the read API shape stable now.
      return (
        db
          .prepare('SELECT id, title, url, summary FROM sources ORDER BY id')
          .all() as { id: string; title: string; url: string | null; summary: string | null }[]
      ).map((r) => r);
    },

    async reindexEntity(kind, id): Promise<ReindexResult> {
      try {
        const before = (
          db
            .prepare('SELECT indexed_at FROM index_rows WHERE kind = ? AND entity_id = ?')
            .get(kind, id) as { indexed_at: number } | undefined
        )?.indexed_at;
        await indexEntity(db, dir, kind, id, fs);
        const after = (
          db
            .prepare('SELECT indexed_at FROM index_rows WHERE kind = ? AND entity_id = ?')
            .get(kind, id) as { indexed_at: number } | undefined
        )?.indexed_at;
        const skipped = before !== undefined && before === after ? 1 : 0;
        return { indexed: skipped ? 0 : 1, skipped };
      } catch (err) {
        return { indexed: 0, skipped: 0, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async reindexState() {
      await indexState(db, dir, fs);
      return { ok: true };
    },

    async reindexAll() {
      return indexAll(db, dir, fs);
    },
  };
}

/** Test-only: close every cached DB connection and drop the singleton map so
 *  the next `getCmsIndex(dir)` reopens (or, for `:memory:`, starts fresh). Not
 *  exported into the production API surface. */
export function __resetCmsIndexForTests(): void {
  for (const s of singletons.values()) {
    try {
      s.db.close();
    } catch {
      // best effort
    }
  }
  singletons.clear();
}

