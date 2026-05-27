// src/components/LevelUpFlourish.tsx
// Celebratory "level up" moment when a module transitions INTO 'verified'.
// Decoupled like XpPop: listens for a window CustomEvent `llmtutor:mastery`
// whose detail is the new Record<moduleId, Mastery> snapshot, then uses the
// pure modulesReachingVerified detector (tested) to decide whether to fire.
// Earn-sites fire via announceState(next) in @/lib/ui/juice-events after a
// successful patchState.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Mastery } from '@/lib/types';
import { modulesReachingVerified } from '@/lib/ui/juice';
import { MASTERY_EVENT } from '@/lib/ui/juice-events';
import { motionDurationMs, prefersReducedMotion } from '@/lib/ui/motion';

interface LevelUpFlourishProps {
  /** Server-known mastery snapshot at mount; baseline for transition detection. */
  initialMastery: Record<string, Mastery>;
}

export default function LevelUpFlourish({ initialMastery }: LevelUpFlourishProps) {
  const prevRef = useRef<Record<string, Mastery>>(initialMastery);
  const [verifiedIds, setVerifiedIds] = useState<string[] | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    let timer: number | undefined;

    function onMastery(e: Event) {
      const next = (e as CustomEvent<Record<string, Mastery>>).detail;
      if (!next || typeof next !== 'object') return;
      const advanced = modulesReachingVerified(prevRef.current, next);
      prevRef.current = next;
      if (advanced.length === 0) return;
      setVerifiedIds(advanced);
      const hold = motionDurationMs(2200, reducedRef.current) || 1500;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setVerifiedIds(null), hold);
    }

    window.addEventListener(MASTERY_EVENT, onMastery);
    return () => {
      window.removeEventListener(MASTERY_EVENT, onMastery);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (!verifiedIds || verifiedIds.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="level-up-flourish"
      className="pointer-events-none fixed inset-x-0 top-10 z-50 flex justify-center"
    >
      <div className="animate-[levelup_500ms_ease-out] rounded-xl border border-emerald-300 bg-white px-6 py-4 text-center shadow-2xl">
        <div className="text-2xl">🎉</div>
        <div className="mt-1 text-sm font-semibold text-emerald-700">
          {verifiedIds.length === 1
            ? `Module ${verifiedIds[0]} verified!`
            : `${verifiedIds.length} modules verified!`}
        </div>
      </div>
    </div>
  );
}
