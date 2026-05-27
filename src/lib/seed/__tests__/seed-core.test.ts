import { describe, it, expect } from 'vitest';
// The seed migration's pure logic lives in scripts/seed-core.mjs (plain ESM so
// the plain-node CLI can run it). It is imported here so the level-mapping and
// idempotent-merge logic are covered by the repo's Vitest gate, and asserted
// to stay structurally identical to the app's own state defaults.
import {
  levelToMastery,
  buildSeededModuleState,
  buildSeededTutorState,
  mergeModules,
  moduleFromFrontmatter,
  VALID_MASTERY,
} from '../core';
import { defaultModuleState, defaultTutorState } from '@/lib/state/defaults';
import type { Mastery } from '@/lib/types';

const NOW = '2026-05-27T00:00:00.000Z';

describe('levelToMastery', () => {
  it('passes through the four valid levels (case-insensitive)', () => {
    for (const m of VALID_MASTERY) {
      expect(levelToMastery(m)).toBe(m);
      expect(levelToMastery(m.toUpperCase())).toBe(m);
      expect(levelToMastery(`"${m}"`)).toBe(m);
    }
  });

  it('maps null / undefined / empty / "null" / "none" → "blank"', () => {
    expect(levelToMastery(null)).toBe('blank');
    expect(levelToMastery(undefined)).toBe('blank');
    expect(levelToMastery('')).toBe('blank');
    expect(levelToMastery('   ')).toBe('blank');
    expect(levelToMastery('null')).toBe('blank');
    expect(levelToMastery('none')).toBe('blank');
  });

  it('maps unknown strings → "blank" (non-destructive default)', () => {
    expect(levelToMastery('not_started')).toBe('blank');
    expect(levelToMastery('wizard')).toBe('blank');
  });
});

describe('moduleFromFrontmatter', () => {
  it('extracts module_id + level from nested baseline_state', () => {
    expect(
      moduleFromFrontmatter({ module_id: 'B01', baseline_state: { current_level: 'fuzzy' } }),
    ).toEqual({ moduleId: 'B01', level: 'fuzzy' });
  });

  it('treats null current_level as blank', () => {
    expect(
      moduleFromFrontmatter({ module_id: 'M03', baseline_state: { current_level: null } }),
    ).toEqual({ moduleId: 'M03', level: 'blank' });
  });

  it('handles missing baseline_state', () => {
    expect(moduleFromFrontmatter({ module_id: 'M00' })).toEqual({ moduleId: 'M00', level: 'blank' });
  });

  it('returns null when there is no module_id (e.g. _progress.md)', () => {
    expect(moduleFromFrontmatter({ last_session: null })).toBeNull();
    expect(moduleFromFrontmatter({ module_id: '' })).toBeNull();
    expect(moduleFromFrontmatter(null as unknown as Record<string, unknown>)).toBeNull();
  });

  it('preserves dotted ids like M0.5', () => {
    expect(moduleFromFrontmatter({ module_id: 'M0.5' })).toEqual({ moduleId: 'M0.5', level: 'blank' });
  });
});

describe('buildSeededModuleState — shape parity with the app default', () => {
  it('a blank seed equals defaultModuleState() exactly', () => {
    expect(buildSeededModuleState('blank', NOW)).toEqual(defaultModuleState());
  });

  it('a non-blank seed differs only in mastery + one masteryHistory entry', () => {
    const seeded = buildSeededModuleState('solid', NOW);
    const def = defaultModuleState();
    expect(seeded.mastery).toBe('solid');
    expect(seeded.masteryHistory).toEqual([{ level: 'solid', at: NOW, via: 'seed-sidecar-migration' }]);
    // everything else identical to the default
    expect(seeded.mcq).toEqual(def.mcq);
    expect(seeded.stressTest).toEqual(def.stressTest);
  });
});

describe('buildSeededTutorState — shape parity with the app default', () => {
  it('an empty-modules build equals defaultTutorState() exactly', () => {
    expect(buildSeededTutorState({})).toEqual(defaultTutorState());
  });
});

describe('mergeModules — idempotent / non-destructive', () => {
  it('seeds fresh modules when no existing state', () => {
    const { modules, actions } = mergeModules({}, { B01: 'blank', M00: 'fuzzy' }, NOW);
    expect(Object.keys(modules).sort()).toEqual(['B01', 'M00']);
    expect(modules.B01.mastery).toBe('blank');
    expect(modules.M00.mastery).toBe('fuzzy');
    expect(actions).toEqual([
      { id: 'B01', action: 'seeded', mastery: 'blank' },
      { id: 'M00', action: 'seeded', mastery: 'fuzzy' },
    ]);
  });

  it('PRESERVES an existing non-blank mastery (never regresses earned progress)', () => {
    const earned = {
      B01: { ...defaultModuleState(), mastery: 'verified' as Mastery, stressTest: { board: 'passed' as const } },
    };
    const { modules, actions } = mergeModules(earned, { B01: 'blank' }, NOW);
    // The whole earned object is preserved untouched.
    expect(modules.B01).toBe(earned.B01);
    expect(modules.B01.mastery).toBe('verified');
    expect(actions).toEqual([{ id: 'B01', action: 'preserved', mastery: 'verified' }]);
  });

  it('overwrites (re-seeds) when existing mastery is blank', () => {
    const existing = { B01: { ...defaultModuleState(), mastery: 'blank' as Mastery } };
    const { modules, actions } = mergeModules(existing, { B01: 'fuzzy' }, NOW);
    expect(modules.B01.mastery).toBe('fuzzy');
    expect(actions).toEqual([{ id: 'B01', action: 'seeded', mastery: 'fuzzy' }]);
  });

  it('carries forward existing modules absent from the current scan', () => {
    const existing = { LEGACY: { ...defaultModuleState(), mastery: 'solid' as Mastery } };
    const { modules, actions } = mergeModules(existing, { B01: 'blank' }, NOW);
    expect(Object.keys(modules).sort()).toEqual(['B01', 'LEGACY']);
    expect(modules.LEGACY.mastery).toBe('solid');
    expect(actions).toContainEqual({ id: 'LEGACY', action: 'carried', mastery: 'solid' });
  });

  it('is idempotent: re-running over its own output is a no-op for non-blank', () => {
    const first = mergeModules({}, { B01: 'fuzzy', M00: 'blank' }, NOW).modules;
    const second = mergeModules(first, { B01: 'blank', M00: 'blank' }, NOW);
    // B01 (fuzzy) preserved; M00 (blank) re-seeded blank → unchanged shape.
    expect(second.modules.B01.mastery).toBe('fuzzy');
    expect(second.modules.M00.mastery).toBe('blank');
    expect(second.actions).toEqual([
      { id: 'B01', action: 'preserved', mastery: 'fuzzy' },
      { id: 'M00', action: 'seeded', mastery: 'blank' },
    ]);
  });
});
