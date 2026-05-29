// app/api/studio/source/[id]/route.ts
// GET / PUT / DELETE for a single Source by id.
// Authorization is enforced upstream by middleware.ts; this route does not
// re-check the token.
import 'server-only';
import { NextResponse } from 'next/server';
import { getSourceById, updateSource, deleteSource } from '@/lib/cms/sources/store';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const source = await getSourceById(dir, id);
  if (!source) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, source });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dir = getCurriculumDir();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await updateSource(dir, id, body as Parameters<typeof updateSource>[2]);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.toLowerCase().includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const result = await deleteSource(dir, id);
  return NextResponse.json({ ok: true, ...result });
}
