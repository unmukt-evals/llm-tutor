// app/api/studio/pool/[id]/route.ts
// Phase 5b — Studio MCQ Pool GET/PUT API.
//   GET → {poolJson, pool}; 404 on miss.
//   PUT → re-validate via validatePool, atomic-write via writePool, then
//         reindexEntity so subsequent reads see the change.
// Authorization is enforced upstream by middleware.ts.
import 'server-only';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCmsIndex } from '@/lib/cms';
import { writePool } from '@/lib/studio/write-pool';
import { assertSafePathComponent } from '@/lib/source/apply';

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
  try {
    assertSafePathComponent(id, 'id');
  } catch {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const pool = cms.getPool(id);
  if (!pool) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  // Read raw JSON so the editor sees exactly what's on disk (preserves any
  // formatting / order choices the author made).
  let poolJson: string;
  try {
    poolJson = await readFile(join(dir, 'mcq', `${id}.json`), 'utf8');
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, poolJson, pool });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const poolJson = (body as { poolJson?: unknown })?.poolJson;
  if (typeof poolJson !== 'string') {
    return NextResponse.json({ error: 'body.poolJson (string) is required' }, { status: 400 });
  }

  const dir = getCurriculumDir();
  try {
    const { file } = await writePool(dir, id, poolJson);
    const cms = await getCmsIndex(dir);
    await cms.reindexEntity('pool', id);
    return NextResponse.json({ ok: true, id, file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Validation, mismatch, JSON, and path-safety failures all map to 400.
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
