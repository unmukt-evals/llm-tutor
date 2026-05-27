import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { foldAnswer, finalizeAssessment, mcqPatch, type McqState } from '../runner';
import { gradeAnswer } from '../grade';
import { emptyMatrix } from '../matrix';
import { FileMCQRepository } from '../repository';
import type { MCQPool, MCQQuestion } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const p = await repo.loadPool('B99');
  if (!p) throw new Error('fixture missing');
  return p;
}

function freshMcq(): McqState {
  return {
    matrix: emptyMatrix(),
    distractorLog: [],
    recentCorrect: [],
    dimensionProfile: { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' },
  };
}

describe('foldAnswer', () => {
  it('increments the matrix cell and recomputes dimensionProfile', () => {
    const q: MCQQuestion = {
      id: 'q1', moduleId: 'B99', difficulty: 'easy', dimension: 'topic',
      stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' }, explanation: 'e',
    };
    const a = gradeAnswer(q, 0, 't1');
    const next = foldAnswer(freshMcq(), q, a);
    expect(next.matrix.easy.topic).toEqual({ seen: 1, correct: 1 });
    expect(next.dimensionProfile.topic).toBe('solid');
  });

  it('on a correct answer appends recentCorrect and leaves distractorLog untouched', () => {
    const q: MCQQuestion = {
      id: 'q1', moduleId: 'B99', difficulty: 'easy', dimension: 'topic',
      stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' }, explanation: 'e',
    };
    const next = foldAnswer(freshMcq(), q, gradeAnswer(q, 0, 't1'));
    expect(next.recentCorrect).toEqual([{ qid: 'q1', at: 't1' }]);
    expect(next.distractorLog).toEqual([]);
  });

  it('on a wrong answer appends a ChosenDistractor and leaves recentCorrect untouched', () => {
    const q: MCQQuestion = {
      id: 'q1', moduleId: 'B99', difficulty: 'medium', dimension: 'extension',
      stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' }, explanation: 'e',
    };
    const next = foldAnswer(freshMcq(), q, gradeAnswer(q, 1, 't1'));
    expect(next.distractorLog).toEqual([{ qid: 'q1', chose: 1, at: 't1' }]);
    expect(next.recentCorrect).toEqual([]);
  });

  it('is pure (does not mutate the input slice)', () => {
    const q: MCQQuestion = {
      id: 'q1', moduleId: 'B99', difficulty: 'easy', dimension: 'topic',
      stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' }, explanation: 'e',
    };
    const before = freshMcq();
    foldAnswer(before, q, gradeAnswer(q, 0, 't1'));
    expect(before.matrix.easy.topic).toBeUndefined();
    expect(before.recentCorrect).toEqual([]);
  });
});

describe('finalizeAssessment — EXACT user scenario (fold then diagnose)', () => {
  it('easy✓ + medium topic/logic✓ + medium/hard extension✗ → opens an extension diagnosis routed to drill', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;

    let mcq = freshMcq();
    // easy: all correct
    for (const id of ['B99-e-topic', 'B99-e-logic', 'B99-e-example', 'B99-e-ext']) {
      const q = byId(id);
      mcq = foldAnswer(mcq, q, gradeAnswer(q, q.correctIndex, 't'));
    }
    // medium topic & logic correct
    for (const id of ['B99-m-topic', 'B99-m-logic']) {
      const q = byId(id);
      mcq = foldAnswer(mcq, q, gradeAnswer(q, q.correctIndex, 't'));
    }
    // medium + hard extension wrong (same distractor → recurring misconception)
    for (const id of ['B99-m-ext', 'B99-h-ext']) {
      const q = byId(id);
      mcq = foldAnswer(mcq, q, gradeAnswer(q, 1, 't'));
    }

    const final = finalizeAssessment(mcq, pool, '2026-05-27T00:00:00Z');
    expect(final.openDiagnosis?.dimension).toBe('extension');
    expect(final.openDiagnosis?.remediation).toBe('drill');
    expect(final.openDiagnosis?.openedAt).toBe('2026-05-27T00:00:00Z');
    expect(final.dimensionProfile.extension).toBe('weak');
  });

  it('does not open a diagnosis on an all-correct set', async () => {
    const pool = await loadPool();
    let mcq = freshMcq();
    for (const q of pool.questions.slice(0, 6)) {
      mcq = foldAnswer(mcq, q, gradeAnswer(q, q.correctIndex, 't'));
    }
    const final = finalizeAssessment(mcq, pool, 't');
    expect(final.openDiagnosis).toBeUndefined();
  });

  it('clears a stale open diagnosis once the dimension recovers, without re-opening', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    // Start with an open extension diagnosis but a now-recovered matrix.
    let mcq = freshMcq();
    for (const id of ['B99-e-ext', 'B99-m-ext', 'B99-h-ext']) {
      const q = byId(id);
      mcq = foldAnswer(mcq, q, gradeAnswer(q, q.correctIndex, 't'));
    }
    mcq = {
      ...mcq,
      openDiagnosis: {
        dimension: 'extension', confidence: 0.8,
        evidence: { qids: ['B99-m-ext'], recurringMisconceptions: ['x'] },
        remediation: 'drill', openedAt: 't0',
      },
    };
    const final = finalizeAssessment(mcq, pool, 't');
    expect(final.openDiagnosis).toBeUndefined();
  });
});

describe('mcqPatch', () => {
  it('targets ["modules", moduleId, "mcq"] with the slice as value', () => {
    const mcq = freshMcq();
    const patch = mcqPatch('B99', mcq);
    expect(patch.path).toEqual(['modules', 'B99', 'mcq']);
    expect(patch.value).toBe(mcq);
  });
});
