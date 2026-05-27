import { describe, it, expect } from 'vitest';
import { gradeAnswer, feedbackFor } from '../grade';
import type { MCQQuestion } from '../../types';

const q: MCQQuestion = {
  id: 'B99-m-ext', moduleId: 'B99', difficulty: 'medium', dimension: 'extension',
  stem: 'Your eval passes; a paraphrased prompt fails…',
  options: ['weak generalization to paraphrase', 'a contaminated set', 'a fairness win', 'a cheaper model'],
  correctIndex: 0,
  distractorMisconception: { '1': 'misattributes transfer failure to contamination', '2': 'calls a failure a win', '3': 'confuses transfer with cost' },
  explanation: 'Paraphrase failure = a transfer/extension gap.',
};

// a question whose wrong option has NO misconception entry (graceful fallback case)
const qMissing: MCQQuestion = {
  ...q,
  id: 'B99-m-ext-missing',
  distractorMisconception: { '1': 'misattributes transfer failure to contamination' },
};

describe('gradeAnswer', () => {
  it('produces a correct MCQAnswer for the right index', () => {
    const a = gradeAnswer(q, 0, '2026-05-27T00:00:00Z');
    expect(a).toEqual({ questionId: 'B99-m-ext', chosenIndex: 0, correct: true, at: '2026-05-27T00:00:00Z' });
  });
  it('marks a wrong index incorrect', () => {
    expect(gradeAnswer(q, 1, 't').correct).toBe(false);
  });
  it('uses the injectable now default when at is omitted', () => {
    const a = gradeAnswer(q, 0);
    expect(typeof a.at).toBe('string');
    expect(a.at.length).toBeGreaterThan(0);
  });
});

describe('feedbackFor', () => {
  it('on correct: explanation, no distractor-why, and an affirmation', () => {
    const fb = feedbackFor(q, 0);
    expect(fb.correct).toBe(true);
    expect(fb.explanation).toMatch(/transfer/);
    expect(fb.distractorWhy).toBeUndefined();
    expect(fb.affirmation).toBeTruthy();
  });
  it('on wrong: includes the explanation AND why the chosen distractor was wrong', () => {
    const fb = feedbackFor(q, 1);
    expect(fb.correct).toBe(false);
    expect(fb.correctIndex).toBe(0);
    expect(fb.explanation).toMatch(/transfer/);
    expect(fb.distractorWhy).toBe('misattributes transfer failure to contamination');
    expect(fb.affirmation).toBeUndefined();
  });
  it('on wrong with no misconception entry: falls back to explanation only', () => {
    const fb = feedbackFor(qMissing, 2);
    expect(fb.correct).toBe(false);
    expect(fb.explanation).toMatch(/transfer/);
    expect(fb.distractorWhy).toBeUndefined();
  });
});
