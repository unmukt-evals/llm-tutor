// app/api/cms/reindex/route.ts
// Phase 3 — dev / admin trigger for an explicit CMS reindex.
//
//   POST { kind: 'module'|'pool'|'flashcards'|'state'|'all', id?: string }
//     → { ok: true, indexed, skipped, errors? }
//
// Gating: `NODE_ENV !== 'production'` (returns 403 in production). Avoids
// introducing a second knob — the watcher uses the same gate, so the two
// dev-only surfaces stay aligned. Override with care via a deploy of a
// dev-mode build; we deliberately do NOT add an env-var bypass.
import { NextResponse } from 'next/server';
import { reindexAffected } from '@/lib/cms/reindex';
import type { EntityKind } from '@/lib/cms/types';

export const dynamic = 'force-dynamic';

const VALID_KINDS: Array<EntityKind | 'all'> = [
  'module',
  'pool',
  'flashcards',
  'state',
  'all',
];

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) {
    throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  }
  return dir;
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'reindex endpoint is disabled in production' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { kind, id } = (body ?? {}) as { kind?: unknown; id?: unknown };
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as EntityKind | 'all')) {
    return NextResponse.json(
      { error: `Body.kind must be one of ${VALID_KINDS.join(', ')}` },
      { status: 400 },
    );
  }
  if ((kind === 'module' || kind === 'pool') && typeof id !== 'string') {
    return NextResponse.json(
      { error: `Body.id is required when kind is "${kind}"` },
      { status: 400 },
    );
  }

  try {
    const dir = getCurriculumDir();
    const out = await reindexAffected(
      dir,
      kind as EntityKind | 'all',
      typeof id === 'string' ? id : undefined,
    );
    return NextResponse.json({ ok: true, result: out });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
