import { describe, it, expect } from 'vitest';
import { revealForDrill, revealForStressTest, applyStressSelfMark } from '../self';
import type { Drill, StressTest, ModuleState } from '../../types';
import { emptyMatrix } from '../matrix';

function freshState(): ModuleState {
  return {
    mastery: 'fuzzy',
    masteryHistory: [],
    mcq: {
      matrix: emptyMatrix(),
      distractorLog: [],
      dimensionProfile: { topic: 'solid', logic: 'solid', example: 'solid', extension: 'solid' },
      recentCorrect: [],
    },
    stressTest: {},
  };
}

describe('revealForDrill', () => {
  it('assembles model answer + DC1/DC2 + rubric from the drill and sources', () => {
    const drill: Drill = {
      scenario: 'Design an eval for X',
      dc1: 'What nuisance factors must it be invariant to?',
      dc2: 'How do you detect contamination?',
    };
    const r = revealForDrill(drill, ['S4: fairness = invariance']);
    expect(r.scenario).toContain('Design an eval');
    expect(r.doubleClicks).toEqual([drill.dc1, drill.dc2]);
    expect(r.rubric.length).toBeGreaterThan(0);
  });

  it('filters undefined double-clicks', () => {
    const drill: Drill = { scenario: 'Only a scenario' };
    const r = revealForDrill(drill, []);
    expect(r.doubleClicks).toEqual([]);
    expect(r.rubric).toEqual([]);
  });
});

describe('revealForStressTest', () => {
  it('assembles the lens question + rubric', () => {
    const st: StressTest = { lens: 'board', question: 'Defend this eval to a skeptical board.' };
    const r = revealForStressTest(st, ['S4']);
    expect(r.lens).toBe('board');
    expect(r.scenario).toContain('board');
  });
});

describe('applyStressSelfMark', () => {
  it('writes the lens verdict to ModuleState.stressTest (pure)', () => {
    const s0 = freshState();
    const s1 = applyStressSelfMark(s0, 'board', 'passed');
    expect(s1.stressTest.board).toBe('passed');
    expect(s0.stressTest.board).toBeUndefined(); // input unchanged
  });
  it('maps not_yet correctly', () => {
    const s = applyStressSelfMark(freshState(), 'researcher', 'not_yet');
    expect(s.stressTest.researcher).toBe('not_yet');
  });
  it('overwrites a prior mark for the same lens', () => {
    let s = applyStressSelfMark(freshState(), 'analyst', 'not_yet');
    expect(s.stressTest.analyst).toBe('not_yet');
    s = applyStressSelfMark(s, 'analyst', 'passed');
    expect(s.stressTest.analyst).toBe('passed');
  });
});
