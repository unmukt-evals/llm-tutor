// app/(shell)/layout.tsx
// Server layout for the (shell) route group: a persistent Sidebar + content.
// Loads curriculum + state ONCE here (server-side, reading CURRICULUM_DIR) and
// passes the pre-built, serializable sidebar model down to the client Sidebar.
// The (shell) group adds NO URL segment, so /, /module/[id], /module/[id]/assess
// and /flashcards keep their exact paths and inherit this shell.
//
// Phase 2 (CMS reframe): both reads flow through `getCmsIndex(curriculumDir)`.
// Curriculum is served from the indexed SQLite mirror (O(1) joins instead of
// 21-file markdown parse on every click); TutorState is assembled from the
// mirror's `module_state` + `flashcard_state` + `app_state` tables. The
// sidecar JSON remains the source of truth — `/api/state` PATCH writes it
// and reindexes the mirror on the same request.
//
// CURRICULUM_DIR-unset guard mirrors the pages: when unset we render children
// WITHOUT a sidebar (the child page shows its own friendly empty state) so
// `next build` — which renders these routes — never throws.

import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import XpPop from '@/components/XpPop';
import LevelUpFlourish from '@/components/LevelUpFlourish';
import RouteTransition from '@/components/RouteTransition';
import { getCmsIndex } from '@/lib/cms';
import { startWatcher } from '@/lib/cms/watcher';
import { buildSidebarModel } from '@/lib/ui/sidebar-model';
import { masterySnapshot } from '@/lib/ui/juice';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const curriculumDir = process.env.CURRICULUM_DIR;

  if (!curriculumDir) {
    // No curriculum → no sidebar; the page renders its own empty state.
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  const cms = await getCmsIndex(curriculumDir);

  // Phase 3 — start the chokidar watcher on first dev-mode render. Singleton
  // + idempotent inside `startWatcher`, so subsequent renders are no-ops. Gated
  // on `NODE_ENV !== 'production'` inside startWatcher (returns null in prod).
  // Try/catch so a watcher init failure (eg. EMFILE on too many open files)
  // never crashes the page.
  try {
    startWatcher(curriculumDir, cms);
  } catch (err) {
    console.warn(
      `[shell-layout] startWatcher failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const curriculum = cms.getCurriculum();
  const state = cms.getFullState();
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
