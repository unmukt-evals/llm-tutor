import { describe, it, expect } from 'vitest';
import { updateMatrix, emptyMatrix } from '../matrix';
import { detectInconsistency } from '../inconsistency';
import type { MCQQuestion, MCQAnswer, PerformanceMatrix } from '../../types';

function q(id: string, difficulty: MCQQuestion['difficulty'], dimension: MCQQuestion['dimension']): MCQQuestion {
  return { id, moduleId: 'B99', difficulty, dimension, stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0, distractorMisconception: { '1': '', '2': '', '3': '' }, explanation: '' };
}
const ans = (qid: string, correct: boolean): MCQAnswer => ({ questionId: qid, chosenIndex: correct ? 0 : 1, correct, at: 't' });

function build(rows: Array<[MCQQuestion, boolean]>): PerformanceMatrix {
  let m = emptyMatrix();
  for (const [qq, c] of rows) m = updateMatrix(m, ans(qq.id, c), qq);
  return m;
}

describe('detectInconsistency', () => {
  it('fires on mixed-within-a-band (some medium right, some medium wrong)', () => {
    const m = build([
      [q('m1', 'medium', 'logic'), true],
      [q('m2', 'medium', 'extension'), false],
      [q('m3', 'medium', 'extension'), false],
    ]);
    expect(detectInconsistency(m)).toBe(true);
  });

  it('fires on dimension imbalance (one <60% while >=2 others >80%)', () => {
    const m = build([
      // topic solid
      [q('t1', 'easy', 'topic'), true], [q('t2', 'medium', 'topic'), true], [q('t3', 'hard', 'topic'), true], [q('t4', 'easy', 'topic'), true], [q('t5', 'medium', 'topic'), true],
      // logic solid
      [q('l1', 'easy', 'logic'), true], [q('l2', 'medium', 'logic'), true], [q('l3', 'hard', 'logic'), true], [q('l4', 'easy', 'logic'), true], [q('l5', 'medium', 'logic'), true],
      // extension weak: 0/3
      [q('x1', 'medium', 'extension'), false], [q('x2', 'medium', 'extension'), false], [q('x3', 'hard', 'extension'), false],
    ]);
    expect(detectInconsistency(m)).toBe(true);
  });

  it('does NOT fire on a clean monotone frontier profile (easy✓ medium✓ hard mixed)', () => {
    const m = build([
      [q('e1', 'easy', 'topic'), true], [q('e2', 'easy', 'logic'), true],
      [q('m1', 'medium', 'topic'), true], [q('m2', 'medium', 'logic'), true],
      [q('h1', 'hard', 'topic'), false], [q('h2', 'hard', 'logic'), true], // hard is the frontier, not inconsistent
    ]);
    expect(detectInconsistency(m)).toBe(false);
  });

  it('does NOT fire with too little data (single answer)', () => {
    const m = build([[q('m1', 'medium', 'logic'), false]]);
    expect(detectInconsistency(m)).toBe(false);
  });
});
