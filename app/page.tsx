// app/page.tsx
// Server component: journey map home (S-MAP, plan-02 Task 5).
// Loads curriculum + state server-side; derives nodes/edges; passes
// pre-computed serializable props to the client JourneyMap + TopBar.
//
// dueCount is a placeholder (0) — real due-card counting is wired in Task 7.

import TopBar from '@/components/TopBar';
import JourneyMap from '@/components/JourneyMap';
import { deriveNodesEdges } from '@/lib/map/derive-nodes-edges';
import { getCurriculumRepository } from '@/lib/ingest';
import { getStateStore } from '@/lib/state';

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

  const [curriculum, state] = await Promise.all([
    repo.load(curriculumDir),
    store.read(),
  ]);

  const { nodes, edges } = deriveNodesEdges(curriculum, state);

  // Placeholder: real due-card counting lands in Task 7.
  const dueCount = 0;

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
