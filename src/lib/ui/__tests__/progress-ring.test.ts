import { describe, it, expect } from 'vitest';
import { ringVisual, RING_COLORS } from '@/lib/ui/progress-ring';

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
