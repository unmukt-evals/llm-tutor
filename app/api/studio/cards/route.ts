// app/api/studio/cards/route.ts
// Phase 5c — Studio Cards GET/PUT API.
//   GET → {markdown, parsedCount}; markdown is "" when no _flashcards.md.
//   PUT → re-validate via parseFlashcards (via writeCards), atomic-write,
//         then reindexEntity('flashcards', '_flashcards').
// Authorization is enforced upstream by middleware.ts.
import 'server-only';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCmsIndex } from '@/lib/cms';
import { writeCards } from '@/lib/studio/write-cards';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';

export const dynamic = 'force-dynamic';

const FLASHCARDS_FILE = '_flashcards.md';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

async function readDeck(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, FLASHCARDS_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

export async function GET() {
  const dir = getCurriculumDir();
  const markdown = await readDeck(dir);
  const parsedCount = parseFlashcards(markdown).length;
  return NextResponse.json({ ok: true, markdown, parsedCount });
}

export async function PUT(req: Request) {
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
    await writeCards(dir, markdown);
    const cms = await getCmsIndex(dir);
    await cms.reindexEntity('flashcards', '_flashcards');
    const count = parseFlashcards(markdown).length;
    return NextResponse.json({ ok: true, count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
