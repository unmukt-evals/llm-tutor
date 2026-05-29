import 'server-only';
import { promises as fsp, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as BSDatabase } from 'better-sqlite3';

import type { EntityKind, MCQPool, Module } from '@/lib/cms/types';
import { computeContentHash } from '@/lib/cms/hash';
import { parseModule } from '@/lib/ingest/parse-module';
import { validatePool } from '@/lib/mcq/repository';
import { parseFlashcards, type Flashcard } from '@/lib/cards/parse-flashcards';
import { JsonStateStore } from '@/lib/state/store';
import { defaultModuleState } from '@/lib/state/defaults';
import type { ModuleState, TutorState } from '@/lib/types';

/** Injectable FS edge — tests can swap in an in-memory shim. Defaults to
 *  `node:fs/promises` so production callers pass nothing. */
export interface FsLike {
  readFile(path: string): Promise<string>;
  stat(path: string): Promise<{ mtimeMs: number }>;
  readdir(path: string): Promise<string[]>;
}

export const defaultFs: FsLike = {
  readFile: (p) => fsp.readFile(p, 'utf8'),
  stat: async (p) => {
    const s = await fsp.stat(p);
    return { mtimeMs: s.mtimeMs };
  },
  readdir: async (p) => fsp.readdir(p),
};

/** Resolve the on-disk file path for a (kind, id) under CURRICULUM_DIR. */
function pathFor(dir: string, kind: EntityKind, id: string): string {
  switch (kind) {
    case 'module':
      return resolveModulePath(dir, id);
    case 'pool':
      return join(dir, 'mcq', `${id}.json`);
    case 'flashcards':
      return join(dir, '_flashcards.md');
    case 'state':
      return join(dir, '_llmtutor-state.json');
    case 'source':
      return join(dir, '_sources.json');
  }
}

function resolveModulePath(dir: string, id: string): string {
  // Prefer `<id>-<slug>.md` or `<id>.md`; matches CurriculumRepositoryImpl.
  const candidates = readdirSync(dir).filter(
    (f) => f.endsWith('.md') && !f.startsWith('_'),
  );
  const direct = candidates.find((f) => f.startsWith(`${id}-`) || f === `${id}.md`);
  if (direct) return join(dir, direct);
  throw new Error(`indexer: no module file found for id "${id}" in ${dir}`);
}

/**
 * Index one entity end-to-end:
 *   1. read the file via the injectable FS edge
 *   2. compute content_hash; if it matches the prior index_rows.content_hash
 *      for (kind, id), return early (no-op)
 *   3. delegate to the kind-specific writer, which parses with the existing
 *      pure parser and writes entity rows + the index_rows bookkeeping row
 *      inside ONE db.transaction(...)
 *
 * Single dispatcher: the kind argument selects which writer to run. Each
 * writer scopes its own transaction so callers (indexAll, future API routes)
 * don't have to.
 */
export async function indexEntity(
  db: BSDatabase,
  dir: string,
  kind: EntityKind,
  id: string,
  fs: FsLike = defaultFs,
): Promise<void> {
  const filePath = pathFor(dir, kind, id);
  const raw = await fs.readFile(filePath);
  const hash = computeContentHash(raw);
  const { mtimeMs } = await fs.stat(filePath);

  const prev = db
    .prepare('SELECT content_hash FROM index_rows WHERE kind = ? AND entity_id = ?')
    .get(kind, id) as { content_hash: string } | undefined;
  if (prev && prev.content_hash === hash) return;

  switch (kind) {
    case 'module':
      writeModule(db, id, raw, hash, mtimeMs);
      return;
    case 'pool':
      writePool(db, id, raw, hash, mtimeMs);
      return;
    case 'flashcards':
      writeFlashcards(db, id, raw, hash, mtimeMs);
      return;
    default:
      throw new Error(`indexEntity: kind "${kind}" not implemented yet`);
  }
}

// ── Module ──────────────────────────────────────────────────────────────────

function writeModule(
  db: BSDatabase,
  id: string,
  raw: string,
  hash: string,
  mtimeMs: number,
): void {
  const mod = parseModule(raw);
  if (mod.id !== id) {
    throw new Error(
      `indexer: module file has module_id "${mod.id}", expected "${id}"`,
    );
  }
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO modules (id, track, name, prerequisites_json, primary_sources_json,
                            why_this_matters, anchors_json, lab_spec, sources_json,
                            content_hash, updated_at)
       VALUES (@id, @track, @name, @prerequisites_json, @primary_sources_json,
               @why_this_matters, @anchors_json, @lab_spec, @sources_json,
               @content_hash, @updated_at)
       ON CONFLICT(id) DO UPDATE SET
         track=excluded.track,
         name=excluded.name,
         prerequisites_json=excluded.prerequisites_json,
         primary_sources_json=excluded.primary_sources_json,
         why_this_matters=excluded.why_this_matters,
         anchors_json=excluded.anchors_json,
         lab_spec=excluded.lab_spec,
         sources_json=excluded.sources_json,
         content_hash=excluded.content_hash,
         updated_at=excluded.updated_at`,
    ).run({
      id: mod.id,
      track: mod.track,
      name: mod.name,
      prerequisites_json: JSON.stringify(mod.prerequisites),
      primary_sources_json: JSON.stringify(mod.primarySources),
      why_this_matters: mod.whyThisMatters,
      anchors_json: JSON.stringify(mod.anchors),
      lab_spec: mod.labSpec ?? null,
      sources_json: JSON.stringify(mod.sources),
      content_hash: hash,
      updated_at: now,
    });

    // Clear + rewrite all child rows so updates can shrink lists.
    db.prepare('DELETE FROM module_passes WHERE module_id = ?').run(mod.id);
    db.prepare('DELETE FROM module_visuals WHERE module_id = ?').run(mod.id);
    db.prepare('DELETE FROM module_diagrams WHERE module_id = ?').run(mod.id);
    db.prepare('DELETE FROM module_drills WHERE module_id = ?').run(mod.id);
    db.prepare('DELETE FROM module_stress_tests WHERE module_id = ?').run(mod.id);
    db.prepare('DELETE FROM module_flashcard_seeds WHERE module_id = ?').run(mod.id);

    const insPass = db.prepare(
      'INSERT INTO module_passes(module_id, kind, body_md) VALUES (?,?,?)',
    );
    for (const [pass, body] of Object.entries(mod.passes)) {
      if (body !== undefined) insPass.run(mod.id, pass, body);
    }

    const insViz = db.prepare(
      'INSERT INTO module_visuals(module_id, ord, type, title, data_json) VALUES (?,?,?,?,?)',
    );
    mod.visuals.forEach((v, i) =>
      insViz.run(mod.id, i, v.type, v.title ?? null, JSON.stringify(v.data)),
    );

    const insDiag = db.prepare(
      'INSERT INTO module_diagrams(module_id, ord, kind, body) VALUES (?,?,?,?)',
    );
    mod.diagrams.forEach((d, i) => insDiag.run(mod.id, i, d.kind, d.body));

    const insDrill = db.prepare(
      'INSERT INTO module_drills(module_id, ord, scenario, dc1, dc2) VALUES (?,?,?,?,?)',
    );
    mod.drills.forEach((d, i) =>
      insDrill.run(mod.id, i, d.scenario, d.dc1 ?? null, d.dc2 ?? null),
    );

    const insStress = db.prepare(
      'INSERT INTO module_stress_tests(module_id, ord, lens, question) VALUES (?,?,?,?)',
    );
    mod.stressTests.forEach((s, i) => insStress.run(mod.id, i, s.lens, s.question));

    const insSeed = db.prepare(
      'INSERT INTO module_flashcard_seeds(module_id, ord, seed) VALUES (?,?,?)',
    );
    mod.flashcardSeeds.forEach((s, i) => insSeed.run(mod.id, i, s));

    db.prepare(
      `INSERT INTO index_rows(kind, entity_id, content_hash, mtime_ms, indexed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(kind, entity_id) DO UPDATE SET
         content_hash=excluded.content_hash,
         mtime_ms=excluded.mtime_ms,
         indexed_at=excluded.indexed_at`,
    ).run('module', mod.id, hash, mtimeMs, now);
  });
  tx();
}

/**
 * Reconstruct a Module from the cache by joining the parent row with its child
 * tables. Returns null if no module row exists for `id`. The output shape is
 * intentionally identical to `parseModule()` so a round-trip is verifiable.
 */
export function selectModule(db: BSDatabase, id: string): Module | null {
  const row = db
    .prepare(
      `SELECT id, track, name, prerequisites_json, primary_sources_json,
              why_this_matters, anchors_json, lab_spec, sources_json
       FROM modules WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        track: string;
        name: string;
        prerequisites_json: string;
        primary_sources_json: string;
        why_this_matters: string;
        anchors_json: string;
        lab_spec: string | null;
        sources_json: string;
      }
    | undefined;
  if (!row) return null;

  const passes: Module['passes'] = {};
  const passRows = db
    .prepare('SELECT kind, body_md FROM module_passes WHERE module_id = ?')
    .all(id) as { kind: 'tenYearOld' | 'engineer' | 'operator'; body_md: string }[];
  for (const p of passRows) passes[p.kind] = p.body_md;

  const visuals = (
    db
      .prepare(
        'SELECT type, title, data_json FROM module_visuals WHERE module_id = ? ORDER BY ord',
      )
      .all(id) as { type: string; title: string | null; data_json: string }[]
  ).map((v) => {
    const out: Module['visuals'][number] = {
      type: v.type as Module['visuals'][number]['type'],
      data: JSON.parse(v.data_json),
    };
    if (v.title !== null) out.title = v.title;
    return out;
  });

  const diagrams = (
    db
      .prepare(
        'SELECT kind, body FROM module_diagrams WHERE module_id = ? ORDER BY ord',
      )
      .all(id) as { kind: 'mermaid' | 'ascii' | 'code'; body: string }[]
  ).map((d) => ({ kind: d.kind, body: d.body }));

  const drills = (
    db
      .prepare(
        'SELECT scenario, dc1, dc2 FROM module_drills WHERE module_id = ? ORDER BY ord',
      )
      .all(id) as { scenario: string; dc1: string | null; dc2: string | null }[]
  ).map((d) => {
    const out: Module['drills'][number] = { scenario: d.scenario };
    if (d.dc1 !== null) out.dc1 = d.dc1;
    if (d.dc2 !== null) out.dc2 = d.dc2;
    return out;
  });

  const stressTests = db
    .prepare(
      'SELECT lens, question FROM module_stress_tests WHERE module_id = ? ORDER BY ord',
    )
    .all(id) as { lens: 'board' | 'researcher' | 'analyst'; question: string }[];

  const flashcardSeeds = (
    db
      .prepare(
        'SELECT seed FROM module_flashcard_seeds WHERE module_id = ? ORDER BY ord',
      )
      .all(id) as { seed: string }[]
  ).map((s) => s.seed);

  const out: Module = {
    id: row.id,
    track: row.track as Module['track'],
    name: row.name,
    prerequisites: JSON.parse(row.prerequisites_json),
    primarySources: JSON.parse(row.primary_sources_json),
    whyThisMatters: row.why_this_matters,
    anchors: JSON.parse(row.anchors_json),
    passes,
    diagrams,
    visuals,
    drills,
    stressTests,
    flashcardSeeds,
    sources: JSON.parse(row.sources_json),
  };
  // parseModule emits `labSpec: undefined` when the section is missing; SQLite
  // gives us `null`. Match the parser: only set the key when non-null.
  if (row.lab_spec !== null) out.labSpec = row.lab_spec;
  else out.labSpec = undefined;
  return out;
}

// ── MCQ pool ────────────────────────────────────────────────────────────────

function writePool(
  db: BSDatabase,
  id: string,
  raw: string,
  hash: string,
  mtimeMs: number,
): void {
  const parsed = validatePool(JSON.parse(raw));
  if (parsed.moduleId !== id) {
    throw new Error(
      `indexer: pool file has moduleId "${parsed.moduleId}", expected "${id}"`,
    );
  }
  const now = Date.now();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO mcq_pools(module_id, content_hash, updated_at) VALUES (?,?,?)
       ON CONFLICT(module_id) DO UPDATE SET
         content_hash=excluded.content_hash,
         updated_at=excluded.updated_at`,
    ).run(parsed.moduleId, hash, now);

    // Clear + rewrite all question rows so updates can shrink the pool.
    db.prepare('DELETE FROM mcq_questions WHERE module_id = ?').run(parsed.moduleId);

    const ins = db.prepare(
      `INSERT INTO mcq_questions(id, module_id, ord, difficulty, dimension, stem,
                                 options_json, correct_index,
                                 distractor_misconceptions_json, explanation, source_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    // Mirror FileMCQRepository.loadPool: normalize the moduleId onto every q.
    parsed.questions.forEach((q, i) =>
      ins.run(
        q.id,
        parsed.moduleId,
        i,
        q.difficulty,
        q.dimension,
        q.stem,
        JSON.stringify(q.options),
        q.correctIndex,
        JSON.stringify(q.distractorMisconception),
        q.explanation,
        q.sourceRef ?? null,
      ),
    );

    db.prepare(
      `INSERT INTO index_rows(kind, entity_id, content_hash, mtime_ms, indexed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(kind, entity_id) DO UPDATE SET
         content_hash=excluded.content_hash,
         mtime_ms=excluded.mtime_ms,
         indexed_at=excluded.indexed_at`,
    ).run('pool', parsed.moduleId, hash, mtimeMs, now);
  });
  tx();
}

/**
 * Reconstruct an MCQPool from the cache. Returns null if no pool row exists.
 * Output shape matches `FileMCQRepository.loadPool()` — moduleId is normalized
 * onto every question — so the round-trip test can deep-equal the validator.
 */
export function selectPool(db: BSDatabase, id: string): MCQPool | null {
  const head = db
    .prepare('SELECT module_id FROM mcq_pools WHERE module_id = ?')
    .get(id) as { module_id: string } | undefined;
  if (!head) return null;

  const rows = db
    .prepare(
      `SELECT id, module_id, difficulty, dimension, stem, options_json,
              correct_index, distractor_misconceptions_json, explanation, source_ref
       FROM mcq_questions WHERE module_id = ? ORDER BY ord`,
    )
    .all(id) as Array<{
    id: string;
    module_id: string;
    difficulty: 'easy' | 'medium' | 'hard';
    dimension: 'topic' | 'logic' | 'example' | 'extension';
    stem: string;
    options_json: string;
    correct_index: number;
    distractor_misconceptions_json: string;
    explanation: string;
    source_ref: string | null;
  }>;

  return {
    moduleId: head.module_id,
    questions: rows.map((r) => {
      const q: MCQPool['questions'][number] = {
        id: r.id,
        moduleId: head.module_id,
        difficulty: r.difficulty,
        dimension: r.dimension,
        stem: r.stem,
        options: JSON.parse(r.options_json),
        correctIndex: r.correct_index,
        distractorMisconception: JSON.parse(r.distractor_misconceptions_json),
        explanation: r.explanation,
      };
      if (r.source_ref !== null) q.sourceRef = r.source_ref;
      return q;
    }),
  };
}

// ── Flashcards ──────────────────────────────────────────────────────────────

function writeFlashcards(
  db: BSDatabase,
  entityId: string,
  raw: string,
  fileHash: string,
  mtimeMs: number,
): void {
  const cards = parseFlashcards(raw);
  const now = Date.now();

  const tx = db.transaction(() => {
    // Sidecar is the source of truth for the deck; clear + rewrite all cards.
    db.prepare('DELETE FROM flashcards').run();

    const ins = db.prepare(
      `INSERT INTO flashcards(id, module_id, ord, last_tested, front, back, content_hash, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    cards.forEach((c, i) => {
      // Per-card content_hash: sha256 of front || '::' || back || '::' || moduleId || '::' || lastTested.
      // Stable across reorderings of unrelated lines so unchanged cards keep the
      // same hash even if a neighbour was edited.
      const perCard = computeContentHash(
        `${c.front}::${c.back}::${c.moduleId}::${c.lastTested ?? ''}`,
      );
      ins.run(c.id, c.moduleId, i, c.lastTested, c.front, c.back, perCard, now);
    });

    db.prepare(
      `INSERT INTO index_rows(kind, entity_id, content_hash, mtime_ms, indexed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(kind, entity_id) DO UPDATE SET
         content_hash=excluded.content_hash,
         mtime_ms=excluded.mtime_ms,
         indexed_at=excluded.indexed_at`,
    ).run('flashcards', entityId, fileHash, mtimeMs, now);
  });
  tx();
}

/** Read all flashcards back from the cache, preserving file order. */
export function selectFlashcards(db: BSDatabase): Flashcard[] {
  const rows = db
    .prepare(
      'SELECT id, module_id, last_tested, front, back FROM flashcards ORDER BY ord',
    )
    .all() as Array<{
    id: string;
    module_id: string;
    last_tested: string | null;
    front: string;
    back: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    moduleId: r.module_id,
    lastTested: r.last_tested,
    front: r.front,
    back: r.back,
  }));
}

// ── Sidecar state mirror ────────────────────────────────────────────────────

/**
 * Mirror `_llmtutor-state.json` into the cache:
 *   - `module_state`     (one row per moduleId; ModuleState columns + JSON blobs)
 *   - `flashcard_state`  (one row per card id; SR state columns)
 *   - `app_state`        (singleton id=1: version + xp + streak + sessionLog)
 *
 * Sidecar remains the source of truth (the learner writes to it through
 * JsonStateStore.write). This function rewrites the cache to match.
 *
 * Idempotency: we compute a content_hash over the raw sidecar bytes (or, when
 * the sidecar is missing, over the JSON-serialized defaults) and skip the
 * rewrite when it matches index_rows[(kind='state', entity_id='_')].
 */
export async function indexState(
  db: BSDatabase,
  dir: string,
  fs: FsLike = defaultFs,
): Promise<void> {
  const filePath = join(dir, '_llmtutor-state.json');

  let raw: string | null = null;
  let mtimeMs = 0;
  try {
    raw = await fs.readFile(filePath);
    const s = await fs.stat(filePath);
    mtimeMs = s.mtimeMs;
  } catch {
    // Missing sidecar is fine; JsonStateStore.read() returns defaults.
    raw = null;
  }

  // Always go through JsonStateStore.read() so we use the same default-fallback
  // semantics as the existing learner — never reimplement that surface here.
  const state: TutorState = await new JsonStateStore(dir).read();
  const hash = computeContentHash(raw ?? JSON.stringify(state));

  const prev = db
    .prepare("SELECT content_hash FROM index_rows WHERE kind = 'state' AND entity_id = '_'")
    .get() as { content_hash: string } | undefined;
  if (prev && prev.content_hash === hash) return;

  const now = Date.now();

  const tx = db.transaction(() => {
    // Module state: clear + rewrite (sidecar is the source of truth for the map).
    db.prepare('DELETE FROM module_state').run();
    const insMod = db.prepare(
      `INSERT INTO module_state(module_id, mastery, mastery_history_json,
                                mcq_state_json, stress_test_json, updated_at)
       VALUES (?,?,?,?,?,?)`,
    );
    for (const [moduleId, ms] of Object.entries(state.modules)) {
      insMod.run(
        moduleId,
        ms.mastery,
        JSON.stringify(ms.masteryHistory),
        JSON.stringify(ms.mcq),
        JSON.stringify(ms.stressTest),
        now,
      );
    }

    // Flashcard SR state.
    db.prepare('DELETE FROM flashcard_state').run();
    const insFc = db.prepare(
      `INSERT INTO flashcard_state(card_id, last_tested, interval_days, ease, updated_at)
       VALUES (?,?,?,?,?)`,
    );
    for (const [cardId, fc] of Object.entries(state.flashcards)) {
      insFc.run(cardId, fc.lastTested, fc.intervalDays, fc.ease, now);
    }

    // App singleton.
    db.prepare(
      `INSERT INTO app_state(id, version, xp_total, xp_this_week, streak_count,
                             streak_last_active, streak_freeze_tokens,
                             session_log_json, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version=excluded.version,
         xp_total=excluded.xp_total,
         xp_this_week=excluded.xp_this_week,
         streak_count=excluded.streak_count,
         streak_last_active=excluded.streak_last_active,
         streak_freeze_tokens=excluded.streak_freeze_tokens,
         session_log_json=excluded.session_log_json,
         updated_at=excluded.updated_at`,
    ).run(
      state.version,
      state.xp.total,
      state.xp.thisWeek,
      state.streak.count,
      state.streak.lastActive,
      state.streak.freezeTokens,
      JSON.stringify(state.sessionLog),
      now,
    );

    db.prepare(
      `INSERT INTO index_rows(kind, entity_id, content_hash, mtime_ms, indexed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(kind, entity_id) DO UPDATE SET
         content_hash=excluded.content_hash,
         mtime_ms=excluded.mtime_ms,
         indexed_at=excluded.indexed_at`,
    ).run('state', '_', hash, mtimeMs, now);
  });
  tx();
}

/** Read the cached ModuleState for `id`, returning a default when no row exists. */
export function selectModuleState(db: BSDatabase, id: string): ModuleState {
  const row = db
    .prepare(
      `SELECT mastery, mastery_history_json, mcq_state_json, stress_test_json
       FROM module_state WHERE module_id = ?`,
    )
    .get(id) as
    | {
        mastery: string;
        mastery_history_json: string;
        mcq_state_json: string;
        stress_test_json: string;
      }
    | undefined;
  if (!row) return defaultModuleState();
  return {
    mastery: row.mastery as ModuleState['mastery'],
    masteryHistory: JSON.parse(row.mastery_history_json),
    mcq: JSON.parse(row.mcq_state_json),
    stressTest: JSON.parse(row.stress_test_json),
  };
}

// ── Batch indexer ───────────────────────────────────────────────────────────

/** Per-file error report yielded by `indexAll`. `kind` is the entity kind we
 *  attempted; `id` is the best-known identifier (frontmatter id, basename, or
 *  the filename itself when the id could not be resolved). */
export interface IndexAllError {
  kind: EntityKind;
  id: string;
  error: string;
}

/** Summary report from a full-curriculum index pass. */
export interface IndexAllReport {
  indexed: number;
  skipped: number;
  errors: IndexAllError[];
}

/**
 * Full curriculum sweep — mirrors the four on-disk surfaces the learner reads:
 *   1. every top-level `*.md` (skipping `_`-prefixed sidecars) → indexEntity('module', id)
 *      where `id` is read from the file's frontmatter `module_id` (parseModule).
 *   2. every `mcq/*.json` → indexEntity('pool', basename-without-`.json`)
 *   3. `_flashcards.md` if present → indexEntity('flashcards', '_flashcards')
 *   4. `_llmtutor-state.json` (or defaults) → indexState
 *
 * Per-file failures are collected into `errors` and surfaced as `console.warn`
 * — one broken file does NOT abort the batch (mirrors CurriculumRepositoryImpl).
 * Returns `{indexed, skipped, errors}` so callers (Phase 3 API routes, the
 * factory's lazy refresh in Task 12) can report progress without re-walking.
 */
export async function indexAll(
  db: BSDatabase,
  dir: string,
  fs: FsLike = defaultFs,
): Promise<IndexAllReport> {
  const errors: IndexAllError[] = [];
  let indexed = 0;
  let skipped = 0;

  // Snapshot index_rows so we can detect no-op (skipped) entries by comparing
  // `indexed_at` before / after each `indexEntity` / `indexState` call.
  const snapshot = (kind: EntityKind, id: string): number | undefined => {
    const row = db
      .prepare('SELECT indexed_at FROM index_rows WHERE kind = ? AND entity_id = ?')
      .get(kind, id) as { indexed_at: number } | undefined;
    return row?.indexed_at;
  };

  // 1. Modules — read each markdown file once, parse its frontmatter to get the
  //    id, then call indexEntity('module', id) which reparses the same bytes.
  //    The double-parse is microseconds and keeps indexEntity's contract simple
  //    (it owns its own file read for hash-skip semantics).
  const top = await fs.readdir(dir);
  const moduleFiles = top.filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  for (const f of moduleFiles) {
    let id: string | null = null;
    try {
      const raw = await fs.readFile(join(dir, f));
      const peek = parseModule(raw);
      if (!peek.id) {
        // .md without a module_id is fine (e.g. a README); skip silently — this
        // matches CurriculumRepositoryImpl's behavior.
        continue;
      }
      id = peek.id;
      const before = snapshot('module', id);
      await indexEntity(db, dir, 'module', id, fs);
      const after = snapshot('module', id);
      if (before !== undefined && after === before) skipped += 1;
      else indexed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reportedId = id ?? f;
      console.warn(`[cms.indexAll] skipping module file ${f}: ${msg}`);
      errors.push({ kind: 'module', id: reportedId, error: msg });
    }
  }

  // 2. Pools — id is the basename without `.json`.
  let mcqEntries: string[] = [];
  try {
    mcqEntries = await fs.readdir(join(dir, 'mcq'));
  } catch {
    // No mcq/ directory is fine (state-only curriculum, brand-new dir, etc.).
  }
  for (const f of mcqEntries.filter((n) => n.endsWith('.json')).sort()) {
    const id = f.replace(/\.json$/, '');
    try {
      const before = snapshot('pool', id);
      await indexEntity(db, dir, 'pool', id, fs);
      const after = snapshot('pool', id);
      if (before !== undefined && after === before) skipped += 1;
      else indexed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[cms.indexAll] skipping pool ${id}: ${msg}`);
      errors.push({ kind: 'pool', id, error: msg });
    }
  }

  // 3. Flashcards (single _flashcards.md if present).
  if (top.includes('_flashcards.md')) {
    try {
      const before = snapshot('flashcards', '_flashcards');
      await indexEntity(db, dir, 'flashcards', '_flashcards', fs);
      const after = snapshot('flashcards', '_flashcards');
      if (before !== undefined && after === before) skipped += 1;
      else indexed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[cms.indexAll] skipping _flashcards.md: ${msg}`);
      errors.push({ kind: 'flashcards', id: '_flashcards', error: msg });
    }
  }

  // 4. State — always run; JsonStateStore.read() returns defaults on missing
  //    sidecar so we never throw here in practice.
  try {
    const before = snapshot('state', '_');
    await indexState(db, dir, fs);
    const after = snapshot('state', '_');
    if (before !== undefined && after === before) skipped += 1;
    else indexed += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cms.indexAll] skipping state: ${msg}`);
    errors.push({ kind: 'state', id: '_', error: msg });
  }

  return { indexed, skipped, errors };
}

/** Read the cached app singleton — version + xp + streak + sessionLog. */
export function selectAppState(
  db: BSDatabase,
): Pick<TutorState, 'version' | 'xp' | 'streak' | 'sessionLog'> {
  const row = db
    .prepare(
      `SELECT version, xp_total, xp_this_week, streak_count, streak_last_active,
              streak_freeze_tokens, session_log_json
       FROM app_state WHERE id = 1`,
    )
    .get() as
    | {
        version: number;
        xp_total: number;
        xp_this_week: number;
        streak_count: number;
        streak_last_active: string;
        streak_freeze_tokens: number;
        session_log_json: string;
      }
    | undefined;
  if (!row) {
    return {
      version: 1,
      xp: { total: 0, thisWeek: 0 },
      streak: { count: 0, lastActive: '', freezeTokens: 1 },
      sessionLog: [],
    };
  }
  return {
    version: row.version as 1,
    xp: { total: row.xp_total, thisWeek: row.xp_this_week },
    streak: {
      count: row.streak_count,
      lastActive: row.streak_last_active,
      freezeTokens: row.streak_freeze_tokens,
    },
    sessionLog: JSON.parse(row.session_log_json),
  };
}
