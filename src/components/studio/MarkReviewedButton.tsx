'use client';

// src/components/studio/MarkReviewedButton.tsx
// Phase 6 Piece B — client button on the Studio dashboard's "Stale source
// links" surface. Fires POST /api/studio/cascade/clear-stale and then refreshes
// the server component so the row disappears.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  moduleId: string;
  sourceId: string;
}

export function MarkReviewedButton({ moduleId, sourceId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setError(null);
    try {
      const res = await fetch('/api/studio/cascade/clear-stale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, sourceId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
      >
        {isPending ? 'Marking…' : 'Mark reviewed'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
