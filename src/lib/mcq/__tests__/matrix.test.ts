import { describe, it, expect } from 'vitest';
import { updateMatrix, accuracyByDimension, profileFromMatrix, emptyMatrix } from '../matrix';
import type { MCQQuestion, MCQAnswer, PerformanceMatrix } from '../../types';

function q(id: string, difficulty: MCQQuestion['difficulty'], dimension: MCQQuestion['dimension']): MCQQuestion {
  return { id, moduleId: 'B99', difficulty, dimension, stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0, distractorMisconception: { '1': '', '2': '', '3': '' }, explanation: '' };
}
function ans(qid: string, chosen: number, correct: boolean): MCQAnswer {
  return { questionId: qid, chosenIndex: chosen, correct, at: '2026-05-27T00:00:00Z' };
}

describe('updateMatrix', () => {
  it('increments seen and correct in the right (difficulty,dimension) cell', () => {
    let m: PerformanceMatrix = emptyMatrix();
    m = updateMatrix(m, ans('q1', 0, true), q('q1', 'medium', 'logic'));
    m = updateMatrix(m, ans('q2', 1, false), q('q2', 'medium', 'logic'));
    expect(m.medium.logic).toEqual({ seen: 2, correct: 1 });
  });

  it('initializes the cell when absent', () => {
    const m: PerformanceMatrix = emptyMatrix();
    const m2 = updateMatrix(m, ans('q1', 0, true), q('q1', 'hard', 'extension'));
    expect(m2.hard.extension).toEqual({ seen: 1, correct: 1 });
  });

  it('does not mutate the input matrix (pure)', () => {
    const m: PerformanceMatrix = emptyMatrix();
    const m2 = updateMatrix(m, ans('q1', 0, true), q('q1', 'easy', 'topic'));
    expect(m.easy.topic).toBeUndefined();
    expect(m2.easy.topic).toEqual({ seen: 1, correct: 1 });
    // sibling difficulty buckets are fresh objects, not shared references
    expect(m2.easy).not.toBe(m.easy);
    expect(m2.medium).not.toBe(m.medium);
  });
});

describe('accuracyByDimension', () => {
  it('aggregates correct/seen across difficulties per dimension', () => {
    let m: PerformanceMatrix = emptyMatrix();
    m = updateMatrix(m, ans('e', 0, true), q('e', 'easy', 'extension'));
    m = updateMatrix(m, ans('m1', 1, false), q('m1', 'medium', 'extension'));
    m = updateMatrix(m, ans('m2', 1, false), q('m2', 'medium', 'extension'));
    // extension: 1 correct / 3 seen
    expect(accuracyByDimension(m).extension).toBeCloseTo(1 / 3, 5);
  });

  it('reports undefined accuracy as untested → null', () => {
    expect(accuracyByDimension(emptyMatrix()).topic).toBeNull();
  });
});

describe('profileFromMatrix', () => {
  it('classifies solid (>=0.8), fuzzy (0.6..0.8), weak (<0.6), untested (no data)', () => {
    let m: PerformanceMatrix = emptyMatrix();
    // topic: 5/5 = solid
    for (let i = 0; i < 5; i++) m = updateMatrix(m, ans(`t${i}`, 0, true), q(`t${i}`, 'easy', 'topic'));
    // logic: 7/10 = 0.7 fuzzy
    for (let i = 0; i < 10; i++) m = updateMatrix(m, ans(`l${i}`, 0, i < 7), q(`l${i}`, 'medium', 'logic'));
    // extension: 1/4 = 0.25 weak
    for (let i = 0; i < 4; i++) m = updateMatrix(m, ans(`x${i}`, 1, i < 1), q(`x${i}`, 'medium', 'extension'));
    // example: untested
    const p = profileFromMatrix(m);
    expect(p.topic).toBe('solid');
    expect(p.logic).toBe('fuzzy');
    expect(p.extension).toBe('weak');
    expect(p.example).toBe('untested');
  });

  it('treats exactly 0.8 as solid and exactly 0.6 as fuzzy (band boundaries)', () => {
    let m: PerformanceMatrix = emptyMatrix();
    // topic: 4/5 = 0.8 → solid (>= 0.8)
    for (let i = 0; i < 5; i++) m = updateMatrix(m, ans(`t${i}`, 0, i < 4), q(`t${i}`, 'easy', 'topic'));
    // logic: 3/5 = 0.6 → fuzzy (>= 0.6, < 0.8)
    for (let i = 0; i < 5; i++) m = updateMatrix(m, ans(`l${i}`, 0, i < 3), q(`l${i}`, 'medium', 'logic'));
    const p = profileFromMatrix(m);
    expect(p.topic).toBe('solid');
    expect(p.logic).toBe('fuzzy');
  });

  it('returns a status for ALL 4 dimensions', () => {
    const p = profileFromMatrix(emptyMatrix());
    expect(Object.keys(p).sort()).toEqual(['example', 'extension', 'logic', 'topic']);
    expect(p.topic).toBe('untested');
    expect(p.logic).toBe('untested');
    expect(p.example).toBe('untested');
    expect(p.extension).toBe('untested');
  });
});
