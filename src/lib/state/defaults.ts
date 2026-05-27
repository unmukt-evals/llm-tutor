import type { ModuleState, TutorState, PerformanceMatrix, DimensionProfile } from '@/lib/types';

function emptyMatrix(): PerformanceMatrix {
  return { easy: {}, medium: {}, hard: {} };
}

function untestedProfile(): DimensionProfile {
  return { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' };
}

export function defaultModuleState(): ModuleState {
  return {
    mastery: 'blank',
    masteryHistory: [],
    mcq: {
      matrix: emptyMatrix(),
      distractorLog: [],
      // §7 reconciliation: recentCorrect is a required anti-farm source.
      recentCorrect: [],
      dimensionProfile: untestedProfile(),
    },
    stressTest: {},
  };
}

export function defaultTutorState(): TutorState {
  return {
    version: 1,
    modules: {},
    flashcards: {},
    xp: { total: 0, thisWeek: 0 },
    streak: { count: 0, lastActive: '', freezeTokens: 1 },
    sessionLog: [],
  };
}
