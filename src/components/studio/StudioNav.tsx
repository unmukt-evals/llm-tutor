'use client';

// src/components/studio/StudioNav.tsx
// Top navigation bar for the Studio shell.
//   - Sources / Modules / Pools are real in-Studio links and get an active
//     style when their section is the current path (5b).
//   - Drafts ↗ and Cards ↗ point OUT of Studio into the learner shell until
//     Phase 5c absorbs them.
//
// Client component because we use usePathname() to highlight the active
// section.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLinkProps {
  href: string;
  label: string;
  active: boolean;
}

function NavLink({ href, label, active }: NavLinkProps) {
  const base = 'rounded px-3 py-1';
  const cls = active
    ? `${base} bg-slate-100 font-semibold text-slate-900`
    : `${base} text-emerald-700 hover:bg-emerald-50`;
  return (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}

export function StudioNav() {
  const pathname = usePathname() ?? '';
  const isStudioRoot = pathname === '/studio';

  return (
    <nav className="flex items-center gap-1 border-b border-slate-200 bg-white px-6 py-3 text-sm">
      <Link href="/" className="mr-4 text-slate-600 hover:text-slate-900">
        ← LLM Tutor
      </Link>
      <Link
        href="/studio"
        className={
          isStudioRoot
            ? 'rounded bg-slate-100 px-3 py-1 font-semibold text-slate-900'
            : 'rounded px-3 py-1 font-semibold text-slate-900 hover:bg-slate-100'
        }
      >
        Studio
      </Link>
      <NavLink
        href="/studio/sources"
        label="Sources"
        active={pathname.startsWith('/studio/sources')}
      />
      <NavLink
        href="/studio/modules"
        label="Modules"
        active={pathname.startsWith('/studio/modules')}
      />
      <NavLink
        href="/studio/pools"
        label="Pools"
        active={pathname.startsWith('/studio/pools')}
      />
      <span className="mx-2 text-slate-300">·</span>
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
