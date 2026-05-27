// src/components/FlashcardReview.tsx
// Client component: self-graded flashcard review loop (S-CARDS, plan-02 Task 10).
//
// Receives the due cards as serializable props (computed server-side in
// app/flashcards/page.tsx). The loop is a thin shell over tested pure helpers:
//   - review-queue.ts owns "front → back → next / done" advancement
//   - srPatch (sr-update.ts) owns the SR transform + the /api/state PATCH shape
//   - patchState (api-client.ts) owns the network write
// This component only binds UI events to those helpers. Recall is honest:
// "Again" = miss (resets interval), "Good" = hit (advances interval).
'use client';

import { useCallback, useState } from 'react';
import { srPatch } from '@/lib/cards/sr-update';
import { patchState } from '@/lib/api-client';
import { announceState } from '@/lib/ui/juice-events';
import {
  advanceQueue,
  initialQueueState,
  revealBack,
  type ReviewQueueState,
} from '@/lib/cards/review-queue';
import type { DueCard } from '@/lib/cards/due-cards';
import type { Recall } from '@/lib/cards/sr-update';

interface FlashcardReviewProps {
  dueCards: DueCard[];
}

export default function FlashcardReview({ dueCards }: FlashcardReviewProps) {
  const [queue, setQueue] = useState<ReviewQueueState>(() =>
    initialQueueState(dueCards.length),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = dueCards[queue.index];

  const handleReveal = useCallback(() => {
    setQueue((q) => revealBack(q));
  }, []);

  const handleGrade = useCallback(
    async (recall: Recall) => {
      if (!current || saving) return;
      setSaving(true);
      setError(null);
      try {
        // srPatch delegates the SR schedule to applyRecall/nextSrInterval and
        // returns the exact { path, value } the api-client expects.
        const patch = srPatch(current.card.id, current.state, recall);
        const next = await patchState(patch.path, patch.value);
        // Fire the juice layer off the persisted state (pure detectors gate it).
        announceState(next);
        setQueue((q) => advanceQueue(q, dueCards.length));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [current, saving, dueCards.length],
  );

  // Empty deck — nothing was due when the page loaded.
  if (dueCards.length === 0) {
    return (
      <div className="text-center text-slate-500 py-12">
        No cards due — come back later.
      </div>
    );
  }

  // Deck exhausted — every due card has been graded this session.
  if (queue.phase === 'done') {
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-2xl text-slate-800">Done for today!</p>
        <p className="text-slate-500 text-sm">
          Reviewed {dueCards.length} card{dueCards.length !== 1 ? 's' : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-6">
      <p className="text-xs text-slate-400 text-right">
        Card {queue.index + 1} / {dueCards.length}
      </p>

      {/* Card face */}
      <div className="bg-white border border-slate-200 rounded-xl p-8 min-h-[180px] flex items-center justify-center text-center shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
            {queue.phase === 'front' ? 'Front' : 'Back'}
          </p>
          <p className="text-lg text-slate-800">
            {queue.phase === 'front' ? current.card.front : current.card.back}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 text-center" role="alert">
          Couldn&apos;t save your answer: {error}
        </p>
      )}

      {/* Actions */}
      {queue.phase === 'front' ? (
        <button
          onClick={handleReveal}
          className="w-full py-3 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors"
        >
          Reveal answer
        </button>
      ) : (
        <div className="flex gap-4">
          <button
            onClick={() => handleGrade('again')}
            disabled={saving}
            className="flex-1 py-3 rounded-lg border border-red-300 text-red-600 font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            Again
          </button>
          <button
            onClick={() => handleGrade('good')}
            disabled={saving}
            className="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            Good
          </button>
        </div>
      )}
    </div>
  );
}
