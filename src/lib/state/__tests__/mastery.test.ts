import { describe, it, expect } from 'vitest';
import { nextMastery } from '@/lib/state/mastery';
import { defaultModuleState } from '@/lib/state/defaults';
import type { Dimension, ModuleState, NextMastery } from '@/lib/types';

// Compile-time assertion: the exported function structurally matches the NextMastery alias.
const _typeCheck: NextMastery = nextMastery;
void _typeCheck;

function withCells(
  base: ModuleState,
  cells: Partial<
    Record<'easy' | 'medium' | 'hard', Record<string, { seen: number; correct: number }>>
  >,
): ModuleState {
  return {
    ...base,
    mcq: {
      ...base.mcq,
      matrix: {
        easy: { ...base.mcq.matrix.easy, ...cells.easy },
        medium: { ...base.mcq.matrix.medium, ...cells.medium },
        hard: { ...base.mcq.matrix.hard, ...cells.hard },
      },
    },
  };
}

describe('nextMastery — blank → fuzzy', () => {
  it('promotes when ≥1 easy AND ≥1 medium correct and no open diagnosis', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 1, correct: 1 } },
      medium: { logic: { seen: 1, correct: 1 } },
    });
    expect(nextMastery('blank', ms, [], false)).toBe('fuzzy');
  });

  it('promotes when the correct easy/medium answers are in different dimensions', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { example: { seen: 1, correct: 1 } },
      medium: { extension: { seen: 1, correct: 1 } },
    });
    expect(nextMastery('blank', ms, [], false)).toBe('fuzzy');
  });

  it('stays blank when only easy correct (no medium)', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 2, correct: 2 } },
    });
    expect(nextMastery('blank', ms, [], false)).toBe('blank');
  });

  it('stays blank when only medium correct (no easy)', () => {
    const ms = withCells(defaultModuleState(), {
      medium: { logic: { seen: 2, correct: 2 } },
    });
    expect(nextMastery('blank', ms, [], false)).toBe('blank');
  });

  it('stays blank when easy and medium were seen but never correct', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 3, correct: 0 } },
      medium: { logic: { seen: 3, correct: 0 } },
    });
    expect(nextMastery('blank', ms, [], false)).toBe('blank');
  });

  it('stays blank for a fully empty matrix', () => {
    expect(nextMastery('blank', defaultModuleState(), [], false)).toBe('blank');
  });

  it('stays blank when there is an open diagnosis even if easy+medium correct', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 1, correct: 1 } },
      medium: { logic: { seen: 1, correct: 1 } },
    });
    ms.mcq.openDiagnosis = {
      dimension: 'extension',
      confidence: 0.5,
      evidence: { qids: [], recurringMisconceptions: [] },
      remediation: 'drill',
      openedAt: 'now',
    };
    expect(nextMastery('blank', ms, [], false)).toBe('blank');
  });

  it('ignores readPasses and drillAdequate for the blank→fuzzy decision', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 1, correct: 1 } },
      medium: { logic: { seen: 1, correct: 1 } },
    });
    // drillAdequate=true and all passes read must not change the blank→fuzzy outcome.
    expect(nextMastery('blank', ms, ['tenYearOld', 'engineer', 'operator'], true)).toBe('fuzzy');
    // and an unqualified module must not be promoted just because drillAdequate is true.
    expect(nextMastery('blank', defaultModuleState(), ['engineer'], true)).toBe('blank');
  });
});

describe('nextMastery — does not regress or skip ahead', () => {
  it('leaves an already-fuzzy module fuzzy when it does not qualify for solid', () => {
    // Hard cells alone do not promote fuzzy→solid; that path needs passes + drill.
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 1, correct: 1 } },
      medium: { logic: { seen: 1, correct: 1 } },
      hard: { topic: { seen: 1, correct: 1 } },
    });
    expect(nextMastery('fuzzy', ms, [], false)).toBe('fuzzy');
  });

  it('leaves a solid module solid when it does not qualify for verified', () => {
    // Reading passes / drill do not promote solid→verified; that path needs hard
    // MCQs in all 4 dims + all stress lenses passed (none set here).
    const ms = defaultModuleState();
    ms.mastery = 'solid';
    expect(nextMastery('solid', ms, ['tenYearOld', 'engineer', 'operator'], true)).toBe('solid');
  });

  it('leaves a verified module verified', () => {
    expect(nextMastery('verified', defaultModuleState(), [], false)).toBe('verified');
  });
});

describe('nextMastery — fuzzy → solid', () => {
  function fuzzyReady(): ModuleState {
    const ms = defaultModuleState();
    ms.mastery = 'fuzzy';
    ms.mcq.dimensionProfile = {
      topic: 'solid',
      logic: 'solid',
      example: 'fuzzy',
      extension: 'fuzzy',
    };
    return ms;
  }
  const allPasses: ('tenYearOld' | 'engineer' | 'operator')[] = [
    'tenYearOld',
    'engineer',
    'operator',
  ];

  it('promotes when all 3 passes read + drill adequate + no weak dimension', () => {
    expect(nextMastery('fuzzy', fuzzyReady(), allPasses, true)).toBe('solid');
  });

  it('stays fuzzy when a pass is unread', () => {
    expect(nextMastery('fuzzy', fuzzyReady(), ['tenYearOld', 'engineer'], true)).toBe('fuzzy');
  });

  it('stays fuzzy when no passes have been read', () => {
    expect(nextMastery('fuzzy', fuzzyReady(), [], true)).toBe('fuzzy');
  });

  it('stays fuzzy when the drill is not adequate', () => {
    expect(nextMastery('fuzzy', fuzzyReady(), allPasses, false)).toBe('fuzzy');
  });

  it('stays fuzzy when a dimension is weak', () => {
    const ms = fuzzyReady();
    ms.mcq.dimensionProfile.extension = 'weak';
    expect(nextMastery('fuzzy', ms, allPasses, true)).toBe('fuzzy');
  });

  it('promotes even when some dimensions are still untested (only weak blocks)', () => {
    const ms = fuzzyReady();
    ms.mcq.dimensionProfile = {
      topic: 'solid',
      logic: 'untested',
      example: 'fuzzy',
      extension: 'untested',
    };
    expect(nextMastery('fuzzy', ms, allPasses, true)).toBe('solid');
  });
});

describe('nextMastery — solid → verified', () => {
  function solidReady(): ModuleState {
    const ms = defaultModuleState();
    ms.mastery = 'solid';
    const dims: Dimension[] = ['topic', 'logic', 'example', 'extension'];
    for (const d of dims) ms.mcq.matrix.hard[d] = { seen: 1, correct: 1 };
    ms.stressTest = { board: 'passed', researcher: 'passed', analyst: 'passed' };
    return ms;
  }

  it('promotes when hard correct in all 4 dims + all 3 stress lenses passed', () => {
    expect(nextMastery('solid', solidReady(), [], false)).toBe('verified');
  });

  it('stays solid when one hard dimension is not yet correct', () => {
    const ms = solidReady();
    ms.mcq.matrix.hard.extension = { seen: 1, correct: 0 };
    expect(nextMastery('solid', ms, [], false)).toBe('solid');
  });

  it('stays solid when a hard dimension was never seen', () => {
    const ms = solidReady();
    delete ms.mcq.matrix.hard.logic;
    expect(nextMastery('solid', ms, [], false)).toBe('solid');
  });

  it('stays solid when a stress lens is not_yet', () => {
    const ms = solidReady();
    ms.stressTest.analyst = 'not_yet';
    expect(nextMastery('solid', ms, [], false)).toBe('solid');
  });

  it('stays solid when a stress lens is untested', () => {
    const ms = solidReady();
    ms.stressTest.board = 'untested';
    expect(nextMastery('solid', ms, [], false)).toBe('solid');
  });
});
