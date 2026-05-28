import { describe, it, expect } from 'vitest';
import { xpDelta, modulesReachingVerified, masterySnapshot } from '@/lib/ui/juice';
import type { Mastery, ModuleState, TutorState } from '@/lib/types';

describe('xpDelta', () => {
  it('returns the positive gain when xp increases', () => {
    expect(xpDelta(100, 130)).toBe(30);
  });
  it('returns 0 when xp is unchanged', () => {
    expect(xpDelta(100, 100)).toBe(0);
  });
  it('returns 0 when xp decreases (never negative)', () => {
    expect(xpDelta(100, 80)).toBe(0);
  });
});

describe('modulesReachingVerified', () => {
  const prev: Record<string, Mastery> = { M01: 'solid', M02: 'verified', M03: 'fuzzy' };

  it('detects a module that just hit verified', () => {
    const next: Record<string, Mastery> = { M01: 'verified', M02: 'verified', M03: 'fuzzy' };
    expect(modulesReachingVerified(prev, next)).toEqual(['M01']);
  });

  it('does not re-fire for a module already verified', () => {
    const next: Record<string, Mastery> = { M01: 'solid', M02: 'verified', M03: 'fuzzy' };
    expect(modulesReachingVerified(prev, next)).toEqual([]);
  });

  it('ignores a module newly appearing as verified with no prior entry', () => {
    const next: Record<string, Mastery> = { ...prev, M99: 'verified' };
    expect(modulesReachingVerified(prev, next)).toEqual([]);
  });

  it('returns multiple ids when several advance at once, in stable order', () => {
    const p: Record<string, Mastery> = { A: 'solid', B: 'solid' };
    const n: Record<string, Mastery> = { A: 'verified', B: 'verified' };
    expect(modulesReachingVerified(p, n).sort()).toEqual(['A', 'B']);
  });
});

describe('masterySnapshot', () => {
  function moduleState(mastery: Mastery): ModuleState {
    return {
      mastery,
      masteryHistory: [],
      mcq: {
        matrix: { easy: {}, medium: {}, hard: {} },
        distractorLog: [],
        dimensionProfile: {
          topic: 'untested',
          logic: 'untested',
          example: 'untested',
          extension: 'untested',
        },
        recentCorrect: [],
      },
      stressTest: {},
    };
  }

  function state(mastery: Record<string, Mastery>): TutorState {
    const modules: TutorState['modules'] = {};
    for (const [id, level] of Object.entries(mastery)) {
      modules[id] = moduleState(level);
    }
    return {
      version: 1,
      modules,
      flashcards: {},
      xp: { total: 0, thisWeek: 0 },
      streak: { count: 0, lastActive: '', freezeTokens: 0 },
      sessionLog: [],
    };
  }

  it('projects state.modules to a flat id→mastery record', () => {
    expect(masterySnapshot(state({ A01: 'verified', A02: 'fuzzy' }))).toEqual({
      A01: 'verified',
      A02: 'fuzzy',
    });
  });

  it('returns an empty record when there are no modules', () => {
    expect(masterySnapshot(state({}))).toEqual({});
  });
});
