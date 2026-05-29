// app/api/studio/source/route.ts
// POST → create a new Source.
// Authorization is enforced upstream by middleware.ts; this route does not
// re-check the token.
import 'server-only';
import { NextResponse } from 'next/server';
import { addSource } from '@/lib/cms/sources/store';

export const dynamic = 'force-dynamic';

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

  const { kind, title } = (body ?? {}) as Record<string, unknown>;
  if (!kind || !title) {
    return NextResponse.json({ error: 'kind and title are required' }, { status: 400 });
  }

  const dir = getCurriculumDir();
  try {
    const result = await addSource(dir, body as Parameters<typeof addSource>[1]);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
