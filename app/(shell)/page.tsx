// app/page.tsx
// Server component: journey map home (S-MAP, plan-02 Task 5).
// Loads curriculum + state server-side; derives nodes/edges; passes
// pre-computed serializable props to the client JourneyMap + TopBar.
//
// Phase 2 (CMS reframe): curriculum + state + flashcards all flow through
// `getCmsIndex(curriculumDir)` — no more disk parses on every click. The due
// count is computed directly from the parsed flashcards rows (cms.getFlashcards)
// against TutorState.flashcards via the existing pure `countDueCards` helper;
// no need to re-read `_flashcards.md` raw text.

import TopBar from '@/components/TopBar';
import JourneyMap from '@/components/JourneyMap';
import { deriveNodesEdges } from '@/lib/map/derive-nodes-edges';
import { getCmsIndex } from '@/lib/cms';
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

  const cms = await getCmsIndex(curriculumDir);
  const curriculum = cms.getCurriculum();
  const state = cms.getFullState();
  const flashcards = cms.getFlashcards();

  const { nodes, edges } = deriveNodesEdges(curriculum, state);
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
