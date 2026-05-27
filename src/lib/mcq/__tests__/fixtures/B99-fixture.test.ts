import { describe, it, expect } from 'vitest';
import { B99_POOL as pool } from './pool';
import type { Difficulty, Dimension } from '@/lib/types';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

describe('B99 fixture pool — shape', () => {
  it('has ≥12 questions', () => {
    expect(pool.questions.length).toBeGreaterThanOrEqual(12);
  });

  it('covers every (difficulty × dimension) cell of the 3×4 grid', () => {
    const cells = new Set(pool.questions.map((q) => `${q.difficulty}/${q.dimension}`));
    for (const diff of DIFFICULTIES) {
      for (const dim of DIMENSIONS) {
        expect(cells.has(`${diff}/${dim}`)).toBe(true);
      }
    }
    // exactly one question per cell → 12 distinct cells
    expect(cells.size).toBe(12);
  });

  it('every question has a valid Difficulty and Dimension (union membership)', () => {
    for (const q of pool.questions) {
      expect(DIFFICULTIES).toContain(q.difficulty);
      expect(DIMENSIONS).toContain(q.dimension);
    }
  });

  it('every question has exactly 4 options and a valid correctIndex', () => {
    for (const q of pool.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThanOrEqual(3);
    }
  });

  it('every WRONG option index has a distractorMisconception entry (and none on the correct one)', () => {
    for (const q of pool.questions) {
      const expectedKeys = [0, 1, 2, 3]
        .filter((i) => i !== q.correctIndex)
        .map(String)
        .sort();
      const actualKeys = Object.keys(q.distractorMisconception).sort();
      expect(actualKeys).toEqual(expectedKeys);
      for (const k of actualKeys) {
        expect(q.distractorMisconception[k].length).toBeGreaterThan(0);
      }
    }
  });

  it('every question has an explanation and a sourceRef', () => {
    for (const q of pool.questions) {
      expect(q.explanation.length).toBeGreaterThan(0);
      expect(q.sourceRef).toBeTruthy();
    }
  });

  it("carries the expected moduleId on the pool and every question", () => {
    expect(pool.moduleId).toBe('B99');
    for (const q of pool.questions) {
      expect(q.moduleId).toBe('B99');
    }
  });
});
