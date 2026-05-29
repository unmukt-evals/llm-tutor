import 'server-only';
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
  selectFullState,
  selectModule,
  selectModuleState,
  selectPool,
  type FsLike,
  type IndexAllReport,
} from '@/lib/cms/indexer';
import { ensureSourcesJson } from '@/lib/cms/sources/ensure-json';
import { computeContentHash } from '@/lib/cms/hash';
import type {
  Curriculum,
  EntityKind,
  Flashcard,
  MCQPool,
  Module,
  ModuleState,
  TutorState,
} from '@/lib/cms/types';
import type { Source, SourceKind, TrackId } from '@/lib/types';

const CACHE_FILE = '.llmtutor-cache.sqlite';

// ── Source read helpers ───────────────────────────────────────────────────────

/** Raw SQLite row shape for the `sources` table (all TEXT / INTEGER columns). */
interface SourcesRow {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  author: string | null;
  cluster: string | null;
  summary: string | null;
  thesis: string | null;
  mechanism: string | null;
  quotes_json: string;   // always present — DEFAULT '[]'
  grounds_json: string;  // always present — DEFAULT '[]'
  raw_text: string | null;
  fetched_at: number | null;
  content_hash: string;
  updated_at: number;
}

/**
 * Map a SQLite sources row → the `Source` UI type.
 *
 * `quotes`/`grounds` always parse to arrays (never undefined) because the
 * column DEFAULT is '[]'. This gives callers a clean round-trip: writing an
 * empty-array Source yields [] back on read, not undefined.
 */
function rowToSource(row: SourcesRow): Source {
  return {
    id: row.id,
    kind: row.kind as SourceKind,
    title: row.title,
    url: row.url ?? undefined,
    author: row.author ?? undefined,
    cluster: row.cluster ?? undefined,
    summary: row.summary ?? undefined,
    thesis: row.thesis ?? undefined,
    mechanism: row.mechanism ?? undefined,
    // Always-array: DEFAULT '[]' means JSON.parse is always safe here.
    quotes: JSON.parse(row.quotes_json) as string[],
    grounds: JSON.parse(row.grounds_json) as string[],
    raw_text: row.raw_text || undefined,
    fetched_at: row.fetched_at ?? undefined,
    content_hash: row.content_hash,
    updated_at: row.updated_at,
  };
}

/**
 * Phase 3 helper — does the on-disk file backing this (kind, id) currently exist?
 *
 * Used by `reindexEntity` to distinguish "file was edited" (delegate to
 * `indexEntity` for the normal reparse) from "file was deleted" (drop the
 * cached rows). The watcher's `unlink` handler routes through `reindexEntity`,
 * so this check is what makes file-deletion → row-drop work without forking
 * the API surface.
 *
 * Module ids: the path is `<id>-<slug>.md` OR `<id>.md` (matches
 * resolveModulePath in the indexer). We probe both via `fs.readdir` instead
 * of guessing the slug.
 *
 * State always "exists" — JsonStateStore.read() returns defaults on missing
 * sidecar, so deletion semantics for `state` mean "wipe the mirror to defaults",
 * which the caller can request by passing `kind='state'` AFTER unlinking the
 * sidecar — we return `false` only when the sidecar JSON is genuinely gone.
 */
async function fileExistsForEntity(
  dir: string,
  kind: EntityKind,
  id: string,
  fs: FsLike,
): Promise<boolean> {
  try {
    switch (kind) {
      case 'module': {
        const entries = await fs.readdir(dir);
        return entries.some(
          (f) => f.endsWith('.md') && !f.startsWith('_') && (f.startsWith(`${id}-`) || f === `${id}.md`),
        );
      }
      case 'pool': {
        await fs.stat(join(dir, 'mcq', `${id}.json`));
        return true;
      }
      case 'flashcards': {
        await fs.stat(join(dir, '_flashcards.md'));
        return true;
      }
      case 'state': {
        await fs.stat(join(dir, '_llmtutor-state.json'));
        return true;
      }
      case 'source': {
        await fs.stat(join(dir, '_sources.json'));
        return true;
      }
    }
  } catch {
    return false;
  }
}

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
  getFlashcards(): Flashcard[];
  getModuleState(id: string): ModuleState;
  getAppState(): Pick<TutorState, 'version' | 'xp' | 'streak' | 'sessionLog'>;
  /** Full mirrored TutorState (app singleton + per-module + per-card). The
   *  shape matches what `JsonStateStore.read()` returns — drop-in replacement
   *  for the learner read paths that drive Sidebar / JourneyMap / TopBar /
   *  flashcards review. Sidecar remains the source of truth (writes flow
   *  through `getStateStore(dir).write` + `reindexState()`). */
  getFullState(): TutorState;
  getSources(): Source[];
  getSourceById(id: string): Source | undefined;
  getSourcesForModule(moduleId: string): Source[];
  getModulesForSource(sourceId: string): Array<{ id: string; name: string }>;

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
 *   - **mtime-first short-circuit** (warm steady state): each tracked file is
 *     stat'd; if `index_rows.mtime_ms` matches the file's current `mtimeMs`
 *     the cached hash is trusted — no `readFile`, no `sha256`.
 *   - **hash check** (mtime changed): the file is read and hashed; if the hash
 *     matches the cached row the mtime_ms column is updated and the parse is
 *     skipped (handles filesystem quirks where mtime is bumped but bytes are
 *     identical).
 *   - **reparse** (hash changed or new file): delegates to indexEntity which
 *     parses + rewrites the entity rows and bookkeeping.
 *   - files that disappeared since the last index have their rows deleted.
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

    // Ensure _sources.json exists before the first lazyRefresh so the indexer
    // has a JSON to read on cold boot for dirs that only have a hand-authored
    // _sources.md. We do NOT forward the injected FsLike here — it may be a
    // read-only stub (used in tests for the indexer path) that has no write
    // primitives. ensureSourcesJson always touches real disk; the injected fs
    // is only for the indexer's read side.
    // Wrapped in try/catch so a broken _sources.md never kills the entire CMS —
    // we log + continue. getSources() will return [] in that case; the user can
    // fix the .md and restart.
    try {
      await ensureSourcesJson(dir);
    } catch (err) {
      console.warn(
        `[cms.getCmsIndex] ensureSourcesJson failed for ${dir}: ${err instanceof Error ? err.message : String(err)} — continuing without migrating _sources.md`,
      );
    }
  }

  await lazyRefresh(s);
  return makeIndex(s);
}

/**
 * Walk the curriculum dir once and reconcile it with `index_rows`:
 *   - cold start (empty modules table) → run full indexAll
 *   - warm start → mtime-first short-circuit (stat only, no readFile/hash when
 *     mtime_ms matches); fall through to hash check when mtime changed; fall
 *     through to reparse only when hash changed; drop rows for vanished files.
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

  // Pre-read all current hashes AND mtimes so warm-path checks can short-circuit
  // before any readFile / computeContentHash call.
  const rowIndex = s.db.prepare(
    'SELECT entity_id, content_hash, mtime_ms FROM index_rows WHERE kind = ?',
  );

  // 1. Modules. We walk the dir, stat each .md (mtime-first short-circuit), and
  //    only read + hash the file when mtime differs from index_rows.mtime_ms.
  //    If the hash also matches (mtime bumped but content identical), indexEntity
  //    still short-circuits internally — no parse fires.
  let topEntries: string[] = [];
  try {
    topEntries = await s.fs.readdir(s.dir);
  } catch {
    topEntries = [];
  }

  const moduleRows = rowIndex.all('module') as {
    entity_id: string;
    content_hash: string;
    mtime_ms: number;
  }[];
  // Two indices for the warm-path lookups:
  //   moduleByHash — unchanged-mtime path: hash → known id (no stat needed)
  //   moduleById   — changed-mtime path: id → cached row (for post-stat check)
  const moduleByHash = new Map(moduleRows.map((r) => [r.content_hash, r.entity_id]));
  const moduleById = new Map(moduleRows.map((r) => [r.entity_id, r]));

  for (const f of topEntries.filter((n) => n.endsWith('.md') && !n.startsWith('_')).sort()) {
    try {
      const filePath = join(s.dir, f);

      // ── mtime-first short-circuit (warm steady state) ─────────────────────
      // We don't know the entity_id yet for new files, but for files that are
      // already in index_rows we CAN try an mtime check first: peek the hash
      // from the prior indexAll (cold start stored it) then do a reverse lookup.
      // For files that are already indexed, the mtime-first path fires by
      // checking whether ANY cached module row has the right mtime.  The safer
      // per-file path: stat first, then try to match against moduleByHash by
      // reading bytes only when mtime changed.

      const st = await s.fs.stat(filePath);
      // If any cached module row was indexed at exactly this mtime, its content
      // hash is trusted — skip readFile entirely.
      const mtimeHit = moduleRows.find((r) => r.mtime_ms === st.mtimeMs);
      if (mtimeHit) {
        mark('module', mtimeHit.entity_id);
        continue;
      }

      // mtime differs (or file is new) → must read and hash.
      const raw = await s.fs.readFile(filePath);
      const hash = computeContentHash(raw);
      const knownId = moduleByHash.get(hash);
      if (knownId) {
        // Content hash matches a cached row — update only the mtime_ms so
        // future warm calls take the mtime-first path.
        s.db
          .prepare(
            "UPDATE index_rows SET mtime_ms=? WHERE kind='module' AND entity_id=?",
          )
          .run(st.mtimeMs, knownId);
        mark('module', knownId);
        continue;
      }
      // Stale or new — parse to learn the id and route through indexEntity.
      const { parseModule } = await import('@/lib/ingest/parse-module');
      const peeked = parseModule(raw);
      if (!peeked.id) continue;
      await indexEntity(s.db, s.dir, 'module', peeked.id, s.fs);
      mark('module', peeked.id);
    } catch (err) {
      console.warn(`[cms.lazyRefresh] skipping module ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Pools. Basename minus `.json` IS the entity id — mtime check first, then
  //    hash only when mtime changed, then reindex only when hash changed.
  let mcqEntries: string[] = [];
  try {
    mcqEntries = await s.fs.readdir(join(s.dir, 'mcq'));
  } catch {
    // no mcq/ dir — fine
  }
  const poolRows = rowIndex.all('pool') as {
    entity_id: string;
    content_hash: string;
    mtime_ms: number;
  }[];
  const poolById = new Map(poolRows.map((r) => [r.entity_id, r]));

  for (const f of mcqEntries.filter((n) => n.endsWith('.json')).sort()) {
    const id = f.replace(/\.json$/, '');
    try {
      const filePath = join(s.dir, 'mcq', f);
      const st = await s.fs.stat(filePath);
      const cached = poolById.get(id);

      // ── mtime-first short-circuit ─────────────────────────────────────────
      if (cached && cached.mtime_ms === st.mtimeMs) {
        mark('pool', id);
        continue;
      }

      // mtime changed → read + hash.
      const raw = await s.fs.readFile(filePath);
      const hash = computeContentHash(raw);
      if (cached?.content_hash === hash) {
        // Content unchanged — update mtime_ms only so next call takes the fast path.
        s.db
          .prepare(
            "UPDATE index_rows SET mtime_ms=? WHERE kind='pool' AND entity_id=?",
          )
          .run(st.mtimeMs, id);
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
      const filePath = join(s.dir, '_flashcards.md');
      const st = await s.fs.stat(filePath);
      const cached = s.db
        .prepare(
          "SELECT content_hash, mtime_ms FROM index_rows WHERE kind='flashcards' AND entity_id='_flashcards'",
        )
        .get() as { content_hash: string; mtime_ms: number } | undefined;

      // ── mtime-first short-circuit ─────────────────────────────────────────
      if (cached && cached.mtime_ms === st.mtimeMs) {
        mark('flashcards', '_flashcards');
      } else {
        const raw = await s.fs.readFile(filePath);
        const hash = computeContentHash(raw);
        if (cached?.content_hash === hash) {
          s.db
            .prepare(
              "UPDATE index_rows SET mtime_ms=? WHERE kind='flashcards' AND entity_id='_flashcards'",
            )
            .run(st.mtimeMs);
        } else {
          await indexEntity(s.db, s.dir, 'flashcards', '_flashcards', s.fs);
        }
        mark('flashcards', '_flashcards');
      }
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

    getFlashcards() {
      return selectFlashcards(db);
    },

    getModuleState(id: string) {
      return selectModuleState(db, id);
    },

    getAppState() {
      return selectAppState(db);
    },

    getFullState() {
      return selectFullState(db);
    },

    getSources(): Source[] {
      return (
        db
          .prepare('SELECT * FROM sources ORDER BY id ASC')
          .all() as SourcesRow[]
      ).map(rowToSource);
    },

    getSourceById(id: string): Source | undefined {
      const row = db
        .prepare('SELECT * FROM sources WHERE id = ?')
        .get(id) as SourcesRow | undefined;
      return row ? rowToSource(row) : undefined;
    },

    getSourcesForModule(moduleId: string): Source[] {
      return (
        db
          .prepare(
            'SELECT s.* FROM sources s INNER JOIN module_sources ms ON ms.source_id = s.id WHERE ms.module_id = ? ORDER BY s.id ASC',
          )
          .all(moduleId) as SourcesRow[]
      ).map(rowToSource);
    },

    getModulesForSource(sourceId: string): Array<{ id: string; name: string }> {
      const rows = db
        .prepare(
          `SELECT m.id, m.name
           FROM modules m
           INNER JOIN module_sources ms ON ms.module_id = m.id
           WHERE ms.source_id = ?
           ORDER BY m.id ASC`,
        )
        .all(sourceId) as Array<{ id: string; name: string }>;
      return rows;
    },

    async reindexEntity(kind, id): Promise<ReindexResult> {
      try {
        const before = (
          db
            .prepare('SELECT indexed_at FROM index_rows WHERE kind = ? AND entity_id = ?')
            .get(kind, id) as { indexed_at: number } | undefined
        )?.indexed_at;

        // Phase 3 — file-deleted detection. The watcher routes 'unlink' events
        // through here; indexEntity itself throws ENOENT on a missing file, but
        // for the deletion path we want to DROP the rows, not surface the error.
        // We probe existence via `fs.stat` (the injectable edge) before delegating.
        const exists = await fileExistsForEntity(dir, kind, id, fs);
        if (!exists) {
          // Delete the typed rows + the bookkeeping row. Mirrors the cascade in
          // lazyRefresh's vanished-file branch. Wrapped in one tx for atomicity.
          const tx = db.transaction(() => {
            switch (kind) {
              case 'module':
                db.prepare('DELETE FROM modules WHERE id = ?').run(id);
                break;
              case 'pool':
                db.prepare('DELETE FROM mcq_pools WHERE module_id = ?').run(id);
                break;
              case 'flashcards':
                db.prepare('DELETE FROM flashcards').run();
                break;
              case 'state':
                db.prepare('DELETE FROM app_state WHERE id = 1').run();
                db.prepare('DELETE FROM module_state').run();
                db.prepare('DELETE FROM flashcard_state').run();
                break;
              case 'source':
                db.prepare('DELETE FROM sources WHERE id = ?').run(id);
                break;
            }
            db
              .prepare('DELETE FROM index_rows WHERE kind = ? AND entity_id = ?')
              .run(kind, id);
          });
          tx();
          // If `before` was undefined the row was already absent — treat as skipped.
          return before === undefined
            ? { indexed: 0, skipped: 1 }
            : { indexed: 1, skipped: 0 };
        }

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

