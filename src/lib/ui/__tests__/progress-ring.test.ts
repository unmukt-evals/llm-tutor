import { describe, it, expect } from 'vitest';
import { ringVisual, ringGeometry, RING_COLORS } from '@/lib/ui/progress-ring';

describe('ringVisual', () => {
  it('maps blank → fraction 0', () => {
    const v = ringVisual('blank');
    expect(v.fraction).toBe(0);
    expect(v.color).toBe(RING_COLORS.blank);
    expect(v.label).toBe('Not started');
  });

  it('maps fuzzy → fraction 1/3', () => {
    const v = ringVisual('fuzzy');
    expect(v.fraction).toBeCloseTo(1 / 3, 10);
    expect(v.color).toBe(RING_COLORS.fuzzy);
    expect(v.label).toBe('Fuzzy');
  });

  it('maps solid → fraction 2/3', () => {
    const v = ringVisual('solid');
    expect(v.fraction).toBeCloseTo(2 / 3, 10);
    expect(v.color).toBe(RING_COLORS.solid);
    expect(v.label).toBe('Solid');
  });

  it('maps verified → fraction 1', () => {
    const v = ringVisual('verified');
    expect(v.fraction).toBe(1);
    expect(v.color).toBe(RING_COLORS.verified);
    expect(v.label).toBe('Verified');
  });

  it('open diagnosis overrides color to the diagnosis token but keeps mastery fraction', () => {
    const v = ringVisual('fuzzy', true);
    expect(v.fraction).toBeCloseTo(1 / 3, 10);
    expect(v.color).toBe(RING_COLORS.openDiagnosis);
    expect(v.label).toBe('Needs attention');
  });

  it('open diagnosis on a blank module still shows fraction 0 with the diagnosis color', () => {
    const v = ringVisual('blank', true);
    expect(v.fraction).toBe(0);
    expect(v.color).toBe(RING_COLORS.openDiagnosis);
    expect(v.label).toBe('Needs attention');
  });

  it('every fraction is within [0,1]', () => {
    for (const m of ['blank', 'fuzzy', 'solid', 'verified'] as const) {
      const v = ringVisual(m);
      expect(v.fraction).toBeGreaterThanOrEqual(0);
      expect(v.fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('ringGeometry', () => {
  it('computes circumference from radius', () => {
    const g = ringGeometry(10, 0.5);
    expect(g.circumference).toBeCloseTo(2 * Math.PI * 10, 10);
  });

  it('fraction 0 → dashoffset === circumference (nothing shown)', () => {
    const g = ringGeometry(10, 0);
    expect(g.dashOffset).toBeCloseTo(g.circumference, 10);
  });

  it('fraction 1 → dashoffset 0 (full circle shown)', () => {
    const g = ringGeometry(10, 1);
    expect(g.dashOffset).toBeCloseTo(0, 10);
  });

  it('fraction 0.5 → dashoffset is half the circumference', () => {
    const g = ringGeometry(10, 0.5);
    expect(g.dashOffset).toBeCloseTo(g.circumference / 2, 10);
  });

  it('clamps out-of-range fractions to [0,1]', () => {
    expect(ringGeometry(10, -1).dashOffset).toBeCloseTo(ringGeometry(10, 0).circumference, 10);
    expect(ringGeometry(10, 5).dashOffset).toBeCloseTo(0, 10);
  });
});
