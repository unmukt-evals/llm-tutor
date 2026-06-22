// src/components/McqFeedback.tsx
// Per-question MCQ feedback view (plan-03 Task 11).
//
// Pure presentational — no state, no fetch.
// Delegates all content logic to feedbackFor() from the pure grade submodule.
// Accessible: correct/incorrect communicated via text + role, not colour only.
//
// Import from @/lib/mcq/grade directly, not the @/lib/mcq barrel: the barrel
// re-exports FileMCQRepository (node:fs/promises + node:path), which cannot be
// bundled into this client component.

import type { MCQQuestion } from '@/lib/types';
import { feedbackFor } from '@/lib/mcq/grade';
import { moduleRefHref } from '@/lib/mcq/remediation-link';

interface McqFeedbackProps {
  question: MCQQuestion;
  chosenIndex: number;
}

export function McqFeedback({ question, chosenIndex }: McqFeedbackProps) {
  const fb = feedbackFor(question, chosenIndex);

  return (
    <div data-testid="mcq-feedback" role="status" aria-live="polite" className="mt-4 rounded-lg border p-4 text-sm">
      {/* Correct / Incorrect heading */}
      <p
        className={`font-semibold text-base ${fb.correct ? 'text-green-700' : 'text-red-700'}`}
        aria-label={fb.correct ? 'Correct' : 'Incorrect'}
      >
        {fb.correct ? '✓ Correct' : '✗ Incorrect'}
      </p>

      {/* On a wrong answer: show the correct option and why the chosen answer was wrong */}
      {!fb.correct && (
        <div className="mt-2 space-y-1">
          <p>
            <span className="font-medium">Correct answer: </span>
            {question.options[fb.correctIndex]}
          </p>
          {fb.distractorWhy && (
            <p>
              <span className="font-medium">Why your choice was wrong: </span>
              {fb.distractorWhy}
            </p>
          )}
        </div>
      )}

      {/* Explanation — always shown */}
      <p className="mt-2 text-gray-700">
        <span className="font-medium">Explanation: </span>
        {fb.explanation}
      </p>

      {/* Pre-collected remediation (Feature 2): a deeper explanation + "re-learn
          this" deep-links back into the module. Static — no LLM at answer time. */}
      {question.remediation && (
        <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
          <p className="text-gray-800">
            <span className="font-medium">Go deeper: </span>
            {question.remediation.deepDive}
          </p>

          {question.remediation.moduleRefs && question.remediation.moduleRefs.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Re-learn in the module
              </p>
              <ul className="space-y-1">
                {question.remediation.moduleRefs.map((ref, i) => (
                  <li key={i}>
                    <a
                      href={moduleRefHref(question.moduleId, ref)}
                      className="text-emerald-700 hover:underline"
                    >
                      ↪ {ref.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {question.remediation.seeAlso && question.remediation.seeAlso.length > 0 && (
            <p className="text-xs text-gray-500">
              See also: {question.remediation.seeAlso.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
