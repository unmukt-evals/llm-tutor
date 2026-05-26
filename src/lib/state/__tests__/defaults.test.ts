import { describe, it, expect } from 'vitest';
import { defaultTutorState, defaultModuleState } from '@/lib/state/defaults';

describe('defaultModuleState', () => {
  it('starts blank with an empty matrix and all dimensions untested', () => {
    const ms = defaultModuleState();
    expect(ms.mastery).toBe('blank');
    expect(ms.masteryHistory).toEqual([]);
    expect(ms.mcq.matrix).toEqual({ easy: {}, medium: {}, hard: {} });
    expect(ms.mcq.distractorLog).toEqual([]);
    expect(ms.mcq.recentCorrect).toEqual([]);
    expect(ms.mcq.dimensionProfile).toEqual({
      topic: 'untested',
      logic: 'untested',
      example: 'untested',
      extension: 'untested',
    });
    expect(ms.mcq.openDiagnosis).toBeUndefined();
    expect(ms.stressTest).toEqual({});
  });

  it('returns a fresh object each call (no shared references)', () => {
    const a = defaultModuleState();
    const b = defaultModuleState();
    expect(a).not.toBe(b);
    expect(a.mcq.matrix).not.toBe(b.mcq.matrix);
    expect(a.mcq.dimensionProfile).not.toBe(b.mcq.dimensionProfile);
  });
});

describe('defaultTutorState', () => {
  it('produces a valid empty v1 state', () => {
    const s = defaultTutorState();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
    expect(s.flashcards).toEqual({});
    expect(s.xp).toEqual({ total: 0, thisWeek: 0 });
    expect(s.streak.count).toBe(0);
    expect(s.streak.lastActive).toBe('');
    expect(s.streak.freezeTokens).toBe(1);
    expect(s.sessionLog).toEqual([]);
  });
});
