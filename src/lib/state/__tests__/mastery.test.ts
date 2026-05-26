import { describe, it, expect } from 'vitest';
import { nextMastery } from '@/lib/state/mastery';
import { defaultModuleState } from '@/lib/state/defaults';
import type { ModuleState, NextMastery } from '@/lib/types';

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

describe('nextMastery — does not regress or skip ahead (Task 11 scope)', () => {
  it('leaves an already-fuzzy module fuzzy (fuzzy→solid is Task 12)', () => {
    const ms = withCells(defaultModuleState(), {
      easy: { topic: { seen: 1, correct: 1 } },
      medium: { logic: { seen: 1, correct: 1 } },
      hard: { topic: { seen: 1, correct: 1 } },
    });
    expect(nextMastery('fuzzy', ms, ['tenYearOld', 'engineer', 'operator'], true)).toBe('fuzzy');
  });

  it('leaves a solid module solid (solid→verified is Task 12)', () => {
    const ms = withCells(defaultModuleState(), {
      hard: {
        topic: { seen: 1, correct: 1 },
        logic: { seen: 1, correct: 1 },
        example: { seen: 1, correct: 1 },
        extension: { seen: 1, correct: 1 },
      },
    });
    expect(nextMastery('solid', ms, ['tenYearOld', 'engineer', 'operator'], true)).toBe('solid');
  });

  it('leaves a verified module verified', () => {
    expect(nextMastery('verified', defaultModuleState(), [], false)).toBe('verified');
  });
});
