// src/lib/viz/bars.ts
// PURE helper for <BarCompare>. Computes each bar's width as a fraction (0..1)
// of the largest absolute value, NaN-safe for all-zero input. No DOM, no React.

import type { BarCompareData } from '@/lib/types';

export interface PreparedBar {
  label: string;
  value: number;
  fraction: number; // 0..1, relative to max |value|
}
export interface PreparedBars {
  bars: PreparedBar[];
  unit?: string;
}

export function prepareBars(data: BarCompareData): PreparedBars {
  const maxAbs = data.bars.reduce((m, b) => Math.max(m, Math.abs(b.value)), 0);
  const bars: PreparedBar[] = data.bars.map((b) => ({
    label: b.label,
    value: b.value,
    fraction: maxAbs === 0 ? 0 : Math.abs(b.value) / maxAbs,
  }));
  const out: PreparedBars = { bars };
  if (data.unit !== undefined) out.unit = data.unit;
  return out;
}
