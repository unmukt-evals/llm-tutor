# CMS Phase 5a — Studio shell + Sources CRUD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Studio surface — a separate authoring shell at `/studio/*`, distinct from the learner `(shell)` — and ship the first CRUD vertical: Sources. By the end of 5a, you can list every Source, click into one, edit its fields, delete it, and add a new one — all via a real UI backed by structured writes through `_sources.json` (the canonical SoT) with the indexer + `.md` mirror re-rendering automatically.

**Architecture:** Studio is server-rendered Next 15 App Router pages reading via `getCmsIndex(dir)` (Phase 4 read API). Mutations go through `/api/studio/source/*` REST routes. Routes call a new server-only CRUD helper (`src/lib/cms/sources/store.ts`) that wraps `loadSourcesJson` + `writeSourcesJson` with `addSource`/`updateSource`/`deleteSource` + re-renders the `.md` mirror + calls `reindexAffected(dir, 'source', '_sources')`. Optional `LLMTUTOR_STUDIO_TOKEN` env-var gate (open by default). Studio shell is plain Tailwind (no extra deps); a small `SourceEditClient.tsx` handles form state + the PUT/DELETE fetches.

**Tech Stack:** Next 15 App Router · TypeScript strict · Tailwind v3 · Vitest (node) · existing `getCmsIndex` + `loadSourcesJson`/`writeSourcesJson`/`renderSourcesMd` + `reindexAffected`.

---

## File Structure

**Create:**
- `src/lib/cms/sources/store.ts` — server-only CRUD over the Source entity. Five exports: `addSource`, `updateSource`, `deleteSource`, `listSources`, `getSourceById` (the last two are thin facades over the existing CmsIndex reads, kept here so all Source ops live in one module).
- `src/lib/cms/sources/__tests__/store.test.ts`
- `app/api/studio/source/route.ts` — POST (create new Source).
- `app/api/studio/source/[id]/route.ts` — GET / PUT / DELETE for one Source.
- `app/api/studio/source/__tests__/route.test.ts`
- `app/studio/layout.tsx` — Studio shell (distinct header + nav from `(shell)`). Optional `LLMTUTOR_STUDIO_TOKEN` gate.
- `app/studio/page.tsx` — dashboard (Studio landing — minimal in 5a: source count, links into Sources/Modules/Pools/Drafts surfaces).
- `app/studio/sources/page.tsx` — list view.
- `app/studio/sources/[id]/page.tsx` — detail/edit view (server component that loads the Source + citing modules + renders `SourceEditClient`).
- `app/studio/sources/new/page.tsx` — empty form for creating a new Source.
- `src/components/studio/SourceEditClient.tsx` — client component: controlled form, calls PUT (or POST for new), then `router.refresh()`.
- `src/components/studio/StudioNav.tsx` — top nav: Dashboard · Sources · (Modules · Pools · Drafts · Cards stubs for 5b/5c).
- `middleware.ts` (root-level) — the `LLMTUTOR_STUDIO_TOKEN` gate. Matches `/studio/:path*` + `/api/studio/:path*`. If env var is set, requires `Authorization: Bearer <token>` (or `?token=…` for browser convenience). If not set, open.

**Modify:**
- `src/lib/cms/index.ts` — add `getModulesForSource(sourceId): Array<{ id: string; name: string }>` to the CmsIndex read API (for the Source detail page to show citing modules).

**Not changed (5b / 5c):**
- The learner `(shell)` routes.
- `app/(shell)/source/page.tsx` (the existing draft flow) — absorbed in 5c.
- Modules / Pools / Drafts / Cards Studio surfaces — those are 5b and 5c.

---

## Type contracts (locked)

```ts
// src/lib/cms/sources/store.ts (public API)
export interface AddSourceInput {
  kind: 'url' | 'transcript' | 'doc' | 'paper';
  title: string;
  url?: string;
  author?: string;
  cluster?: string;
  summary?: string;
  thesis?: string;
  mechanism?: string;
  quotes?: string[];
  grounds?: string[];
  raw_text?: string;
}

export interface UpdateSourceInput extends Partial<AddSourceInput> {
  /** Optional: change the id. Phase 5a doesn't expose this — id is immutable through the Studio. */
}

export interface CrudResult {
  id: string;
  content_hash: string;
}

export async function addSource(dir: string, input: AddSourceInput): Promise<CrudResult>;
export async function updateSource(dir: string, id: string, patch: UpdateSourceInput): Promise<CrudResult>;
export async function deleteSource(dir: string, id: string): Promise<{ deleted: boolean }>;
export async function listSources(dir: string): Promise<Source[]>;          // thin facade over getCmsIndex
export async function getSourceById(dir: string, id: string): Promise<Source | undefined>;
```

**ID minting for new Sources** (mirrors `/api/source/apply` from Phase 4): `src_<8-hex>` from `computeSourceHash` over a minimal canonical view of the input. URL-kind sources that collide on existing `url` are rejected with a clear error — the Studio is for editing existing or transcript/doc/paper sources; URL re-fetches happen through `/source apply`.

**After every mutation:** the helper (a) calls `writeSourcesJson` (atomic temp+rename, validates duplicates, fills `content_hash` + `updated_at`), (b) renders + atomic-writes `_sources.md` (skip-if-byte-identical, same recipe as Phase 4 Task 10's `apply-source.ts`), (c) calls `reindexAffected(dir, 'source', '_sources')`. All three failures are best-effort with `console.warn` — the JSON write is the SoT; mirror + reindex failures don't roll back the JSON (the watcher will re-converge on the next mtime tick).

---

## Task 1: CmsIndex.getModulesForSource(sourceId)

**Files:**
- Modify: `src/lib/cms/index.ts`
- Test: `src/lib/cms/__tests__/index.sources.test.ts` (extend)

The Source detail page needs to show "this source is cited by N modules: B01, B02, …". The existing `getSourcesForModule(moduleId)` covers one direction; we need its inverse.

- [ ] **Step 1: Add to the `CmsIndex` interface** immediately after `getSourcesForModule`:

```ts
getModulesForSource(sourceId: string): Array<{ id: string; name: string }>;
```

- [ ] **Step 2: Write the failing test** in `src/lib/cms/__tests__/index.sources.test.ts`:

```ts
it('getModulesForSource returns the modules that cite a source', async () => {
  // arrange: a curriculum dir with _sources.json (S1, S2) + a module B02 whose primary_sources are [S1, S2]
  // act: const mods = cms.getModulesForSource('S1');
  // assert: mods has exactly { id: 'B02', name: '<B02 name>' }
});

it('getModulesForSource returns an empty array for an unknown source id', async () => {
  // act: cms.getModulesForSource('does-not-exist') → []
});
```

- [ ] **Step 3: Run the new tests — expect FAIL** (method not on interface).

- [ ] **Step 4: Implement** in `src/lib/cms/index.ts`:

```ts
getModulesForSource(sourceId: string): Array<{ id: string; name: string }> {
  const rows = s.db
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
```

- [ ] **Step 5: Run tests — expect PASS.** Full suite: 638 → 640.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cms/index.ts src/lib/cms/__tests__/index.sources.test.ts
git commit -m "feat(cms): add getModulesForSource read API (Phase 5a task 1)"
```

---

## Task 2: Source CRUD helper (`store.ts`)

**Files:**
- Create: `src/lib/cms/sources/store.ts`
- Test: `src/lib/cms/sources/__tests__/store.test.ts`

The server-only CRUD layer the API routes consume. Encapsulates the post-mutation pipeline (writeSourcesJson → render-md → reindex) so the routes are thin.

- [ ] **Step 1: Write the failing tests** covering:

1. `addSource` with `kind: 'doc'` → mints `src_<8hex>` id; returns `{id, content_hash}`; `_sources.json` on disk now contains the new Source; `_sources.md` re-rendered; reindexAffected called once with `('source', '_sources')`.
2. `addSource` with `kind: 'url'` whose `url` already exists in the doc → throws an error with a clear message (`already exists with id S1`); doc unchanged.
3. `updateSource` with a known id + partial patch → merges patch into the existing Source (preserving all unchanged fields), bumps `content_hash` + `updated_at`, writes through.
4. `updateSource` with an unknown id → throws `not found: <id>`.
5. `deleteSource` with a known id → removes it from `doc.sources`, returns `{deleted: true}`, JSON + md mirror reflect; reindexAffected called (cascades drop `module_sources` rows via the FK).
6. `deleteSource` with an unknown id → returns `{deleted: false}`, no write, no reindex.
7. Each successful mutation atomically writes JSON (via the existing `writeSourcesJson`) and best-effort writes the .md mirror + best-effort reindex (mirror or reindex failure does NOT roll back the JSON; mirrored from Task 10's `apply-source.ts` pattern).
8. `listSources(dir)` and `getSourceById(dir, id)` are thin reads — verified to delegate to `getCmsIndex` (or read JSON directly — pick one and document).

For testing the reindex hook, stub `reindexAffected` via `vi.mock('@/lib/cms/reindex', ...)` or pass a `{ reindex?: ReindexFn }` injection point in the helper signature. Recommended: injection point — keeps the helper pure-by-default for unit tests, and the API routes pass the real `reindexAffected`. (Match how `apply-source.ts` handled it; if it didn't take an injection point, default to `vi.mock`.)

- [ ] **Step 2: Run tests — expect FAIL.**

- [ ] **Step 3: Implement `store.ts`.**

Recipe for `addSource`:
```ts
const doc = await loadSourcesJson(dir);
if (input.kind === 'url' && input.url) {
  const existing = doc.sources.find((s) => s.url === input.url);
  if (existing) throw new Error(`Source with url "${input.url}" already exists with id ${existing.id}`);
}
const now = Date.now();
const partial: Partial<Source> = { ...input };
const id = `src_${computeSourceHash(partial).slice(0, 8)}`;
const source: Source = {
  id,
  kind: input.kind,
  title: input.title,
  url: input.url,
  author: input.author,
  cluster: input.cluster,
  summary: input.summary,
  thesis: input.thesis,
  mechanism: input.mechanism,
  quotes: input.quotes ?? [],
  grounds: input.grounds ?? [],
  raw_text: input.raw_text ?? '',
  fetched_at: input.kind === 'url' ? now : undefined,
  content_hash: computeSourceHash({ ...partial, raw_text: input.raw_text ?? '', fetched_at: input.kind === 'url' ? now : undefined }),
  updated_at: now,
};
doc.sources.push(source);
await writeSourcesJson(dir, doc);
await writeMdMirror(dir, doc);    // local helper that imports renderSourcesMd + the temp+rename recipe
await reindex(dir);
return { id, content_hash: source.content_hash };
```

Recipe for `updateSource`:
```ts
const doc = await loadSourcesJson(dir);
const idx = doc.sources.findIndex((s) => s.id === id);
if (idx < 0) throw new Error(`Source not found: ${id}`);
const merged: Source = { ...doc.sources[idx], ...patch };
const now = Date.now();
merged.content_hash = computeSourceHash(merged);  // recompute
merged.updated_at = now;
doc.sources[idx] = merged;
await writeSourcesJson(dir, doc);
await writeMdMirror(dir, doc);
await reindex(dir);
return { id, content_hash: merged.content_hash };
```

Recipe for `deleteSource`:
```ts
const doc = await loadSourcesJson(dir);
const idx = doc.sources.findIndex((s) => s.id === id);
if (idx < 0) return { deleted: false };
doc.sources.splice(idx, 1);
await writeSourcesJson(dir, doc);
await writeMdMirror(dir, doc);
await reindex(dir);
return { deleted: true };
```

The `writeMdMirror` helper: copy the temp+rename + skip-on-identical pattern from `src/lib/source/apply-source.ts`. (Don't import its private helper — copy the recipe verbatim; it's 15 lines. If you'd rather refactor and extract it to `src/lib/cms/sources/write-md-mirror.ts`, do that here and update both call sites — but only if the diff stays small.)

- [ ] **Step 4: Run tests — expect PASS.** Full suite: 640 → 648.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cms/sources/store.ts src/lib/cms/sources/__tests__/store.test.ts
# include write-md-mirror.ts + the apply-source.ts edit if you extracted
git commit -m "feat(cms): Source CRUD helper (add/update/delete) (Phase 5a task 2)"
```

---

## Task 3: `/api/studio/source` + `/api/studio/source/[id]` routes

**Files:**
- Create: `app/api/studio/source/route.ts` (POST = create)
- Create: `app/api/studio/source/[id]/route.ts` (GET / PUT / DELETE)
- Test: `app/api/studio/source/__tests__/route.test.ts`

REST surface over `store.ts`. Routes are thin: validate body shape, call helper, return JSON. Authorization is enforced upstream by `middleware.ts` (Task 7); routes don't re-check the token.

- [ ] **Step 1: Write the failing tests** for the 4 verbs:

1. `POST /api/studio/source` with a valid body → returns `{ ok: true, id, content_hash }`. On `addSource` throw (e.g. duplicate URL) → 409 with `{ error: "..." }`.
2. `POST /api/studio/source` with a bad body (missing `kind` or `title`) → 400.
3. `GET /api/studio/source/[id]` for a known id → returns `{ ok: true, source: Source }`. Unknown → 404.
4. `PUT /api/studio/source/[id]` with a patch → returns `{ ok: true, id, content_hash }`. Unknown id → 404.
5. `DELETE /api/studio/source/[id]` for a known id → returns `{ ok: true, deleted: true }`. Unknown → returns `{ ok: true, deleted: false }` (idempotent delete; matches `deleteSource` semantics).

Use a tmpdir + a stubbed `CURRICULUM_DIR` env. Match the pattern from `app/api/source/apply/__tests__/apply.sources.test.ts`.

- [ ] **Step 2: Run tests — expect FAIL.**

- [ ] **Step 3: Implement the routes.**

`app/api/studio/source/route.ts`:
```ts
import 'server-only';
import { NextResponse } from 'next/server';
import { addSource } from '@/lib/cms/sources/store';

export async function POST(req: Request) {
  const dir = getCurriculumDir();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const { kind, title } = body ?? {};
  if (!kind || !title) return NextResponse.json({ error: 'kind and title are required' }, { status: 400 });
  try {
    const result = await addSource(dir, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    const status = msg.includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
```

`app/api/studio/source/[id]/route.ts`:
```ts
import 'server-only';
import { NextResponse } from 'next/server';
import { updateSource, deleteSource, getSourceById } from '@/lib/cms/sources/store';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const source = await getSourceById(dir, id);
  if (!source) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, source });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = getCurriculumDir();
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  try {
    const result = await updateSource(dir, id, body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    const status = msg.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const result = await deleteSource(dir, id);
  return NextResponse.json({ ok: true, ...result });
}
```

(Match the existing `getCurriculumDir()` helper signature — define it locally per route file, like `apply/route.ts` does.)

- [ ] **Step 4: Run tests — expect PASS.** Full suite: 648 → 656.

- [ ] **Step 5: Commit**

```bash
git add app/api/studio/source/route.ts app/api/studio/source/\[id\]/route.ts app/api/studio/source/__tests__/route.test.ts
git commit -m "feat(api): Studio Source CRUD routes (Phase 5a task 3)"
```

---

## Task 4: Studio shell layout + dashboard

**Files:**
- Create: `app/studio/layout.tsx`
- Create: `app/studio/page.tsx`
- Create: `src/components/studio/StudioNav.tsx`

Studio's own shell — distinct from `(shell)`. Plain Tailwind. Minimal in 5a; expanded in 5b/5c.

- [ ] **Step 1: Implement `StudioNav.tsx`** (a server component is fine — no interactivity beyond `<Link>`s):

```tsx
import Link from 'next/link';

export function StudioNav() {
  return (
    <nav className="flex items-center gap-4 border-b border-neutral-800 bg-neutral-950 px-6 py-3 text-sm text-neutral-300">
      <Link href="/studio" className="font-semibold text-white">Studio</Link>
      <Link href="/studio/sources" className="hover:text-white">Sources</Link>
      <span className="text-neutral-600">Modules (5b)</span>
      <span className="text-neutral-600">Pools (5b)</span>
      <span className="text-neutral-600">Drafts (5c)</span>
      <span className="text-neutral-600">Cards (5c)</span>
      <span className="ml-auto text-xs text-neutral-500">Studio · authoring</span>
    </nav>
  );
}
```

(The faded "5b"/"5c" placeholders make the partial state explicit.)

- [ ] **Step 2: Implement `app/studio/layout.tsx`**:

```tsx
import type { ReactNode } from 'react';
import { StudioNav } from '@/components/studio/StudioNav';

export const metadata = { title: 'LLM Tutor — Studio' };

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      <StudioNav />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Implement `app/studio/page.tsx`** (dashboard skeleton):

```tsx
import { getCmsIndex } from '@/lib/cms/index';
import Link from 'next/link';

function getCurriculumDir() {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set.');
  return dir;
}

export default async function StudioDashboardPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const sources = cms.getSources();
  const curriculum = cms.getCurriculum();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Studio</h1>
      <p className="text-sm text-neutral-400">Authoring surface for the LLM Tutor curriculum.</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <DashboardCard href="/studio/sources" label="Sources" count={sources.length} />
        <DashboardCard href="#" label="Modules" count={curriculum.modules.length} faded />
        <DashboardCard href="#" label="Pools" count={null} faded />
        <DashboardCard href="#" label="Drafts" count={null} faded />
      </div>
    </div>
  );
}

function DashboardCard({ href, label, count, faded = false }: { href: string; label: string; count: number | null; faded?: boolean }) {
  const content = (
    <div className={`rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 ${faded ? 'opacity-50' : 'hover:bg-neutral-800'}`}>
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{count ?? '—'}</div>
    </div>
  );
  return faded ? content : <Link href={href}>{content}</Link>;
}
```

- [ ] **Step 4: Manually verify the dashboard renders.** Add NO new tests for the dashboard (it's a thin server component; the CmsIndex reads are already tested). Run `npm run build` to confirm the new route compiles.

- [ ] **Step 5: Commit**

```bash
git add app/studio/layout.tsx app/studio/page.tsx src/components/studio/StudioNav.tsx
git commit -m "feat(studio): shell layout + dashboard skeleton (Phase 5a task 4)"
```

---

## Task 5: Sources list page

**Files:**
- Create: `app/studio/sources/page.tsx`

- [ ] **Step 1: Implement the list page** as a server component reading via `cms.getSources()` + `cms.getModulesForSource(id).length` for the per-source citation count:

```tsx
import { getCmsIndex } from '@/lib/cms/index';
import Link from 'next/link';

function getCurriculumDir() { /* ... same as dashboard ... */ }

export default async function SourcesListPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const sources = cms.getSources();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sources ({sources.length})</h1>
        <Link href="/studio/sources/new" className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500">
          + Add source
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-700">
        <table className="w-full text-sm">
          <thead className="bg-neutral-800/50 text-left text-xs uppercase text-neutral-400">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Cluster</th>
              <th className="px-3 py-2">Cited by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {sources.map((s) => {
              const citing = cms.getModulesForSource(s.id);
              return (
                <tr key={s.id} className="hover:bg-neutral-800/40">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/studio/sources/${s.id}`} className="text-emerald-400 hover:underline">{s.id}</Link>
                  </td>
                  <td className="px-3 py-2">{s.title}</td>
                  <td className="px-3 py-2 text-neutral-400">{s.kind}</td>
                  <td className="px-3 py-2 text-neutral-400">{s.cluster ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-400">{citing.length > 0 ? citing.map((m) => m.id).join(', ') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page compiles** (`npm run build`).

- [ ] **Step 3: Commit**

```bash
git add app/studio/sources/page.tsx
git commit -m "feat(studio): Sources list page (Phase 5a task 5)"
```

---

## Task 6: Source detail/edit page + new-source page + `SourceEditClient`

**Files:**
- Create: `app/studio/sources/[id]/page.tsx`
- Create: `app/studio/sources/new/page.tsx`
- Create: `src/components/studio/SourceEditClient.tsx`

`SourceEditClient` is a client component that owns form state + fires PUT/POST/DELETE fetches. The detail page server-loads the Source + the citing modules, then renders the client with hydrated initial state. The `/new` page renders the client with empty initial state in "create" mode.

- [ ] **Step 1: Implement `SourceEditClient.tsx`**:

```tsx
'use client';

import type { Source } from '@/lib/types';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** Existing source for edit mode; undefined for create mode. */
  source?: Source;
  /** Module ids that cite this source — read-only display. Empty for create mode. */
  citingModules?: Array<{ id: string; name: string }>;
}

interface FormState {
  id: string;             // read-only in edit; computed server-side in create
  kind: Source['kind'];
  title: string;
  url: string;
  author: string;
  cluster: string;
  summary: string;
  thesis: string;
  mechanism: string;
  quotes: string;          // newline-separated in the form
  grounds: string;         // comma-separated in the form
  raw_text: string;
}

function sourceToForm(s: Source | undefined): FormState {
  if (!s) return {
    id: '', kind: 'doc', title: '', url: '', author: '', cluster: '',
    summary: '', thesis: '', mechanism: '', quotes: '', grounds: '', raw_text: '',
  };
  return {
    id: s.id, kind: s.kind, title: s.title, url: s.url ?? '', author: s.author ?? '',
    cluster: s.cluster ?? '', summary: s.summary ?? '', thesis: s.thesis ?? '',
    mechanism: s.mechanism ?? '', quotes: (s.quotes ?? []).join('\n'),
    grounds: (s.grounds ?? []).join(', '), raw_text: s.raw_text ?? '',
  };
}

function formToBody(f: FormState): any {
  return {
    kind: f.kind, title: f.title,
    url: f.url || undefined, author: f.author || undefined,
    cluster: f.cluster || undefined, summary: f.summary || undefined,
    thesis: f.thesis || undefined, mechanism: f.mechanism || undefined,
    quotes: f.quotes.split('\n').map((q) => q.trim()).filter(Boolean),
    grounds: f.grounds.split(',').map((g) => g.trim()).filter(Boolean),
    raw_text: f.raw_text || undefined,
  };
}

export function SourceEditClient({ source, citingModules = [] }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => sourceToForm(source));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isCreate = !source;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const url = isCreate ? '/api/studio/source' : `/api/studio/source/${source!.id}`;
    const method = isCreate ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formToBody(form)),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    const j = await res.json();
    startTransition(() => {
      router.push(isCreate ? `/studio/sources/${j.id}` : `/studio/sources/${source!.id}`);
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!source) return;
    if (!confirm(`Delete source ${source.id}?`)) return;
    const res = await fetch(`/api/studio/source/${source.id}`, { method: 'DELETE' });
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    startTransition(() => { router.push('/studio/sources'); router.refresh(); });
  }

  // Form fields: id (read-only), kind (select), title, url, author, cluster,
  // summary (textarea), thesis (textarea), mechanism (textarea),
  // quotes (textarea — newline-separated), grounds (input — comma-separated),
  // raw_text (textarea).
  // Bottom row: Save button + Delete button (edit mode only). Show citingModules
  // as a read-only chip list when present.
  // — see component body below for the JSX. —
  return ( /* ... full form JSX ... */ );
}
```

Use standard Tailwind form patterns: `<input className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" />` etc. Group fields visually. Disable the Save button when `pending`.

- [ ] **Step 2: Implement `app/studio/sources/[id]/page.tsx`**:

```tsx
import { getCmsIndex } from '@/lib/cms/index';
import { notFound } from 'next/navigation';
import { SourceEditClient } from '@/components/studio/SourceEditClient';

function getCurriculumDir() { /* ... */ }

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const source = cms.getSourceById(id);
  if (!source) notFound();
  const citingModules = cms.getModulesForSource(id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit source · <span className="font-mono text-emerald-400">{source.id}</span></h1>
      <SourceEditClient source={source} citingModules={citingModules} />
    </div>
  );
}
```

- [ ] **Step 3: Implement `app/studio/sources/new/page.tsx`**:

```tsx
import { SourceEditClient } from '@/components/studio/SourceEditClient';

export default function NewSourcePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New source</h1>
      <SourceEditClient />
    </div>
  );
}
```

- [ ] **Step 4: Verify build.** `npm run build` should produce 14 routes total (the 12 from Phase 4 + Studio dashboard + Studio Sources tree).

- [ ] **Step 5: Commit**

```bash
git add app/studio/sources/\[id\]/page.tsx app/studio/sources/new/page.tsx src/components/studio/SourceEditClient.tsx
git commit -m "feat(studio): Source detail/edit page + new-source page + SourceEditClient (Phase 5a task 6)"
```

---

## Task 7: `LLMTUTOR_STUDIO_TOKEN` middleware gate (optional)

**Files:**
- Create: `middleware.ts` (at repo root, alongside `next.config.ts`)

When `LLMTUTOR_STUDIO_TOKEN` env is set: every request matching `/studio/:path*` OR `/api/studio/:path*` must present the token via either `Authorization: Bearer <token>` header OR `?token=<token>` query param (for browser-direct access). Mismatch → 401. When the env is unset: open (no check).

- [ ] **Step 1: Implement** `middleware.ts`:

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/studio/:path*', '/api/studio/:path*'],
};

export function middleware(req: NextRequest) {
  const expected = process.env.LLMTUTOR_STUDIO_TOKEN;
  if (!expected) return NextResponse.next();  // open

  const auth = req.headers.get('authorization');
  const headerToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get('token');
  const provided = headerToken ?? queryToken;

  if (provided && provided === expected) return NextResponse.next();
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
```

- [ ] **Step 2: Verify the build** still produces the Studio routes; middleware adds a small bundle but doesn't change routing.

- [ ] **Step 3: Manually smoke** (`npm run dev`):
  - With `LLMTUTOR_STUDIO_TOKEN` unset: `/studio` opens normally.
  - With `LLMTUTOR_STUDIO_TOKEN=abc npm run dev`: `/studio` returns 401 in JSON; `/studio?token=abc` opens.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts
git commit -m "feat(studio): optional LLMTUTOR_STUDIO_TOKEN middleware gate (Phase 5a task 7)"
```

---

## Task 8: Final gate — test + typecheck + lint + build + smoke

- [ ] **Step 1: Full test sweep** — `npm test`. Expect ≥656 (638 baseline + ~18 new across Tasks 1–3).

- [ ] **Step 2: Typecheck** — `npm run typecheck`.

- [ ] **Step 3: Lint** — `npm run lint`.

- [ ] **Step 4: Production build** — `npm run build`. Confirm:
  - New routes: `/studio`, `/studio/sources`, `/studio/sources/[id]`, `/studio/sources/new`.
  - New API routes: `/api/studio/source`, `/api/studio/source/[id]`.
  - Middleware compiles.

- [ ] **Step 5: Manual smoke** (dev). Start `npm run dev`. Walk through:
  1. Open `/studio` → dashboard shows source count.
  2. Click `Sources` → list of all 14 migrated sources.
  3. Click a source (e.g. S1) → edit form pre-filled.
  4. Change the title; Save. Reload. Title persisted.
  5. Confirm `<CURRICULUM_DIR>/_sources.json` reflects the change. Confirm `_sources.md` was re-rendered with the new title.
  6. Confirm the learner UI (sidebar / module pages) is unaffected.
  7. Click `+ Add source`. Add a `doc`-kind source with a synthetic title; Save. Verify it lands at the bottom of the list with a `src_<8hex>` id.
  8. Open the new source; Delete. Confirm it's gone from the list AND from the JSON AND from the `.md` mirror.
  9. Verify the learner UI for a module that cites the edited source still renders cleanly.

If any step fails, fix in place and re-run the gate. Do not commit a yellow gate.

---

## Self-Review

Spec coverage against the master plan's Phase 5 requirements (the slice covered by 5a):

| Requirement | Task |
| --- | --- |
| Studio shell + dashboard | Task 4 |
| Optional `LLMTUTOR_STUDIO_TOKEN` gate | Task 7 |
| `app/studio/sources/page.tsx` (list) | Task 5 |
| `app/studio/sources/[id]/page.tsx` (detail) | Task 6 |
| `app/studio/sources/new/page.tsx` (create) — implied | Task 6 |
| `app/api/studio/source/[id]/route.ts` (GET/PUT/DELETE) | Task 3 |
| `app/api/studio/source/route.ts` (POST = add new) | Task 3 |
| Reuse the atomic write + reindex pattern from Phase 4 | Task 2 |
| Re-render `.md` mirror on every change | Task 2 |
| Test+typecheck+lint+build green | Task 8 |

Out of scope (deferred to 5b / 5c):
- Modules / Pools / Drafts / Cards Studio surfaces (5b + 5c).
- The `/source` → `/studio/drafts/new` redirect (5c).
- Source re-fetch + stale flag (Phase 6).
- The MCQ pool generation prompt asking the LLM to fill `source_id` strictly (Phase 4.5 / 5b).

Risk register:
- *src_<8hex> id collision.* The 8-hex truncation of the SHA-256 gives ~2^-32 (~1 in 4 billion) per-pair collision probability. Accepted in 5a: single-writer, small corpus. Phase 5b can add a post-mint collision check if the corpus grows significantly.
- *Source.id change.* The Studio edit form does not expose `id` for change. URL-kind sources gain a `url` collision check on add; transcript/doc/paper get a fresh `src_<8hex>`. If the user manually edits `_sources.json` to rename an id, the indexer will drop the old id's `module_sources` rows and create new ones on next module reindex — minor friction, acceptable for 5a.
- *Concurrent edits.* Single-writer assumption holds (local-first). Two browser tabs editing the same Source: last write wins; no merge conflict detection. Phase 5b can add a content_hash check in the PUT route.
- *Form ergonomics.* `quotes`/`grounds`/`raw_text` use textarea-with-separator rather than tag inputs. Acceptable for 5a; richer editors land in 5b.
