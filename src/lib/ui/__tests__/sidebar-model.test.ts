import { describe, it, expect } from 'vitest';
import { buildSidebarModel } from '@/lib/ui/sidebar-model';
import type { Curriculum, Module, TutorState, Mastery } from '@/lib/types';

function mod(id: string, track: 'A' | 'B' | 'C', name: string): Module {
  return {
    id,
    track,
    name,
    prerequisites: [],
    primarySources: [],
    whyThisMatters: 'x',
    anchors: [],
    passes: {},
    diagrams: [],
    visuals: [],
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}

function curriculum(modules: Module[]): Curriculum {
  return {
    tracks: ['A', 'B'],
    modules,
    byId: (id) => modules.find((m) => m.id === id),
  };
}

function stateWith(mastery: Record<string, Mastery>, openDiag: string[] = []): TutorState {
  const modules: TutorState['modules'] = {};
  for (const [id, level] of Object.entries(mastery)) {
    modules[id] = {
      mastery: level,
      masteryHistory: [],
      mcq: {
        matrix: { easy: {}, medium: {}, hard: {} },
        distractorLog: [],
        dimensionProfile: { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' },
        recentCorrect: [],
        ...(openDiag.includes(id)
          ? {
              openDiagnosis: {
                dimension: 'topic',
                confidence: 0.5,
                evidence: { qids: [], recurringMisconceptions: [] },
                remediation: 'drill',
                openedAt: '2026-05-27',
              },
            }
          : {}),
      },
      stressTest: {},
    };
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

describe('buildSidebarModel', () => {
  it('groups modules by track and preserves curriculum order within a track', () => {
    const cur = curriculum([
      mod('A01', 'A', 'Alpha'),
      mod('B01', 'B', 'Beta'),
      mod('A02', 'A', 'Gamma'),
    ]);
    const model = buildSidebarModel(cur, stateWith({}));
    expect(model.map((g) => g.track)).toEqual(['A', 'B']);
    const trackA = model.find((g) => g.track === 'A')!;
    expect(trackA.rows.map((r) => r.id)).toEqual(['A01', 'A02']);
  });

  it('defaults missing module state to blank mastery and no open diagnosis', () => {
    const cur = curriculum([mod('A01', 'A', 'Alpha')]);
    const model = buildSidebarModel(cur, stateWith({}));
    const row = model[0].rows[0];
    expect(row.mastery).toBe('blank');
    expect(row.openDiagnosis).toBe(false);
    expect(row.name).toBe('Alpha');
  });

  it('reads mastery and open-diagnosis from state', () => {
    const cur = curriculum([mod('A01', 'A', 'Alpha'), mod('A02', 'A', 'Beta')]);
    const model = buildSidebarModel(cur, stateWith({ A01: 'verified', A02: 'fuzzy' }, ['A02']));
    const rows = model[0].rows;
    expect(rows[0]).toMatchObject({ id: 'A01', mastery: 'verified', openDiagnosis: false });
    expect(rows[1]).toMatchObject({ id: 'A02', mastery: 'fuzzy', openDiagnosis: true });
  });

  it('omits tracks that have no modules', () => {
    const cur = curriculum([mod('A01', 'A', 'Alpha')]);
    const model = buildSidebarModel(cur, stateWith({}));
    expect(model.map((g) => g.track)).toEqual(['A']);
  });
});
