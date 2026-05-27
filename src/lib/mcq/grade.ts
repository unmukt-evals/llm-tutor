import type { MCQQuestion, MCQAnswer } from '@/lib/types';

/**
 * Deterministic MCQ scoring (build-spec §3.7) — exact-match to correctIndex. NO LLM.
 * `at` is injectable for deterministic tests; defaults to the current ISO timestamp.
 */
export function gradeAnswer(
  q: MCQQuestion,
  chosenIndex: number,
  at: string = new Date().toISOString(),
): MCQAnswer {
  return { questionId: q.id, chosenIndex, correct: chosenIndex === q.correctIndex, at };
}

export interface QuestionFeedback {
  correct: boolean;
  correctIndex: number;
  /** Why the correct answer is correct (always present). */
  explanation: string;
  /**
   * §3.7 — why the specific chosen distractor was wrong (from distractorMisconception).
   * Absent when correct, or when the wrong choice has no misconception entry
   * (graceful fallback to explanation only).
   */
  distractorWhy?: string;
  /** Correct-answer affirmation. Present only when correct. */
  affirmation?: string;
}

/** build-spec §3.7 per-question feedback. */
export function feedbackFor(q: MCQQuestion, chosenIndex: number): QuestionFeedback {
  const correct = chosenIndex === q.correctIndex;
  const distractorWhy = correct ? undefined : q.distractorMisconception[String(chosenIndex)];
  return {
    correct,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    distractorWhy,
    affirmation: correct ? 'Correct.' : undefined,
  };
}
