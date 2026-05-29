// app/studio/layout.tsx
// Studio shell — distinct from the learner (shell) route group.
// Dark neutral palette (bg-neutral-900) signals "authoring mode" vs the
// learner shell's light (bg-slate-50). Token gate is handled upstream by
// middleware.ts (Task 7); this layout has no auth logic.

import type { ReactNode } from 'react';
import { StudioNav } from '@/components/studio/StudioNav';

export const metadata = { title: 'LLM Tutor — Studio' };

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      <StudioNav />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
