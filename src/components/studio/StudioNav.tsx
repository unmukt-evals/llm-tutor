// src/components/studio/StudioNav.tsx
// Top navigation bar for the Studio shell (Phase 5a).
// Server component — no interactivity beyond <Link>s.
// Faded placeholders for Modules / Pools / Drafts / Cards make the
// partial-5a state explicit without breaking visual hierarchy.

import Link from 'next/link';

export function StudioNav() {
  return (
    <nav className="flex items-center gap-4 border-b border-neutral-800 bg-neutral-950 px-6 py-3 text-sm text-neutral-300">
      <Link href="/studio" className="font-semibold text-white">
        Studio
      </Link>
      <Link href="/studio/sources" className="hover:text-white">
        Sources
      </Link>
      <span className="text-neutral-600">Modules (5b)</span>
      <span className="text-neutral-600">Pools (5b)</span>
      <span className="text-neutral-600">Drafts (5c)</span>
      <span className="text-neutral-600">Cards (5c)</span>
      <span className="ml-auto text-xs text-neutral-500">Studio · authoring</span>
    </nav>
  );
}
