// app/api/studio/module/[id]/route.ts
// Phase 5b — Studio Module GET/PUT API.
//   GET → {markdown, module}; 404 on miss.
//   PUT → re-validate via assertParsesAsModule, atomic-write via writeModule,
//         then reindexEntity so subsequent reads see the change.
// Authorization is enforced upstream by middleware.ts.
import 'server-only';
import { NextResponse } from 'next/server';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getCmsIndex } from '@/lib/cms';
import { writeModule } from '@/lib/studio/write-module';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

/** Resolve `<id>-<slug>.md` or `<id>.md` (matches lazyRefresh / writeModule). */
async function resolveModulePath(dir: string, id: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const hit = entries.find(
    (f) =>
      f.endsWith('.md') &&
      !f.startsWith('_') &&
      (f === `${id}.md` || f.startsWith(`${id}-`)),
  );
  return hit ? join(dir, hit) : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const mod = cms.getModule(id);
  if (!mod) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const path = await resolveModulePath(dir, id);
  if (!path) {
    // Index has a row but the file is gone — surface as not found.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const markdown = await readFile(path, 'utf8');
  return NextResponse.json({ ok: true, markdown, module: mod });
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
  const markdown = (body as { markdown?: unknown })?.markdown;
  if (typeof markdown !== 'string') {
    return NextResponse.json({ error: 'body.markdown (string) is required' }, { status: 400 });
  }

  const dir = getCurriculumDir();
  try {
    const { file } = await writeModule(dir, id, markdown);
    const cms = await getCmsIndex(dir);
    await cms.reindexEntity('module', id);
    return NextResponse.json({ ok: true, id, file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Validation, mismatch, and path-safety failures map to 400.
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
