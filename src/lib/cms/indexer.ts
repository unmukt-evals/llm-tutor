import 'server-only';
import { promises as fsp, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as BSDatabase } from 'better-sqlite3';

import type { EntityKind, Module } from '@/lib/cms/types';
import { computeContentHash } from '@/lib/cms/hash';
import { parseModule } from '@/lib/ingest/parse-module';

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
