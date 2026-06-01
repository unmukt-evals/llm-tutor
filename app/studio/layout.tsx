// app/studio/layout.tsx
// Studio shell — distinct from the learner (shell) route group.
// Uses the same light palette as the learner shell (bg-slate-50) so
// navigating between the two is visually continuous.
// Token gate is handled upstream by middleware.ts (Task 7); this layout
// has no auth logic.

import type { ReactNode } from 'react';
import { StudioNav } from '@/components/studio/StudioNav';

export const metadata = { title: 'LLM Tutor — Studio' };

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <StudioNav />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
