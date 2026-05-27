// app/(shell)/layout.tsx
// Server layout for the (shell) route group: a persistent Sidebar + content.
// Loads curriculum + state ONCE here (server-side, reading CURRICULUM_DIR) and
// passes the pre-built, serializable sidebar model down to the client Sidebar.
// The (shell) group adds NO URL segment, so /, /module/[id], /module/[id]/assess
// and /flashcards keep their exact paths and inherit this shell.
//
// CURRICULUM_DIR-unset guard mirrors the pages: when unset we render children
// WITHOUT a sidebar (the child page shows its own friendly empty state) so
// `next build` — which renders these routes — never throws.

import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import XpPop from '@/components/XpPop';
import LevelUpFlourish from '@/components/LevelUpFlourish';
import RouteTransition from '@/components/RouteTransition';
import { getCurriculumRepository } from '@/lib/ingest';
import { getStateStore } from '@/lib/state';
import { buildSidebarModel } from '@/lib/ui/sidebar-model';
import { masterySnapshot } from '@/lib/ui/juice';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const curriculumDir = process.env.CURRICULUM_DIR;

  if (!curriculumDir) {
    // No curriculum → no sidebar; the page renders its own empty state.
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  const [curriculum, state] = await Promise.all([
    getCurriculumRepository().load(curriculumDir),
    getStateStore(curriculumDir).read(),
  ]);
  const groups = buildSidebarModel(curriculum, state);
  const initialMastery = masterySnapshot(state);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar groups={groups} />
      <div className="min-w-0 flex-1">
        <RouteTransition>{children}</RouteTransition>
      </div>
      <XpPop initialXpTotal={state.xp.total} />
      <LevelUpFlourish initialMastery={initialMastery} />
    </div>
  );
}
