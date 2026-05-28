// app/api/source/apply/route.ts
// POST { candidate, moduleFileName? } → { ok: true, written }. Re-validates and
// atomically writes the module .md + mcq/<id>.json. Nothing is written unless the
// request reaches here (explicit accept on the client). Server-only.
import { NextResponse } from 'next/server';
import { applyCandidate, moduleFileName as defaultModuleFileName } from '@/lib/source/apply';
import { assertParsesAsModule } from '@/lib/llm/candidate';
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
  const { candidate, moduleFileName } = (body ?? {}) as {
    candidate?: Candidate;
    moduleFileName?: unknown;
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
    return NextResponse.json({ ok: true, written });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
