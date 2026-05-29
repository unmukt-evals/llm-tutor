# CMS Phase 4 — Source-as-entity + `_sources.json` SoT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Source a first-class CMS entity: `_sources.json` becomes the SoT, `_sources.md` becomes a deterministically-rendered mirror, the indexer populates the existing `sources` + `module_sources` SQLite tables, and `/api/source/apply` writes a Source entity + links every time a draft is applied. One-time migration parses the existing `_sources.md` into `_sources.json` while preserving the `S1`–`S9d` IDs.

**Architecture:** All work is additive to the Phase 1–3 CMS substrate. Phase 1 already shipped: `sources` + `module_sources` tables (empty), `pathFor('source')` → `<dir>/_sources.json`, `EntityKind` includes `'source'`, `classifyPath` routes `_sources.json`, `reindexAffected` supports it. `indexEntity` falls through to a default-throw for `'source'` and `getSources()` returns `[]` with a "Phase 4 will populate" comment — those are the two implementation seams. Source CRUD is layered on the JSON SoT (`writeSourcesJson` does atomic temp+rename, the indexer's new `writeSources` populates SQLite from the parsed JSON). The renderer is pure + deterministic, so re-renders are git-clean and the watcher's `.md` echo is a no-op write. The apply route grows to write the Source entity + links + re-render after `applyCandidate`, wrapped in try/catch like Phase 2/3.

**Tech Stack:** TypeScript strict · Vitest (node env) · `better-sqlite3` · Node `fs/promises` · existing utilities (`computeContentHash`, atomic temp+rename helper if any — else inline).

---

## File Structure

**Create:**
- `src/lib/cms/sources/json-store.ts` — `loadSourcesJson(dir, fs?)` + `writeSourcesJson(dir, doc, fs?)`. Atomic.
- `src/lib/cms/sources/render-md.ts` — `renderSourcesMd(doc): string`. Pure + deterministic.
- `src/lib/cms/sources/migrate-from-md.ts` — `parseSourcesMd(raw): SourcesDoc`. Heuristic for the current shape.
- `src/lib/cms/sources/ensure-json.ts` — `ensureSourcesJson(dir, fs?)`. One-shot migration, idempotent.
- `src/lib/cms/migrations/002_sources_meta.sql` — adds `stale_at INTEGER` (nullable) to `module_sources`.
- `src/lib/cms/sources/__tests__/json-store.test.ts`
- `src/lib/cms/sources/__tests__/render-md.test.ts`
- `src/lib/cms/sources/__tests__/migrate-from-md.test.ts`
- `src/lib/cms/sources/__tests__/ensure-json.test.ts`
- `src/lib/cms/sources/__tests__/fixtures/_sources.excerpt.md` — small but representative excerpt of the real file.
- `src/lib/cms/__tests__/index.sources.test.ts` — exercises `getSources()` / `getSourceById()` / `getSourcesForModule()` once the indexer populates the tables.

**Modify:**
- `src/lib/types.ts` — add `Source` interface; add optional `source_id?: string` on `MCQQuestion` (alongside existing `sourceRef?: string`, which stays for back-compat).
- `src/lib/cms/types.ts` — add `SourcesDoc` (the on-disk JSON shape) + `StoredSource` (CMS row shape).
- `src/lib/cms/indexer.ts` — implement the `case 'source':` branch (calls a new `writeSources(db, raw, hash, mtimeMs)` helper); extend `writeModule` to (re)populate `module_sources` from the parsed `Module.primarySources` array. No change to `writePool` in Phase 4 (per-question `source_id` is wired in types but display-only until Phase 5).
- `src/lib/cms/index.ts` — replace the stub `getSources()` with a real SQLite read; add `getSourceById(id)` + `getSourcesForModule(moduleId)`; call `ensureSourcesJson(dir)` once before the first `lazyRefresh` so the indexer has a JSON to read on cold boot. Extend the read API interface accordingly.
- `src/lib/cms/db.ts` — bump the migration runner so it applies `002_sources_meta.sql`.
- `app/api/source/apply/route.ts` — accept optional `source` metadata in the POST body; after a successful `applyCandidate`, upsert the Source entity in `_sources.json`, render the `.md` mirror atomically, and `reindexAffected(dir, 'source', '_sources')`. All wrapped in try/catch.
- `src/lib/source/api-client.ts` — extend the `applyCandidate` POST helper to forward the source metadata.

**Not changed (Phase 5+):**
- Studio surface, source cascade on re-fetch, MCQ generation prompt asking for `source_id` strictly.

---

## Type contracts (locked — implementers must match these)

```ts
// src/lib/types.ts (additions)
export type SourceKind = 'url' | 'transcript' | 'doc' | 'paper';

export interface Source {
  id: string;                  // "S1", "S9d", or "src_<8-hex>" for new
  kind: SourceKind;
  title: string;
  url?: string;
  author?: string;             // free-form, optional
  cluster?: string;            // e.g. "Cluster 1 — RL post-training"
  summary?: string;            // the "What:" line in current _sources.md
  thesis?: string;             // the "Thesis:" block
  mechanism?: string;          // the "Mechanism that matters:" block
  quotes?: string[];           // every "Quote:" bullet
  grounds?: string[];          // module ids cited as Grounds, e.g. ["B2"]
  raw_text?: string;           // fetched body (kind: 'url') or pasted text (kind: 'transcript')
  fetched_at?: number;         // epoch ms
  content_hash: string;        // sha256 hex over a canonical serialization
  updated_at: number;          // epoch ms
}

// src/lib/types.ts (MCQQuestion extension — additive, sourceRef stays)
export interface MCQQuestion {
  // ...existing fields...
  sourceRef?: string;          // legacy string "S4"; stays for back-compat
  source_id?: string;          // typed link into sources.id; populated when known
}
```

```ts
// src/lib/cms/types.ts (additions)
export interface SourcesDoc {
  version: 1;
  sources: Source[];           // canonical order = order in the array
}
export interface StoredSource extends Source {} // SQLite row mirrors Source 1:1 for Phase 4
```

**`content_hash` for a Source:** sha256 hex of `JSON.stringify({kind,title,url,author,cluster,summary,thesis,mechanism,quotes,grounds,raw_text,fetched_at})` — every semantically-meaningful field, in a fixed key order. Use the existing `computeContentHash` helper from `src/lib/cms/hash.ts` over that canonical string.

**`id` minting for new sources:** `src_<8-hex-of-content_hash>`. Migration preserves the existing `S1`…`S9d` ids verbatim — they're not re-minted.

---

## Task 1: `Source` type + extend `MCQQuestion`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/cms/types.ts`
- Test: `src/lib/cms/sources/__tests__/json-store.test.ts` (created later — Task 2 covers type usage)

This task is types-only; no behavior change. Subsequent tasks consume these contracts.

- [ ] **Step 1: Add `SourceKind` + `Source` interface to `src/lib/types.ts`**

Insert immediately after the `Module` interface, with the field set documented in the "Type contracts" section above. Preserve every existing field on `MCQQuestion`; add `source_id?: string` directly after `sourceRef?: string`. Re-export nothing new from a barrel — call sites import from `@/lib/types` directly.

- [ ] **Step 2: Add `SourcesDoc` + `StoredSource` to `src/lib/cms/types.ts`**

```ts
import type { Source } from '@/lib/types';
export interface SourcesDoc { version: 1; sources: Source[]; }
export type StoredSource = Source;
```

- [ ] **Step 3: Verify typecheck stays green**

Run: `npm run typecheck`
Expected: PASS (no behavior change, types are additive).

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/cms/types.ts
git commit -m "feat(cms): add Source type + extend MCQQuestion with source_id (Phase 4 task 1)"
```

---

## Task 2: `_sources.json` SoT — load + write (pure, atomic)

**Files:**
- Create: `src/lib/cms/sources/json-store.ts`
- Test: `src/lib/cms/sources/__tests__/json-store.test.ts`

The two pure entry points for the JSON SoT. Atomic temp+rename for writes (same pattern as `JsonStateStore.write` — read that file for the exact recipe; do not invent a new one).

**Public API:**
```ts
export async function loadSourcesJson(dir: string, fs?: FsLike): Promise<SourcesDoc>;
export async function writeSourcesJson(dir: string, doc: SourcesDoc, fs?: FsLike): Promise<void>;
```

`loadSourcesJson` returns `{version:1, sources:[]}` if the file is absent. Throws a clear Error on malformed JSON (keep the original parse error nested) — the migration path (Task 5) is the only thing that recovers; everyone else should fail loudly.

`writeSourcesJson` validates `doc.version === 1`, validates every `Source.id` is non-empty and unique within `doc.sources`, then atomic temp+rename. It also ensures every `Source` has up-to-date `content_hash` and `updated_at` — if a caller passes a Source missing either, recompute. Reuse `computeContentHash` from `src/lib/cms/hash.ts`.

- [ ] **Step 1: Write the failing tests**

Cover:
1. `loadSourcesJson` on missing file → returns `{version:1, sources:[]}`.
2. `loadSourcesJson` on valid file → returns parsed `SourcesDoc`.
3. `loadSourcesJson` on malformed JSON → throws with the file path in the message.
4. `writeSourcesJson` then `loadSourcesJson` round-trip → deep-equal.
5. `writeSourcesJson` with two sources sharing an `id` → throws "duplicate source id S1".
6. `writeSourcesJson` fills `content_hash` + `updated_at` when missing.
7. `writeSourcesJson` is atomic (writes a `*.tmp`, renames; the assertion: a write that throws mid-flight does NOT leave a partial `_sources.json`).

For (7), inject an `fs` stub whose `rename` throws and assert the original file (or its absence) is unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/cms/sources/__tests__/json-store.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `json-store.ts`**

Cribbing the temp+rename pattern from `src/lib/state/json-state-store.ts` (or whichever file Phase 1/2 used — find it; do not invent). Use `JSON.stringify(doc, null, 2)` + trailing newline for git-friendly diffs. Sort the field-order inside each Source object using a fixed key list when serializing, so on-disk JSON is stable independent of how callers built the in-memory Source.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/cms/sources/__tests__/json-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/sources/json-store.ts src/lib/cms/sources/__tests__/json-store.test.ts
git commit -m "feat(cms): _sources.json load+atomic-write helpers (Phase 4 task 2)"
```

---

## Task 3: Pure renderer (`SourcesDoc → _sources.md`)

**Files:**
- Create: `src/lib/cms/sources/render-md.ts`
- Test: `src/lib/cms/sources/__tests__/render-md.test.ts`

Deterministic, side-effect-free. Same input → byte-identical output. Re-rendering is a no-op write.

**Public API:**
```ts
export function renderSourcesMd(doc: SourcesDoc): string;
```

**Format (matches the current human-readable shape — read `_sources.md` end-to-end before implementing):**
- Frontmatter block: `type: source-library`, `verified: <ISO date>` (use `new Date().toISOString().slice(0,10)`).
- Top heading: `# Track B — Primary Source Library`
- A short standing intro paragraph (hardcoded — copy verbatim from the current file).
- Sources are grouped by `Source.cluster`. Each cluster gets a `## <cluster>` heading; sources within share the source order from the doc array (do NOT sort by id — id sort would put S10 before S2). Sources without a `cluster` go into a tail `## Unfiled` group.
- Each source: `### <id> · <title>` heading, then bullet lines in this exact order: `- **URL:** <url>`, `- **What:** <summary>`, `- **Thesis:** <thesis>`, `- **Mechanism that matters:** <mechanism>`, then one bullet per `quotes[]` entry as `- **Quote:** <quote>`, and finally `- **Grounds:** <comma-joined ids>`. Skip a bullet entirely if its field is absent.

- [ ] **Step 1: Write the failing tests**

Cover:
1. Empty `doc` → valid markdown with the standing frontmatter + intro and no source sections.
2. Single-source doc → renders the expected block (write the expected string out in full).
3. Two sources in two clusters → cluster headings appear in `doc.sources[].cluster` first-encounter order.
4. Idempotency: `renderSourcesMd(doc) === renderSourcesMd(doc)` byte-for-byte across calls.
5. Stability: re-rendering a doc whose Source field order was shuffled in memory produces the same output (the serializer normalizes).

- [ ] **Step 2: Run tests to verify fail** — `npx vitest run src/lib/cms/sources/__tests__/render-md.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `render-md.ts`** — pure functions only; no Date.now/Math.random; the frontmatter `verified:` value is supplied via an optional `now?: Date` parameter (default `new Date()`) so tests can fix it.

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/sources/render-md.ts src/lib/cms/sources/__tests__/render-md.test.ts
git commit -m "feat(cms): deterministic _sources.json -> _sources.md renderer (Phase 4 task 3)"
```

---

## Task 4: One-time migration parser (`_sources.md → SourcesDoc`)

**Files:**
- Create: `src/lib/cms/sources/migrate-from-md.ts`
- Create: `src/lib/cms/sources/__tests__/fixtures/_sources.excerpt.md`
- Test: `src/lib/cms/sources/__tests__/migrate-from-md.test.ts`

Heuristic parser for the current `_sources.md` shape. Reads each `## Cluster N — <name>` block; under each, reads each `### S<digit><letter?> · <title>` block; pulls the `- **<Label>:**` bullets within into the matching Source fields. **Preserves `S1`–`S9d` IDs verbatim.** Falls back gracefully on missing fields (just don't set them on the Source).

**Public API:**
```ts
export function parseSourcesMd(raw: string): SourcesDoc;
```

- [ ] **Step 1: Create the fixture**

Copy 3 representative source entries from the live `_sources.md` into `fixtures/_sources.excerpt.md` — include at least:
- One with a sub-letter id (`S9a` or `S9b`).
- One with multiple `Quote:` bullets.
- One under each of two different `## Cluster` headings (proves cluster bookkeeping).

Live file lives at `/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/_sources.md`. Read it (Read tool) and copy the chosen blocks verbatim — the parser must work against the real shape.

- [ ] **Step 2: Write the failing tests**

Cover:
1. `parseSourcesMd` over the fixture → returns a `SourcesDoc` with exactly N sources whose `id`s match the fixture's `S…` labels in the order they appear.
2. Each parsed Source has the right `cluster`, `title` (heading minus id + " · "), `url`, `summary`, `thesis`, `mechanism`, `quotes[]`, `grounds[]`.
3. Sources missing optional fields (no Quote, no Grounds) parse without throwing; the fields are undefined or empty array as appropriate.
4. `content_hash` + `updated_at` are populated on every returned Source.
5. The parser is pure: parsing the same string twice with the same clock returns deep-equal docs.

- [ ] **Step 3: Run tests to verify fail.**

- [ ] **Step 4: Implement `parseSourcesMd`** — line-walk + state machine: track current cluster + current source; flush sources into the doc array on heading transition; recognize bullet labels via `^- \*\*(URL|What|Thesis|Mechanism that matters|Quote|Grounds):\*\*` regex. `kind` is inferred as `'url'` when a URL is present, else `'doc'`. Reuse `computeContentHash`. Use `Date.now()` for `updated_at` — accept an optional `now?: number` parameter for testability.

- [ ] **Step 5: Run tests to verify pass.**

- [ ] **Step 6: Commit**

```bash
git add src/lib/cms/sources/migrate-from-md.ts src/lib/cms/sources/__tests__/migrate-from-md.test.ts src/lib/cms/sources/__tests__/fixtures/_sources.excerpt.md
git commit -m "feat(cms): one-time _sources.md -> _sources.json migration parser (Phase 4 task 4)"
```

---

## Task 5: Migration runner (`ensureSourcesJson(dir)`) — idempotent one-shot

**Files:**
- Create: `src/lib/cms/sources/ensure-json.ts`
- Test: `src/lib/cms/sources/__tests__/ensure-json.test.ts`

**Public API:**
```ts
export async function ensureSourcesJson(dir: string, fs?: FsLike): Promise<{ migrated: boolean }>;
```

Behavior:
- If `<dir>/_sources.json` exists → returns `{migrated: false}`. No work.
- Else if `<dir>/_sources.md` exists → read it, run `parseSourcesMd`, write via `writeSourcesJson`. Returns `{migrated: true}`. **Does NOT delete or rename `_sources.md`** — it stays in place but is no longer authoritative (Phase 5/6 may retire it).
- Else → write an empty `{version:1, sources:[]}` via `writeSourcesJson`. Returns `{migrated: true}`.
- Idempotent: a second call is a no-op (it sees the JSON exists).

- [ ] **Step 1: Write the failing tests**

Cover:
1. No json, no md → writes empty doc, returns `{migrated: true}`.
2. No json, md present → migrates, returns `{migrated: true}`, parsed doc deep-equals `parseSourcesMd(rawMd)` (modulo any non-deterministic `updated_at`).
3. json present, md present → no work, returns `{migrated: false}`.
4. Second invocation after a successful migration → returns `{migrated: false}`.

- [ ] **Step 2: Run tests to verify fail.** — `npx vitest run src/lib/cms/sources/__tests__/ensure-json.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/sources/ensure-json.ts src/lib/cms/sources/__tests__/ensure-json.test.ts
git commit -m "feat(cms): idempotent _sources.json migration runner (Phase 4 task 5)"
```

---

## Task 6: SQLite migration `002_sources_meta.sql`

**Files:**
- Create: `src/lib/cms/migrations/002_sources_meta.sql`
- Test: extend an existing migration test (or write `src/lib/cms/__tests__/migrations.002.test.ts`)

Two changes:

1. **`module_sources`** gains `stale_at INTEGER` (nullable) — surface for the Phase 5/6 "source updated → flag citing modules" workflow. Phase 4 does not write this column.
2. **`sources`** gains the rich-Source fields the Phase 1 stub schema omitted: `author TEXT`, `cluster TEXT`, `thesis TEXT`, `mechanism TEXT`, `quotes_json TEXT NOT NULL DEFAULT '[]'`, `grounds_json TEXT NOT NULL DEFAULT '[]'`. The locked `StoredSource = Source` type contract (Task 1) requires the SQLite row to reconstitute every Source field; serializing `quotes`/`grounds` as JSON columns is the simplest faithful mirror.

```sql
-- 002_sources_meta.sql
ALTER TABLE module_sources ADD COLUMN stale_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_module_sources_stale ON module_sources(stale_at);

ALTER TABLE sources ADD COLUMN author TEXT;
ALTER TABLE sources ADD COLUMN cluster TEXT;
ALTER TABLE sources ADD COLUMN thesis TEXT;
ALTER TABLE sources ADD COLUMN mechanism TEXT;
ALTER TABLE sources ADD COLUMN quotes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sources ADD COLUMN grounds_json TEXT NOT NULL DEFAULT '[]';
```

(SQLite-compatible: one ALTER per statement; defaults are constants.)

- [ ] **Step 1: Write the failing test**

Cover:
1. After `runMigrations`, the `module_sources` table has a `stale_at` column (introspect via `PRAGMA table_info(module_sources)`).
2. After `runMigrations`, the `sources` table has `author`, `cluster`, `thesis`, `mechanism`, `quotes_json`, `grounds_json` columns (same PRAGMA check).
3. `runMigrations` is idempotent: calling it twice does not error and does not re-apply.

- [ ] **Step 2: Run tests to verify fail.**

- [ ] **Step 3: Implement** — drop the SQL file. Confirm `db.ts`'s migration loader picks up everything in `migrations/` lexicographically (it already does for `001_initial.sql`; the same enumeration handles `002`). If the loader hard-codes filenames, update it to read the directory.

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/migrations/002_sources_meta.sql src/lib/cms/__tests__/migrations.002.test.ts
# (and src/lib/cms/db.ts if the loader needed an update)
git commit -m "feat(cms): migration 002 — stale_at on module_sources (Phase 4 task 6)"
```

---

## Task 7: Indexer — `writeSources` + extend `writeModule` to populate `module_sources`

**Files:**
- Modify: `src/lib/cms/indexer.ts`
- Test: `src/lib/cms/__tests__/indexer.sources.test.ts`

Implement the `case 'source':` branch in `indexEntity` (currently throws via the default case). Behavior: read `_sources.json` as raw bytes (already done by the caller via `pathFor` + `fs.readFile`), `JSON.parse` it, then in one transaction:
- Upsert each `Source` into the `sources` table (`INSERT ... ON CONFLICT(id) DO UPDATE SET …`).
- Delete `sources` rows whose `id` no longer appears in the JSON (the JSON is authoritative).
- Update the matching `index_rows` row.

Also extend `writeModule` so that, after the existing per-module rows land, it (re)populates `module_sources` for that module: `DELETE FROM module_sources WHERE module_id = ?` then `INSERT` one row per `Module.primarySources[]` entry. (When `sources` doesn't yet have the referenced id, the FK fires — wrap in a `try/catch` and log a warning; do not fail the module write. Tests below assert this.)

- [ ] **Step 1: Write the failing tests**

Cover:
1. With a `_sources.json` on disk and `indexEntity(db, dir, 'source', '_sources')` invoked: every Source ends up as a row in `sources` (id, kind, title, url, summary all match).
2. A second call after editing one Source's title updates that row in place; row count is unchanged.
3. Removing a Source from the JSON drops it from `sources` on the next index.
4. After `indexSources` + `indexModule('B02')` (where B02's frontmatter `primary_sources: ["S1","S2"]`): `module_sources` has exactly two rows `(B02,S1)` and `(B02,S2)`.
5. `indexModule` of a module whose `primarySources` references a not-yet-indexed source id logs a warning but does not throw, and the row is simply absent.

For (4)+(5), use a fresh `:memory:` db with `runMigrations` + a minimal handful of fixtures (a 2-source `_sources.json` + a tiny module .md whose frontmatter has `primary_sources: ["S1","S2"]`).

- [ ] **Step 2: Run tests to verify fail.**

- [ ] **Step 3: Implement** — replace the default-throw with a call to the new `writeSources(db, raw, hash, mtimeMs)` helper. Extend `writeModule` to do the `DELETE` + per-id `INSERT OR IGNORE` for `module_sources`. Use the existing transaction pattern (whole indexEntity is already wrapped per Phase 1 — confirm by reading the surrounding code).

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/indexer.ts src/lib/cms/__tests__/indexer.sources.test.ts
git commit -m "feat(cms): indexer writes sources table + module_sources links (Phase 4 task 7)"
```

---

## Task 8: CMS read API — replace `getSources()` stub + add `getSourceById` / `getSourcesForModule`

**Files:**
- Modify: `src/lib/cms/index.ts`
- Test: `src/lib/cms/__tests__/index.sources.test.ts`

Replace the existing `getSources()` stub (currently returns rows from a guaranteed-empty table with a "Phase 4 will populate" comment) with a real read. Add `getSourceById(id)` and `getSourcesForModule(moduleId)`. Extend the `CmsIndex` interface to expose all three.

```ts
// New surface area on CmsIndex
getSources(): Source[];
getSourceById(id: string): Source | undefined;
getSourcesForModule(moduleId: string): Source[];
```

The read maps SQLite rows → `Source` objects. SourceKind is the column value (cast).

- [ ] **Step 1: Write the failing tests**

Cover:
1. `getSources()` returns every Source in the table, ordered by insertion order (use a separate `seq` column if needed — else `ORDER BY id` is acceptable; pick one and document).
2. `getSourceById('S1')` returns S1; for an unknown id returns `undefined`.
3. `getSourcesForModule('B02')` returns exactly the sources joined via `module_sources` for B02.

- [ ] **Step 2: Run tests to verify fail.**

- [ ] **Step 3: Implement** — straight SQL: a `SELECT *` for the list; a parameterized `SELECT … WHERE id = ?` for the by-id; a `INNER JOIN module_sources` for the per-module read. Map each row → `Source`. Keep all three on the `CmsIndex` interface; update `SourceRowsAsRendered` to the proper `Source` shape (the stub used an ad-hoc subset).

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/index.ts src/lib/cms/__tests__/index.sources.test.ts
git commit -m "feat(cms): real getSources/getSourceById/getSourcesForModule read API (Phase 4 task 8)"
```

---

## Task 9: Wire `ensureSourcesJson` into the CMS bootstrap

**Files:**
- Modify: `src/lib/cms/index.ts`
- Test: extend `src/lib/cms/__tests__/index.sources.test.ts` with a bootstrap scenario

In the `getCmsIndex(dir)` factory (or whichever function constructs the `Singleton` on first call), invoke `ensureSourcesJson(dir, fs)` before the first `lazyRefresh`. This guarantees that on cold boot, a curriculum dir that has `_sources.md` but no `_sources.json` gets migrated, and then the indexer has a JSON to read.

- [ ] **Step 1: Write the failing test**

Cover: a fresh CMS over a curriculum dir containing `_sources.md` (only) → after `await getCmsIndex(dir)`, `_sources.json` exists with the migrated content; `getSources()` returns the migrated list.

- [ ] **Step 2: Run test to verify fail.**

- [ ] **Step 3: Implement** — add the `await ensureSourcesJson(dir, fs)` call in the bootstrap path. It's a one-time cost on first construction. Wrap in try/catch + log on failure so a broken `_sources.md` doesn't take the entire CMS down (returns `{migrated: false}` semantically: the indexer will then read no JSON and `getSources()` returns []).

- [ ] **Step 4: Run test to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/index.ts src/lib/cms/__tests__/index.sources.test.ts
git commit -m "feat(cms): bootstrap calls ensureSourcesJson on first index (Phase 4 task 9)"
```

---

## Task 10: `/api/source/apply` — write Source entity + re-render mirror after applyCandidate

**Files:**
- Modify: `app/api/source/apply/route.ts`
- Modify: `src/lib/source/api-client.ts` (extend the client helper to forward source metadata)
- Test: `src/lib/source/__tests__/apply.sources.test.ts` (or extend an existing apply test)

Extend the POST body:
```ts
type ApplyBody = {
  candidate: Candidate;
  moduleFileName?: string;
  source?: {
    kind: 'url' | 'transcript';
    url?: string;                 // required when kind === 'url'
    title?: string;               // optional; defaults to the URL host + path, or "Transcript: <YYYY-MM-DD>"
    text: string;                 // the fetched body or pasted transcript
  };
};
```

After a successful `applyCandidate(dir, candidate, fileName)`:

1. If `source` is present: derive an existing `Source.id` to update (match by `url` for URL-kind; else mint a new `src_<8-hex>` id). Build a `Source` object with `kind`, `title`, `url?`, `raw_text: source.text`, `fetched_at: Date.now()`, and re-`computeContentHash`. Use `loadSourcesJson(dir)`, upsert by id (replace or append), and `writeSourcesJson(dir, …)`.
2. Render the `.md` mirror: `await writeFile(<dir>/_sources.md, renderSourcesMd(doc))` — atomic temp+rename (cribbed from the existing helper used by Task 2). The watcher will pick this up as a no-op (content equals what's already there in steady state); the chokidar `awaitWriteFinish` + content-hash short-circuit (`indexEntity` early-returns on hash match) absorbs the loop.
3. Call `reindexAffected(dir, 'source', '_sources')`.
4. Wrap steps 1–3 in `try/catch`; on failure, log a warning but **do not** fail the request — the module + pool already landed and that's the user's expected outcome.

The client helper at `src/lib/source/api-client.ts` (the `applyCandidate` wrapper) gains an optional `source` parameter forwarded into the POST body. Existing callers that don't pass it (legacy) keep working.

- [ ] **Step 1: Write the failing tests**

Cover (use a stub fs so the test exercises the route handler logic without real disk):
1. POST with `source: {kind:'url', url:'…', text:'…'}` → after the call, `_sources.json` on disk has a Source with that URL + a fresh `src_…` id (or an existing id if the URL matched).
2. POST with `source: {kind:'transcript', text:'…'}` → Source has `kind:'transcript'`, no `url`, `raw_text` populated.
3. POST without `source` (legacy) → `_sources.json` unchanged.
4. If the Source write throws (stub `writeSourcesJson` to reject) the route still returns `200 OK` with `written`.
5. The route calls `reindexAffected(dir, 'source', '_sources')` exactly once when `source` is present (assert via a spy).

- [ ] **Step 2: Run tests to verify fail.**

- [ ] **Step 3: Implement the route changes + the client helper extension.**

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add app/api/source/apply/route.ts src/lib/source/api-client.ts src/lib/source/__tests__/apply.sources.test.ts
git commit -m "feat(api): /source/apply writes Source entity + renders _sources.md mirror (Phase 4 task 10)"
```

---

## Task 11: Gate run — all tests, typecheck, lint, build

**Files:** none modified — verification only.

- [ ] **Step 1: Full test sweep**

Run: `npm test`
Expected: PASS for all tests (the Phase 1–3 baseline of 559 + every new Phase 4 test).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: PASS; `/api/source/apply` route still appears; no new routes expected in Phase 4.

- [ ] **Step 5: Manual smoke (record what was observed)**

Start dev (`npm run dev`), open the app, hit `/source`, paste a known URL or transcript, accept the diff, then:
- Confirm `<CURRICULUM_DIR>/_sources.json` exists and contains the expected entry.
- Confirm `<CURRICULUM_DIR>/_sources.md` was re-rendered (mtime updated; spot-check it still reads well).
- Confirm the learner UI continues to work (sidebar still loads, journey map renders, picking a module still works).

If anything in 1–4 fails, fix in place and re-run; do not commit a yellow gate.

---

## Self-Review

Spec coverage check, against the master plan's Phase 4 bullets:

| Master-plan requirement | Task |
| --- | --- |
| `src/lib/cms/sources/sources.ts` — Source CRUD over SQLite + `_sources.json` | Tasks 2 + 7 + 8 (split: JSON SoT in Task 2, SQLite write in Task 7, read API in Task 8) |
| `src/lib/cms/render-sources-md.ts` — pure renderer | Task 3 |
| `src/lib/cms/migrate-sources.ts` — one-time migration; preserves `S1`–`S9d` | Tasks 4 + 5 |
| `src/lib/types.ts` — add `Source`; extend `MCQQuestion` with `source_id?` | Task 1 |
| `app/api/source/apply/route.ts` — after `applyCandidate`, write Source entity + re-render `.md` + reindex | Task 10 |
| `_sources.md` re-renders deterministically | Task 3 (idempotency test) |
| Schema migration: `stale_at` on `module_sources` | Task 6 |
| Bootstrap migration runner | Task 9 |
| All existing tests stay green | Task 11 |

Out of scope (deferred to Phase 4.5 / 5):
- MCQ pool generation prompt asking the LLM to fill `source_id` strictly — Phase 4 keeps `sourceRef` as the working link.
- Studio UI for managing sources — Phase 5.
- Watcher: no contract change required (`_sources.json` already classified; the new `writeSources` indexer branch is what the existing watcher invokes).

**Placeholder scan:** Spot-checked — no TBD/TODO/"add validation"/"similar to Task N" residues. All code-bearing steps either show the code or reference an existing helper by file path.

**Type consistency:** `Source` field names and `MCQQuestion.source_id` match across Tasks 1, 2, 7, 8, 10. `SourcesDoc.version === 1` literal is consistent. `ensureSourcesJson` return shape `{migrated: boolean}` is consistent across Tasks 5 and 9.

**Risk register:**
- *Migration heuristic fidelity (Task 4)* — the existing `_sources.md` is hand-authored; the parser may miss stylistic details. Mitigation: the fixture-driven test asserts the structured fields (id, url, title, summary, thesis, mechanism, quotes, grounds, cluster); prose-only context is acceptable to lose because it lives in `summary`/`thesis`/`mechanism` already.
- *Watcher render-cycle (Task 10)* — the apply route writes `_sources.json` → watcher fires → reindex → `writeSources` is idempotent and short-circuits on equal `content_hash`. Then the route also writes `_sources.md` → watcher sees a `.md` change → `classifyPath` does NOT route `_sources.md` (only `_sources.json` and module/pool/state files are classified per the Phase 3 implementation), so the `.md` write is a quiet no-op. Confirm by reading `classifyPath` before implementing Task 10 — if `_sources.md` IS classified, the route must suppress its watcher echo (e.g. by detecting equal pre/post bytes and skipping the write).
- *sourceRef → source_id resolution (Phase 4.5 / 5 follow-up)* — Phase 4 carries `source_id?` as an additive field on `MCQQuestion` but does not yet auto-populate it on apply. The legacy `sourceRef` continues to work; Phase 5's Studio editors will populate `source_id` going forward.
