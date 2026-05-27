// app/flashcards/page.tsx
// Server component: flashcard review page (S-CARDS, plan-02 Task 10).
//
// Reads `_flashcards.md` from CURRICULUM_DIR, parses it, reads sidecar state via
// the StateStore, computes the due cards with the pure `dueCards` helper, and
// hands them as serializable props to the client <FlashcardReview/>.
//
// Graceful empty states (never throws — that would break `next build`, which
// renders this page):
//   - CURRICULUM_DIR unset      → friendly "no curriculum loaded" message
//   - missing _flashcards.md    → empty deck → "no cards due — come back later"
//   - nothing due today         → same empty-deck message (from FlashcardReview)

import { readFile } from 'fs/promises';
import path from 'path';
import FlashcardReview from '@/components/FlashcardReview';
import { getStateStore } from '@/lib/state';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';
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

  const store = getStateStore(curriculumDir);
  const flashcardsPath = path.join(curriculumDir, '_flashcards.md');

  const [state, flashcardsRaw] = await Promise.all([
    store.read(),
    // Missing `_flashcards.md` (or any read error) → empty deck → 0 due.
    readFile(flashcardsPath, 'utf-8').catch(() => ''),
  ]);

  const flashcards = parseFlashcards(flashcardsRaw);
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
