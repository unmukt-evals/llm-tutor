// app/page.tsx
// Server component: journey map home (S-MAP, plan-02 Task 5).
// Loads curriculum + state server-side; derives nodes/edges; passes
// pre-computed serializable props to the client JourneyMap + TopBar.
//
// dueCount is the real count of spaced-repetition cards due today (plan-02
// Task 7): parse `_flashcards.md` from CURRICULUM_DIR and count via the
// pure cards logic. A missing deck file is treated as 0 due.

import { readFile } from 'fs/promises';
import path from 'path';
import TopBar from '@/components/TopBar';
import JourneyMap from '@/components/JourneyMap';
import { deriveNodesEdges } from '@/lib/map/derive-nodes-edges';
import { getCurriculumRepository } from '@/lib/ingest';
import { getStateStore } from '@/lib/state';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';
import { countDueCards } from '@/lib/cards/due-cards';

export default async function HomePage() {
  const curriculumDir = process.env.CURRICULUM_DIR;

  // Graceful empty state: don't throw (that would break `next build`, which
  // renders this page). Show a friendly message until CURRICULUM_DIR is set.
  if (!curriculumDir) {
    return (
      <main className="min-h-screen bg-slate-50">
        <TopBar streakCount={0} dueCount={0} weeklyXp={0} />
        <div className="p-8 max-w-2xl">
          <h1 className="text-xl font-semibold text-slate-800 mb-2">
            LLM Tutor — Journey Map
          </h1>
          <p className="text-slate-600">
            No curriculum loaded yet. Set the{' '}
            <code className="px-1 py-0.5 rounded bg-slate-200 text-slate-800">
              CURRICULUM_DIR
            </code>{' '}
            environment variable to point at your curriculum folder, then reload.
          </p>
        </div>
      </main>
    );
  }

  const repo = getCurriculumRepository();
  const store = getStateStore(curriculumDir);

  const flashcardsPath = path.join(curriculumDir, '_flashcards.md');
  const [curriculum, state, flashcardsRaw] = await Promise.all([
    repo.load(curriculumDir),
    store.read(),
    // Missing `_flashcards.md` (or any read error) → empty deck → 0 due.
    readFile(flashcardsPath, 'utf-8').catch(() => ''),
  ]);

  const { nodes, edges } = deriveNodesEdges(curriculum, state);

  const flashcards = parseFlashcards(flashcardsRaw);
  const dueCount = countDueCards(flashcards, state.flashcards);

  return (
    <main className="min-h-screen bg-slate-50">
      <TopBar
        streakCount={state.streak.count}
        dueCount={dueCount}
        weeklyXp={state.xp.thisWeek}
      />
      <div className="p-4">
        <h1 className="text-xl font-semibold text-slate-800 mb-4">
          LLM Tutor — Journey Map
        </h1>
        <JourneyMap initialNodes={nodes} initialEdges={edges} />
      </div>
    </main>
  );
}
