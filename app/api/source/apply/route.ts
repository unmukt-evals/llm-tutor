// app/api/source/apply/route.ts
// POST { candidate, moduleFileName?, source? } → { ok: true, written }.
// Re-validates and atomically writes the module .md + mcq/<id>.json. Nothing is
// written unless the request reaches here (explicit accept on the client).
// When `source` is present, also upserts the Source entity into `_sources.json`,
// re-renders `_sources.md`, and reindexes — all wrapped in try/catch so a
// Source-write failure never fails the module+pool write. Server-only.
import { NextResponse } from 'next/server';
import { applyCandidate, moduleFileName as defaultModuleFileName } from '@/lib/source/apply';
import { applySourceToDir } from '@/lib/source/apply-source';
import type { SourceInput } from '@/lib/source/apply-source';
import { assertParsesAsModule } from '@/lib/llm/candidate';
import { reindexAffected } from '@/lib/cms/reindex';
import type { Candidate } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { candidate, moduleFileName, source } = (body ?? {}) as {
    candidate?: Candidate;
    moduleFileName?: unknown;
    source?: SourceInput;
  };
  if (!candidate || typeof candidate.markdown !== 'string' || typeof candidate.poolJson !== 'string') {
    return NextResponse.json({ error: 'Body must include a candidate' }, { status: 400 });
  }

  try {
    const dir = getCurriculumDir();
    // Resolve filename: prefer the existing file passed through; else derive a default.
    const mod = assertParsesAsModule(candidate.markdown);
    const fileName =
      typeof moduleFileName === 'string' && moduleFileName.length > 0
        ? moduleFileName
        : defaultModuleFileName(mod.id, mod.name);
    const written = await applyCandidate(dir, candidate, fileName);

    // Phase 3 — refresh the CMS mirror for the module + pool we just wrote so
    // subsequent reads (sidebar, module page, assess page) see the change
    // immediately without waiting for the next `lazyRefresh` mtime walk.
    // The file write already succeeded; a reindex failure here must NOT fail
    // the request — sidecar reconciliation on the next read is acceptable,
    // mirroring the Phase 2 `/api/state` pattern.
    try {
      await reindexAffected(dir, 'module', mod.id);
      await reindexAffected(dir, 'pool', mod.id);
    } catch (err) {
      console.warn(
        `[api/source/apply] reindex failed (write succeeded): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Phase 4 — upsert the Source entity into _sources.json, re-render
    // _sources.md, and reindex. Wrapped inside applySourceToDir which
    // swallows any error and logs a warning — the module + pool already
    // landed and that's the user's expected outcome.
    await applySourceToDir(dir, source ?? null);

    return NextResponse.json({ ok: true, written });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
