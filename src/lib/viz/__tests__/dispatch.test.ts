import { describe, it, expect } from 'vitest';
import { vizComponentName } from '@/lib/viz/dispatch';
import type { VizType } from '@/lib/types';

describe('vizComponentName', () => {
  it('maps each viz type to its component name', () => {
    expect(vizComponentName('embedding-scatter')).toBe('EmbeddingScatter');
    expect(vizComponentName('vector-table')).toBe('VectorTable');
    expect(vizComponentName('attention-heatmap')).toBe('AttentionHeatmap');
    expect(vizComponentName('bar-compare')).toBe('BarCompare');
  });

  it('covers every VizType (no missing case)', () => {
    const all: VizType[] = [
      'embedding-scatter',
      'vector-table',
      'attention-heatmap',
      'bar-compare',
    ];
    for (const t of all) {
      expect(typeof vizComponentName(t)).toBe('string');
    }
  });
});
