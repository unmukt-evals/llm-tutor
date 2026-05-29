/**
 * Task 7 — indexer `writeSources` + `writeModule` extends `module_sources`
 *
 * Source-only tests use an in-memory FsLike shim (pathFor('source') is a pure
 * join — no readdirSync). Module-related tests write to a real tmpdir because
 * resolveModulePath calls readdirSync, bypassing the injected FsLike.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb, runMigrations } from '@/lib/cms/db';
import { indexEntity, indexAll, defaultFs } from '@/lib/cms/indexer';
import type { FsLike } from '@/lib/cms/indexer';
import type { SourcesDoc } from '@/lib/cms/types';
import type { Source } from '@/lib/types';
import { computeContentHash } from '@/lib/cms/hash';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> & Pick<Source, 'id' | 'title'>): Source {
  const base: Source = {
    id: overrides.id,
    kind: overrides.kind ?? 'url',
    title: overrides.title,
    url: 'url' in overrides ? overrides.url : `https://example.com/${overrides.id}`,
    author: overrides.author,
    cluster: overrides.cluster,
    summary: overrides.summary,
    thesis: overrides.thesis,
    mechanism: overrides.mechanism,
    quotes: overrides.quotes,
    grounds: overrides.grounds,
    raw_text: overrides.raw_text ?? '',
    fetched_at: overrides.fetched_at,
    content_hash: '',
    updated_at: overrides.updated_at ?? Date.now(),
  };
  base.content_hash = computeContentHash(
    JSON.stringify({
      kind: base.kind,
      title: base.title,
      url: base.url,
      author: base.author,
      cluster: base.cluster,
      summary: base.summary,
      thesis: base.thesis,
      mechanism: base.mechanism,
      quotes: base.quotes,
      grounds: base.grounds,
      raw_text: base.raw_text,
      fetched_at: base.fetched_at,
    }),
  );
  return base;
}

function makeDoc(sources: Source[]): SourcesDoc {
  return { version: 1, sources };
}

/** Build an in-memory FsLike that serves a fixed map of path → content.
 *  Safe only for entity kinds whose pathFor() is a pure join (pool, source,
 *  flashcards, state). NOT safe for module — resolveModulePath uses readdirSync. */
function makeFs(files: Record<string, string>): FsLike {
  return {
    readFile: async (p) => {
      if (p in files) return files[p];
      throw Object.assign(new Error(`ENOENT: no such file ${p}`), { code: 'ENOENT' });
    },
    stat: async () => ({ mtimeMs: 1_000_000 }),
    readdir: async (p) => {
      const prefix = p.endsWith('/') ? p : p + '/';
      return Object.keys(files)
        .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
        .map((f) => f.slice(prefix.length));
    },
  };
}

const SOURCES_DIR = '/test/curriculum';

// Minimal module markdown with primary_sources: ["S1","S2"]
const B02_MD = `---
module_id: B02
track: B
name: Test Module B02
prerequisites: []
primary_sources: [S1, S2]
---

# Test Module B02

## Why this matters

Testing.

## Anchor scenarios

1. Test anchor.

### 10-year-old pass

Simple.

### Engineer pass

Technical.

## Application drills

### Drill 1

**Scenario:** Test drill.

## Stress-test pool

### Stress test 1

**Lens:** board
**Question:** Is this tested?

## Flashcard seeds

Test seed.

## Sources

- S1
`;

// ── Source-only tests (in-memory FsLike is fine here) ───────────────────────

describe("indexEntity('source', '_sources')", () => {
  it('indexes each Source into the sources table', async () => {
    const s1 = makeSource({
      id: 'S1',
      title: 'Source One',
      summary: 'A summary',
      author: 'Alice',
      cluster: 'Cluster 1',
      thesis: 'A thesis',
      mechanism: 'A mechanism',
      quotes: ['Quote A', 'Quote B'],
      grounds: ['B01'],
    });
    const s2 = makeSource({ id: 'S2', title: 'Source Two', kind: 'doc', url: undefined });
    const doc = makeDoc([s1, s2]);
    const fs = makeFs({ [`${SOURCES_DIR}/_sources.json`]: JSON.stringify(doc) });

    const db = getDb(':memory:');
    runMigrations(db);

    await indexEntity(db, SOURCES_DIR, 'source', '_sources', fs);

    const rows = db
      .prepare(
        'SELECT id, kind, title, url, summary, author, cluster, thesis, mechanism, quotes_json, grounds_json FROM sources ORDER BY id',
      )
      .all() as Array<{
      id: string; kind: string; title: string; url: string | null; summary: string | null;
      author: string | null; cluster: string | null; thesis: string | null;
      mechanism: string | null; quotes_json: string; grounds_json: string;
    }>;

    expect(rows).toHaveLength(2);

    const r1 = rows.find((r) => r.id === 'S1')!;
    expect(r1.id).toBe('S1');
    expect(r1.kind).toBe('url');
    expect(r1.title).toBe('Source One');
    expect(r1.url).toBe('https://example.com/S1');
    expect(r1.summary).toBe('A summary');
    expect(r1.author).toBe('Alice');
    expect(r1.cluster).toBe('Cluster 1');
    expect(r1.thesis).toBe('A thesis');
    expect(r1.mechanism).toBe('A mechanism');
    expect(JSON.parse(r1.quotes_json)).toEqual(['Quote A', 'Quote B']);
    expect(JSON.parse(r1.grounds_json)).toEqual(['B01']);

    const r2 = rows.find((r) => r.id === 'S2')!;
    expect(r2.id).toBe('S2');
    expect(r2.kind).toBe('doc');
    expect(r2.title).toBe('Source Two');
    expect(r2.url).toBeNull();

    db.close();
  });

  it('updates a row in place on re-index; row count unchanged', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Original Title' });
    const s2 = makeSource({ id: 'S2', title: 'Stable' });
    const doc1 = makeDoc([s1, s2]);

    const db = getDb(':memory:');
    runMigrations(db);
    await indexEntity(db, SOURCES_DIR, 'source', '_sources', makeFs({ [`${SOURCES_DIR}/_sources.json`]: JSON.stringify(doc1) }));

    // Edit S1's title and force a different content_hash so the no-op guard doesn't fire
    const s1Updated = makeSource({ id: 'S1', title: 'Updated Title', updated_at: Date.now() + 1 });
    const doc2 = makeDoc([s1Updated, s2]);
    const newJson = JSON.stringify(doc2);

    await indexEntity(db, SOURCES_DIR, 'source', '_sources', makeFs({ [`${SOURCES_DIR}/_sources.json`]: newJson }));

    const count = (db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n;
    expect(count).toBe(2);

    const r1 = db.prepare("SELECT title FROM sources WHERE id = 'S1'").get() as { title: string };
    expect(r1.title).toBe('Updated Title');

    db.close();
  });

  it('removes a source from the table when removed from JSON', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Keep' });
    const s2 = makeSource({ id: 'S2', title: 'Remove me' });
    const doc1 = makeDoc([s1, s2]);

    const db = getDb(':memory:');
    runMigrations(db);
    await indexEntity(
      db, SOURCES_DIR, 'source', '_sources',
      makeFs({ [`${SOURCES_DIR}/_sources.json`]: JSON.stringify(doc1) }),
    );

    // Remove S2 from doc — force different hash by changing content
    const doc2 = makeDoc([s1]);
    const newJson = JSON.stringify(doc2) + ' '; // trailing space forces hash change
    await indexEntity(
      db, SOURCES_DIR, 'source', '_sources',
      makeFs({ [`${SOURCES_DIR}/_sources.json`]: newJson }),
    );

    const ids = (db.prepare('SELECT id FROM sources').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(['S1']);

    db.close();
  });

  it('writes an index_rows entry for (_sources) with a 64-char sha256', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Source One' });
    const doc = makeDoc([s1]);
    const fs = makeFs({ [`${SOURCES_DIR}/_sources.json`]: JSON.stringify(doc) });

    const db = getDb(':memory:');
    runMigrations(db);
    await indexEntity(db, SOURCES_DIR, 'source', '_sources', fs);

    const row = db
      .prepare("SELECT content_hash FROM index_rows WHERE kind='source' AND entity_id='_sources'")
      .get() as { content_hash: string } | undefined;
    expect(row?.content_hash).toMatch(/^[0-9a-f]{64}$/);

    db.close();
  });

  it('handles an empty sources array (vacuum — deletes all existing rows)', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Source One' });
    const doc1 = makeDoc([s1]);

    const db = getDb(':memory:');
    runMigrations(db);
    await indexEntity(
      db, SOURCES_DIR, 'source', '_sources',
      makeFs({ [`${SOURCES_DIR}/_sources.json`]: JSON.stringify(doc1) }),
    );

    const countBefore = (db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n;
    expect(countBefore).toBe(1);

    // Empty doc — force different hash
    const doc2 = makeDoc([]);
    const emptyJson = JSON.stringify(doc2) + ' ';
    await indexEntity(
      db, SOURCES_DIR, 'source', '_sources',
      makeFs({ [`${SOURCES_DIR}/_sources.json`]: emptyJson }),
    );

    const countAfter = (db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n;
    expect(countAfter).toBe(0);

    db.close();
  });
});

// ── Module+sources tests (real tmpdir required for resolveModulePath) ─────────

describe('writeModule populates module_sources', () => {
  it("after indexEntity('source') then indexEntity('module','B02'): module_sources has (B02,S1) and (B02,S2)", async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-src-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const s2 = makeSource({ id: 'S2', title: 'Source Two' });
      const doc = makeDoc([s1, s2]);

      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      const db = getDb(':memory:');
      runMigrations(db);

      await indexEntity(db, tmp, 'source', '_sources');
      await indexEntity(db, tmp, 'module', 'B02');

      const rows = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ? ORDER BY source_id')
        .all('B02') as { source_id: string }[];
      expect(rows.map((r) => r.source_id)).toEqual(['S1', 'S2']);

      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("indexEntity('module','B02') BEFORE sources indexed: succeeds, zero module_sources rows, FK failures logged via console.warn", async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-src-'));
    try {
      // Only write the module file — sources table is empty
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      const db = getDb(':memory:');
      runMigrations(db);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // S1 and S2 don't exist yet — must not throw
      await expect(indexEntity(db, tmp, 'module', 'B02')).resolves.toBeUndefined();

      // No module_sources rows
      const rows = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ?')
        .all('B02') as { source_id: string }[];
      expect(rows).toHaveLength(0);

      // FK failures logged — one warn per failed source insert (S1, S2)
      expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const warnText = warnSpy.mock.calls.map((args) => String(args[0])).join('\n');
      expect(warnText).toMatch(/module_sources/);
      expect(warnText).toMatch(/S1|S2/);

      warnSpy.mockRestore();
      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('cascade: removing a source from sources drops its module_sources link', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-src-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const s2 = makeSource({ id: 'S2', title: 'Source Two' });
      const doc = makeDoc([s1, s2]);

      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      const db = getDb(':memory:');
      runMigrations(db);

      await indexEntity(db, tmp, 'source', '_sources');
      await indexEntity(db, tmp, 'module', 'B02');

      const before = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ?')
        .all('B02') as { source_id: string }[];
      expect(before.map((r) => r.source_id).sort()).toEqual(['S1', 'S2']);

      // Remove S2 from sources JSON; write new content to change hash
      const doc2 = makeDoc([s1]);
      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc2) + '\n', 'utf8');
      await indexEntity(db, tmp, 'source', '_sources');

      // ON DELETE CASCADE should have removed (B02, S2)
      const after = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ?')
        .all('B02') as { source_id: string }[];
      expect(after.map((r) => r.source_id)).toEqual(['S1']);

      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('re-running writeModule with updated primary_sources rewrites module_sources', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cms-src-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const s2 = makeSource({ id: 'S2', title: 'Source Two' });
      const doc = makeDoc([s1, s2]);

      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      const db = getDb(':memory:');
      runMigrations(db);

      await indexEntity(db, tmp, 'source', '_sources');
      await indexEntity(db, tmp, 'module', 'B02');

      const first = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ? ORDER BY source_id')
        .all('B02') as { source_id: string }[];
      expect(first.map((r) => r.source_id)).toEqual(['S1', 'S2']);

      // Modify module to only reference S1 — change content so hash differs
      const B02_MODIFIED = B02_MD.replace('primary_sources: [S1, S2]', 'primary_sources: [S1]');
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MODIFIED, 'utf8');

      await indexEntity(db, tmp, 'module', 'B02');

      const second = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ? ORDER BY source_id')
        .all('B02') as { source_id: string }[];
      expect(second.map((r) => r.source_id)).toEqual(['S1']);

      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── indexAll sweeps _sources.json ────────────────────────────────────────────

describe('indexAll sweeps _sources.json', () => {
  it('after indexAll over a dir with only _sources.json, sources table has the expected rows', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Source One' });
    const s2 = makeSource({ id: 'S2', title: 'Source Two' });
    const doc = makeDoc([s1, s2]);

    const fs = makeFs({ [`${SOURCES_DIR}/_sources.json`]: JSON.stringify(doc) });

    const db = getDb(':memory:');
    runMigrations(db);

    const report = await indexAll(db, SOURCES_DIR, fs);

    const rows = db
      .prepare('SELECT id FROM sources ORDER BY id')
      .all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['S1', 'S2']);

    // indexed counter must include the sources entry
    expect(report.indexed).toBeGreaterThanOrEqual(1);
    expect(report.errors).toEqual([]);

    db.close();
  });

  it('cold-boot: single indexAll with _sources.json + a module → module_sources populated, no console.warn', async () => {
    // Production cold-boot scenario: sources and a module file are both present.
    // indexAll (sources-first order) must populate module_sources in one pass
    // without any re-touch or second reindex.
    const tmp = await mkdtemp(join(tmpdir(), 'cms-coldboot-'));
    try {
      const s1 = makeSource({ id: 'S1', title: 'Source One' });
      const s2 = makeSource({ id: 'S2', title: 'Source Two' });
      const doc = makeDoc([s1, s2]);

      await writeFile(join(tmp, '_sources.json'), JSON.stringify(doc), 'utf8');
      await writeFile(join(tmp, 'B02-test-module-b02.md'), B02_MD, 'utf8');

      const db = getDb(':memory:');
      runMigrations(db);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Single indexAll — no second pass, no file touch.
      await indexAll(db, tmp, defaultFs);

      // module_sources must have exactly 2 rows (S1, S2) for B02.
      const rows = db
        .prepare('SELECT source_id FROM module_sources WHERE module_id = ? ORDER BY source_id')
        .all('B02') as { source_id: string }[];
      expect(rows.map((r) => r.source_id)).toEqual(['S1', 'S2']);

      // No console.warn should have fired (no FK failures).
      expect(warnSpy.mock.calls.length).toBe(0);

      warnSpy.mockRestore();
      db.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
