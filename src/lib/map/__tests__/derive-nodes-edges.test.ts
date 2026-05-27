import { describe, it, expect } from 'vitest';
import { deriveNodesEdges } from '@/lib/map/derive-nodes-edges';
import type { Curriculum, Module, ModuleState, TutorState, TrackId, Mastery } from '@/lib/types';

// Minimal fixture factory — fields match the ACTUAL src/lib/types.ts (incl. §7 reconciliations).
function makeModule(overrides: Partial<Module> & { id: string; track: TrackId }): Module {
  return {
    id: overrides.id,
    track: overrides.track,
    name: overrides.name ?? `Module ${overrides.id}`,
    prerequisites: overrides.prerequisites ?? [],
    primarySources: overrides.primarySources ?? [],
    whyThisMatters: overrides.whyThisMatters ?? 'why',
    anchors: overrides.anchors ?? [],
    passes: overrides.passes ?? {},
    diagrams: overrides.diagrams ?? [], // §7: Diagram[] (kind + body), not string[]
    drills: overrides.drills ?? [],
    stressTests: overrides.stressTests ?? [],
    flashcardSeeds: overrides.flashcardSeeds ?? [],
    sources: overrides.sources ?? [],
  };
}

function makeCurriculum(modules: Module[]): Curriculum {
  return {
    tracks: ['A', 'B'],
    modules,
    byId: (id: string) => modules.find((m) => m.id === id),
  };
}

function makeModuleState(mastery: Mastery): ModuleState {
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
      recentCorrect: [], // §7: anti-farm source (required by ActUAL ModuleState)
    },
    stressTest: {},
  };
}

function makeState(moduleEntries: Record<string, Mastery>): TutorState {
  return {
    version: 1,
    modules: Object.fromEntries(
      Object.entries(moduleEntries).map(([id, mastery]) => [id, makeModuleState(mastery)])
    ),
    flashcards: {},
    xp: { total: 0, thisWeek: 0 },
    streak: { count: 0, lastActive: '', freezeTokens: 0 },
    sessionLog: [],
  };
}

describe('deriveNodesEdges', () => {
  it('produces one node per module', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B' }),
    ]);
    const state = makeState({ A01: 'blank', B01: 'fuzzy' });
    const { nodes } = deriveNodesEdges(curriculum, state);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['A01', 'B01']));
  });

  it('colors nodes by mastery', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'A02', track: 'A' }),
      makeModule({ id: 'A03', track: 'A' }),
      makeModule({ id: 'A04', track: 'A' }),
    ]);
    const state = makeState({
      A01: 'blank',
      A02: 'fuzzy',
      A03: 'solid',
      A04: 'verified',
    });
    const { nodes } = deriveNodesEdges(curriculum, state);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['A01'].style?.background).toBe('#e2e8f0');
    expect(byId['A02'].style?.background).toBe('#fef9c3');
    expect(byId['A03'].style?.background).toBe('#bbf7d0');
    expect(byId['A04'].style?.background).toBe('#6ee7b7');
  });

  it('carries mastery through onto node.data', () => {
    const curriculum = makeCurriculum([makeModule({ id: 'A01', track: 'A' })]);
    const state = makeState({ A01: 'solid' });
    const { nodes } = deriveNodesEdges(curriculum, state);
    expect(nodes[0].data.mastery).toBe('solid');
    expect(nodes[0].data.label).toBe('Module A01');
  });

  it('places track A nodes at x=80, track B at x=400', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B' }),
    ]);
    const state = makeState({ A01: 'blank', B01: 'blank' });
    const { nodes } = deriveNodesEdges(curriculum, state);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['A01'].position.x).toBe(80);
    expect(byId['B01'].position.x).toBe(400);
  });

  it('places track C nodes at x=720', () => {
    const curriculum = makeCurriculum([makeModule({ id: 'C01', track: 'C' })]);
    const state = makeState({ C01: 'blank' });
    const { nodes } = deriveNodesEdges(curriculum, state);
    expect(nodes[0].position.x).toBe(720);
  });

  it('stacks nodes vertically within each track at 120px intervals (per-track index)', () => {
    // Interleave tracks to prove the vertical index is PER-TRACK, not global.
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B' }),
      makeModule({ id: 'A02', track: 'A' }),
      makeModule({ id: 'B02', track: 'B' }),
    ]);
    const state = makeState({ A01: 'blank', B01: 'blank', A02: 'blank', B02: 'blank' });
    const { nodes } = deriveNodesEdges(curriculum, state);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['A01'].position.y).toBe(0);
    expect(byId['A02'].position.y).toBe(120);
    expect(byId['B01'].position.y).toBe(0);
    expect(byId['B02'].position.y).toBe(120);
  });

  it('produces dashed soft-lock edges for prerequisites', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B', prerequisites: ['A01'] }),
    ]);
    const state = makeState({ A01: 'blank', B01: 'blank' });
    const { edges } = deriveNodesEdges(curriculum, state);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe('A01->B01');
    expect(edges[0].source).toBe('A01');
    expect(edges[0].target).toBe('B01');
    expect(edges[0].type).toBe('default');
    expect(edges[0].style?.stroke).toBe('#94a3b8');
    expect(edges[0].style?.strokeDasharray).toBe('5 5');
  });

  it('produces no edges when no prerequisites', () => {
    const curriculum = makeCurriculum([makeModule({ id: 'A01', track: 'A' })]);
    const state = makeState({ A01: 'blank' });
    const { edges } = deriveNodesEdges(curriculum, state);
    expect(edges).toHaveLength(0);
  });

  it('drops dangling edges whose prerequisite module is not present', () => {
    // B01 lists prereq 'Z99' which is not in the curriculum → no dangling edge.
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B', prerequisites: ['A01', 'Z99'] }),
    ]);
    const state = makeState({ A01: 'blank', B01: 'blank' });
    const { edges } = deriveNodesEdges(curriculum, state);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe('A01->B01');
  });

  it('defaults to blank color/mastery for a module with no state entry', () => {
    const curriculum = makeCurriculum([makeModule({ id: 'A01', track: 'A' })]);
    const state = makeState({}); // no entry for A01
    const { nodes } = deriveNodesEdges(curriculum, state);
    expect(nodes[0].data.mastery).toBe('blank');
    expect(nodes[0].style?.background).toBe('#e2e8f0');
  });
});
