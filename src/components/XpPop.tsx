// src/components/XpPop.tsx
// Transient "+N XP" toast. Decoupled from any specific earn-site: it listens
// for a window CustomEvent `llmtutor:xp` whose detail is the new xp total, then
// uses the pure xpDelta detector (tested) to decide whether (and how much) to
// pop. Auto-dismisses; animation collapses to instant under reduced motion.
// Earn-sites fire via announceState(next) in @/lib/ui/juice-events after a
// successful patchState.
'use client';

import { useEffect, useRef, useState } from 'react';
import { xpDelta } from '@/lib/ui/juice';
import { XP_EVENT } from '@/lib/ui/juice-events';
import { motionDurationMs, prefersReducedMotion } from '@/lib/ui/motion';

interface XpPopProps {
  /** Server-known XP total at mount; the baseline for the first delta. */
  initialXpTotal: number;
}

export default function XpPop({ initialXpTotal }: XpPopProps) {
  const prevTotalRef = useRef(initialXpTotal);
  const [gain, setGain] = useState<number | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    let timer: number | undefined;

    function onXp(e: Event) {
      const next = (e as CustomEvent<number>).detail;
      if (typeof next !== 'number') return;
      const delta = xpDelta(prevTotalRef.current, next);
      prevTotalRef.current = next;
      if (delta <= 0) return;
      setGain(delta);
      const hold = motionDurationMs(1500, reducedRef.current) || 1200;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setGain(null), hold);
    }

    window.addEventListener(XP_EVENT, onXp);
    return () => {
      window.removeEventListener(XP_EVENT, onXp);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (gain === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="xp-pop"
      className="pointer-events-none fixed bottom-6 right-6 z-50 animate-[xppop_300ms_ease-out] rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg"
    >
      +{gain} XP
    </div>
  );
}
