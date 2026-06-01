// src/components/studio/StudioNav.tsx
// Top navigation bar for the Studio shell.
// All tabs are real Links — no unclickable placeholders.
// Cross-section links (Modules, Drafts, Cards) carry a ↗ arrow to signal
// they leave Studio and enter the learner shell.

import Link from 'next/link';

export function StudioNav() {
  return (
    <nav className="flex items-center gap-1 border-b border-slate-200 bg-white px-6 py-3 text-sm">
      <Link href="/" className="mr-4 text-slate-600 hover:text-slate-900">
        ← LLM Tutor
      </Link>
      <Link href="/studio" className="rounded px-3 py-1 font-semibold text-slate-900 hover:bg-slate-100">
        Studio
      </Link>
      <Link href="/studio/sources" className="rounded px-3 py-1 text-emerald-700 hover:bg-emerald-50">
        Sources
      </Link>
      <span className="mx-2 text-slate-300">·</span>
      <Link href="/" className="rounded px-3 py-1 text-slate-600 hover:bg-slate-100">
        Modules ↗
      </Link>
      <Link href="/source" className="rounded px-3 py-1 text-slate-600 hover:bg-slate-100">
        Drafts ↗
      </Link>
      <Link href="/flashcards" className="rounded px-3 py-1 text-slate-600 hover:bg-slate-100">
        Cards ↗
      </Link>
      <span className="ml-auto text-xs text-slate-400">authoring</span>
    </nav>
  );
}
