// src/components/RouteTransition.tsx
// Cross-fades content on route change. Keyed on the pathname so React remounts
// the wrapper (re-running the entry animation) each navigation. CSS-only; the
// reduced-motion media query in globals.css disables the animation. Thin shell —
// no logic beyond reading the current path.
'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export default function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-[routefade_250ms_ease-out]">
      {children}
    </div>
  );
}
