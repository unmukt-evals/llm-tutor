import { describe, it, expect } from 'vitest';
import { prepareBars } from '@/lib/viz/bars';
import type { BarCompareData } from '@/lib/types';

const data: BarCompareData = {
  bars: [
    { label: 'ada-002', value: 50 },
    { label: 'embed-3', value: 100 },
  ],
  unit: '%',
};

describe('prepareBars', () => {
  it('computes width fraction (0..1) against the max value', () => {
    const out = prepareBars(data);
    expect(out.bars[0].fraction).toBeCloseTo(0.5);
    expect(out.bars[1].fraction).toBeCloseTo(1);
  });

  it('passes through label, value, and unit', () => {
    const out = prepareBars(data);
    expect(out.bars[0].label).toBe('ada-002');
    expect(out.bars[0].value).toBe(50);
    expect(out.unit).toBe('%');
  });

  it('handles all-zero values without NaN (fraction 0)', () => {
    const out = prepareBars({ bars: [{ label: 'a', value: 0 }] });
    expect(out.bars[0].fraction).toBe(0);
    expect(out.unit).toBeUndefined();
  });

  it('supports negative max gracefully by using absolute scale', () => {
    const out = prepareBars({ bars: [{ label: 'a', value: -2 }, { label: 'b', value: -4 }] });
    // max abs = 4 → b is full, a is half
    expect(out.bars[1].fraction).toBeCloseTo(1);
    expect(out.bars[0].fraction).toBeCloseTo(0.5);
  });
});
