import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { updateMatrix, emptyMatrix } from '../matrix';
import {
  applyDiagnosisToState, buildRemediationAssessment, clearDiagnosisIfResolved, masteryBlockedByWeakDimension,
} from '../remediation';
import { FileMCQRepository } from '../repository';
import { nextMastery } from '@/lib/state/mastery';
import type { ModuleState, Diagnosis, MCQPool, MCQAnswer, MCQQuestion } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const p = await repo.loadPool('B99');
  if (!p) throw new Error('fixture missing');
  return p;
}
function freshState(): ModuleState {
  return {
    mastery: 'fuzzy', masteryHistory: [],
    mcq: {
      matrix: emptyMatrix(),
      distractorLog: [],
      dimensionProfile: { topic: 'solid', logic: 'solid', example: 'solid', extension: 'weak' },
      recentCorrect: [],
    },
    stressTest: {},
  };
}
const diag: Diagnosis = {
  dimension: 'extension', confidence: 0.8,
  evidence: { qids: ['B99-m-ext'], recurringMisconceptions: ['misattributes transfer failure to contamination'] },
  remediation: 'drill',
};

describe('applyDiagnosisToState', () => {
  it('records openDiagnosis with openedAt', () => {
    const s = applyDiagnosisToState(freshState(), diag, '2026-05-27T00:00:00Z');
    expect(s.mcq.openDiagnosis?.dimension).toBe('extension');
    expect(s.mcq.openDiagnosis?.openedAt).toBe('2026-05-27T00:00:00Z');
  });
  it('is pure (does not mutate input)', () => {
    const s0 = freshState();
    applyDiagnosisToState(s0, diag, 't');
    expect(s0.mcq.openDiagnosis).toBeUndefined();
  });
});

describe('buildRemediationAssessment', () => {
  it('returns 3 questions all in the weak dimension, spanning difficulties when available', async () => {
    const pool = await loadPool();
    const qs = buildRemediationAssessment(pool, 'extension', 3);
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.dimension === 'extension')).toBe(true);
    expect(new Set(qs.map((q) => q.difficulty)).size).toBe(3); // easy/medium/hard each present
  });
});

describe('masteryBlockedByWeakDimension', () => {
  it('blocks advancement while any dimension is weak', () => {
    expect(masteryBlockedByWeakDimension(freshState())).toBe(true);
  });
  it('does not block when no dimension is weak', () => {
    const s = freshState();
    s.mcq.dimensionProfile = { topic: 'solid', logic: 'solid', example: 'solid', extension: 'solid' };
    expect(masteryBlockedByWeakDimension(s)).toBe(false);
  });
});

describe('clearDiagnosisIfResolved', () => {
  it('clears openDiagnosis once the weak dimension recovers above the bar', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let s = applyDiagnosisToState(freshState(), diag, 't');
    // learner now answers extension correctly across difficulties
    const correct = (q: MCQQuestion): MCQAnswer => ({ questionId: q.id, chosenIndex: q.correctIndex, correct: true, at: 't' });
    for (const id of ['B99-e-ext', 'B99-m-ext', 'B99-h-ext']) {
      s = { ...s, mcq: { ...s.mcq, matrix: updateMatrix(s.mcq.matrix, correct(byId(id)), byId(id)) } };
    }
    s = clearDiagnosisIfResolved(s);
    expect(s.mcq.openDiagnosis).toBeUndefined();
    expect(s.mcq.dimensionProfile.extension).not.toBe('weak');
  });

  it('keeps openDiagnosis while the dimension is still weak', () => {
    let s = applyDiagnosisToState(freshState(), diag, 't');
    s = clearDiagnosisIfResolved(s);
    expect(s.mcq.openDiagnosis?.dimension).toBe('extension');
  });

  it('keeps openDiagnosis while the weak dimension is still untested (no new evidence)', () => {
    // §3.6 pinned choice: an untested dimension does NOT clear an open diagnosis —
    // only a recovery to a tested non-weak status (solid/fuzzy) clears it.
    let s = applyDiagnosisToState(freshState(), diag, 't');
    // matrix is empty → profileFromMatrix yields 'untested' for extension
    s = clearDiagnosisIfResolved(s);
    expect(s.mcq.dimensionProfile.extension).toBe('untested');
    expect(s.mcq.openDiagnosis?.dimension).toBe('extension');
  });
});

describe('integration: open diagnosis gates mastery (§7)', () => {
  it('while a diagnosis is open, nextMastery does not advance past fuzzy', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    const correct = (q: MCQQuestion): MCQAnswer => ({ questionId: q.id, chosenIndex: q.correctIndex, correct: true, at: 't' });
    // Build a state that WOULD qualify fuzzy→solid (all passes, drill adequate, no weak dim),
    // but still has an open diagnosis.
    let s = freshState();
    s = { ...s, mcq: { ...s.mcq, dimensionProfile: { topic: 'solid', logic: 'solid', example: 'solid', extension: 'solid' } } };
    for (const id of ['B99-e-ext', 'B99-m-ext', 'B99-h-ext']) {
      s = { ...s, mcq: { ...s.mcq, matrix: updateMatrix(s.mcq.matrix, correct(byId(id)), byId(id)) } };
    }
    s = applyDiagnosisToState(s, diag, 't');
    expect(s.mcq.openDiagnosis).toBeDefined();
    // gate stays put while diagnosis is open
    expect(nextMastery('fuzzy', s, ['tenYearOld', 'engineer', 'operator'], true)).toBe('fuzzy');

    // once the diagnosis is cleared (extension recovered above the bar), it advances
    const cleared = clearDiagnosisIfResolved(s);
    expect(cleared.mcq.openDiagnosis).toBeUndefined();
    expect(nextMastery('fuzzy', cleared, ['tenYearOld', 'engineer', 'operator'], true)).toBe('solid');
  });
});
