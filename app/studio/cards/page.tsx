// app/studio/cards/page.tsx
// Phase 5c — Studio Cards editor. Server component reads the raw
// `_flashcards.md` bytes plus the parsed cards (via the CMS index) for the
// preview pane, then hands both to <CardsEditClient>.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCmsIndex } from '@/lib/cms';
import { CardsEditClient } from '@/components/studio/CardsEditClient';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

async function readDeck(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, '_flashcards.md'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

export default async function CardsPage() {
  const dir = getCurriculumDir();
  const [markdown, cms] = await Promise.all([readDeck(dir), getCmsIndex(dir)]);
  const cards = cms.getFlashcards();

  const byTrack: Record<string, number> = {};
  for (const c of cards) {
    byTrack[c.moduleId] = (byTrack[c.moduleId] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cards ({cards.length})</h1>
      </div>
      <p className="text-sm text-slate-600">
        Edit the raw <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">_flashcards.md</code>{' '}
        deck. Each card is a list item with <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">front :: back</code>,
        optionally prefixed with <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">module:&lt;id&gt;</code> and{' '}
        <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">last-tested:&lt;YYYY-MM-DD&gt;</code> tags.
      </p>
      <CardsEditClient
        initialMarkdown={markdown}
        initialCount={cards.length}
        byTrack={byTrack}
      />
    </div>
  );
}
