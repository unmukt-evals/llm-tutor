import { describe, it, expect } from 'vitest';
import { xpDelta, modulesReachingVerified } from '@/lib/ui/juice';
import type { Mastery } from '@/lib/types';

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
