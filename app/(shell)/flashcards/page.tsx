// app/flashcards/page.tsx
// Server component: flashcard review page (S-CARDS, plan-02 Task 10).
//
// Phase 2 (CMS reframe): the parsed deck + state both come from the CMS index.
// `cms.getFlashcards()` returns the parsed Flashcard[] from the SQLite mirror
// (no markdown re-parse on every click); `cms.getFullState()` assembles the
// full TutorState whose `.flashcards` map drives the pure `dueCards` helper.
//
// Graceful empty states (never throws — that would break `next build`, which
// renders this page):
//   - CURRICULUM_DIR unset      → friendly "no curriculum loaded" message
//   - missing _flashcards.md    → empty deck → "no cards due — come back later"
//   - nothing due today         → same empty-deck message (from FlashcardReview)

import FlashcardReview from '@/components/FlashcardReview';
import { getCmsIndex } from '@/lib/cms';
import { dueCards } from '@/lib/cards/due-cards';

export default async function FlashcardsPage() {
  const curriculumDir = process.env.CURRICULUM_DIR;

  if (!curriculumDir) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="max-w-xl mx-auto px-4 py-8">
          <h1 className="text-xl font-semibold text-slate-800 mb-2">
            Flashcard Review
          </h1>
          <p className="text-slate-600">
            No curriculum loaded yet. Set the{' '}
            <code className="px-1 py-0.5 rounded bg-slate-200 text-slate-800">
              CURRICULUM_DIR
            </code>{' '}
            environment variable to point at your curriculum folder, then reload.
          </p>
        </div>
      </main>
    );
  }

  const cms = await getCmsIndex(curriculumDir);
  const flashcards = cms.getFlashcards();
  const state = cms.getFullState();

  const due = dueCards(flashcards, state.flashcards);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">
          Flashcard Review
        </h1>
        <p className="text-sm text-slate-500 mb-8">
          {due.length} card{due.length !== 1 ? 's' : ''} due today
        </p>
        <FlashcardReview dueCards={due} />
      </div>
    </main>
  );
}
