// app/api/studio/cascade/clear-stale/route.ts
// POST → clear the stale_at flag on a single (moduleId, sourceId) link row.
// Authorization is enforced upstream by middleware.ts; this route does not
// re-check the token. Path-traversal hardening: ID_RE rejects anything that
// isn't a normal id (alphanumeric + dot/underscore/dash, <= 32 chars).
import 'server-only';
import { NextResponse } from 'next/server';
import { getCmsIndex } from '@/lib/cms';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { moduleId, sourceId } = (body ?? {}) as Record<string, unknown>;
  if (typeof moduleId !== 'string' || typeof sourceId !== 'string') {
    return NextResponse.json(
      { error: 'body.moduleId (string) and body.sourceId (string) are required' },
      { status: 400 },
    );
  }
  if (!ID_RE.test(moduleId) || !ID_RE.test(sourceId)) {
    return NextResponse.json(
      { error: 'moduleId and sourceId must match /^[A-Za-z0-9._-]{1,32}$/' },
      { status: 400 },
    );
  }

  const dir = getCurriculumDir();
  try {
    const cms = await getCmsIndex(dir);
    cms.clearStaleFlag(moduleId, sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
