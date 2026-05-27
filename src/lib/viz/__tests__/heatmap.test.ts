import { describe, it, expect } from 'vitest';
import { prepareHeatmap } from '@/lib/viz/heatmap';
import type { AttentionHeatmapData } from '@/lib/types';

const data: AttentionHeatmapData = {
  rowLabels: ['The', 'cat'],
  colLabels: ['The', 'cat'],
  matrix: [
    [0, 1],
    [2, 4],
  ],
};

describe('prepareHeatmap', () => {
  it('emits one cell per matrix entry with row/col indices + raw value', () => {
    const out = prepareHeatmap(data);
    expect(out.cells.length).toBe(4);
    const c = out.cells.find((x) => x.row === 1 && x.col === 1)!;
    expect(c.value).toBe(4);
  });

  it('normalizes intensity to 0..1 against the matrix max', () => {
    const out = prepareHeatmap(data);
    const max = out.cells.find((x) => x.value === 4)!;
    const min = out.cells.find((x) => x.value === 0)!;
    const mid = out.cells.find((x) => x.value === 2)!;
    expect(max.intensity).toBeCloseTo(1);
    expect(min.intensity).toBeCloseTo(0);
    expect(mid.intensity).toBeCloseTo(0.5);
  });

  it('handles an all-zero matrix without NaN (intensity 0)', () => {
    const out = prepareHeatmap({
      rowLabels: ['a'],
      colLabels: ['b'],
      matrix: [[0]],
    });
    expect(out.cells[0].intensity).toBe(0);
  });

  it('passes through the labels', () => {
    const out = prepareHeatmap(data);
    expect(out.rowLabels).toEqual(['The', 'cat']);
    expect(out.colLabels).toEqual(['The', 'cat']);
  });
});
