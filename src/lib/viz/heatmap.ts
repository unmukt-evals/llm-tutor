// src/lib/viz/heatmap.ts
// PURE helper for <AttentionHeatmap>. Flattens the matrix into per-cell records
// with normalized intensity (value / matrixMax, clamped, NaN-safe) so the
// component just maps intensity → opacity. No DOM, no React.

import type { AttentionHeatmapData } from '@/lib/types';

export interface HeatmapCell {
  row: number;
  col: number;
  value: number;
  intensity: number; // 0..1
}
export interface PreparedHeatmap {
  rowLabels: string[];
  colLabels: string[];
  cells: HeatmapCell[];
}

export function prepareHeatmap(data: AttentionHeatmapData): PreparedHeatmap {
  let max = 0;
  for (const row of data.matrix) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  const cells: HeatmapCell[] = [];
  data.matrix.forEach((row, r) => {
    row.forEach((value, c) => {
      cells.push({
        row: r,
        col: c,
        value,
        intensity: max === 0 ? 0 : value / max,
      });
    });
  });
  return { rowLabels: data.rowLabels, colLabels: data.colLabels, cells };
}
