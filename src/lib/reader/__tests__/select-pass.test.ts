import { describe, it, expect } from 'vitest';
import { resolvePass, DEPTH_OPTIONS } from '../select-pass';
import type { Module } from '@/lib/types';

function makeModule(passes: Partial<Record<string, string>>): Module {
  return {
    id: 'T01',
    track: 'A',
    name: 'Test',
    prerequisites: [],
    primarySources: [],
    whyThisMatters: 'matters',
    anchors: [],
    passes: passes as Module['passes'],
    diagrams: [],
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}

describe('DEPTH_OPTIONS', () => {
  it('has three options in order: Dumb it down, Engineer, Make it matter', () => {
    expect(DEPTH_OPTIONS.map((o) => o.label)).toEqual([
      'Dumb it down',
      'Engineer',
      'Make it matter',
    ]);
  });

  it('maps labels to correct DepthPass keys', () => {
    const byLabel = Object.fromEntries(DEPTH_OPTIONS.map((o) => [o.label, o.key]));
    expect(byLabel['Dumb it down']).toBe('tenYearOld');
    expect(byLabel['Engineer']).toBe('engineer');
    expect(byLabel['Make it matter']).toBe('operator');
  });

  it('marks Engineer as the default', () => {
    const def = DEPTH_OPTIONS.find((o) => o.isDefault);
    expect(def?.key).toBe('engineer');
  });

  it('marks exactly one option as the default', () => {
    expect(DEPTH_OPTIONS.filter((o) => o.isDefault)).toHaveLength(1);
  });
});

describe('resolvePass', () => {
  it('returns authored content when pass is present', () => {
    const mod = makeModule({ engineer: '# Engineer content' });
    const result = resolvePass(mod, 'engineer');
    expect(result.key).toBe('engineer');
    expect(result.authored).toBe(true);
    expect(result.content).toBe('# Engineer content');
  });

  it('returns authored=false when pass is absent', () => {
    const mod = makeModule({});
    const result = resolvePass(mod, 'tenYearOld');
    expect(result.key).toBe('tenYearOld');
    expect(result.authored).toBe(false);
    expect(result.content).toBeUndefined();
  });

  it('returns authored=false when pass is empty string', () => {
    const mod = makeModule({ operator: '' });
    const result = resolvePass(mod, 'operator');
    expect(result.authored).toBe(false);
    expect(result.content).toBeUndefined();
  });

  it('returns authored=false when pass is whitespace only', () => {
    const mod = makeModule({ operator: '   \n\t  ' });
    const result = resolvePass(mod, 'operator');
    expect(result.authored).toBe(false);
  });

  it('resolves each authored pass independently', () => {
    const mod = makeModule({
      tenYearOld: 'simple',
      engineer: 'technical',
      operator: 'business',
    });
    expect(resolvePass(mod, 'tenYearOld').content).toBe('simple');
    expect(resolvePass(mod, 'engineer').content).toBe('technical');
    expect(resolvePass(mod, 'operator').content).toBe('business');
  });
});
