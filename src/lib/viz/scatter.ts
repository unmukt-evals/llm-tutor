// src/lib/viz/scatter.ts
// PURE layout helper for <EmbeddingScatter>. Maps precomputed data-space (x,y)
// into an SVG plot box: x → [padding, width-padding], y INVERTED so larger
// data-y is nearer the top (SVG y grows downward). Colors are assigned per
// cluster from a fixed palette (stable + deterministic by first-seen order).
// Degenerate axes (all values equal) center on that axis. No DOM, no React.

import type { EmbeddingScatterData } from '@/lib/types';

export interface ScatterOpts {
  width: number;
  height: number;
  padding: number;
}

export interface LaidOutPoint {
  label: string;
  cluster: string;
  cx: number;
  cy: number;
  color: string;
}
export interface LaidOutLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface PreparedScatter {
  points: LaidOutPoint[];
  links: LaidOutLink[];
  clusters: { name: string; color: string }[];
}

// Fixed, colorblind-friendly-ish palette. Cycles if clusters > palette length.
const PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#db2777', // pink
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
];

function scale(value: number, min: number, max: number, lo: number, hi: number): number {
  if (max === min) return (lo + hi) / 2; // degenerate axis → center
  return lo + ((value - min) / (max - min)) * (hi - lo);
}

export function prepareScatter(
  data: EmbeddingScatterData,
  opts: ScatterOpts,
): PreparedScatter {
  const { width, height, padding } = opts;
  const xs = data.points.map((p) => p.x);
  const ys = data.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Stable per-cluster colors by first-seen order.
  const colorByCluster = new Map<string, string>();
  for (const p of data.points) {
    if (!colorByCluster.has(p.cluster)) {
      colorByCluster.set(p.cluster, PALETTE[colorByCluster.size % PALETTE.length]);
    }
  }

  const points: LaidOutPoint[] = data.points.map((p) => ({
    label: p.label,
    cluster: p.cluster,
    cx: scale(p.x, minX, maxX, padding, width - padding),
    // INVERT y: max data-y → top (padding); min data-y → bottom (height-padding)
    cy: scale(p.y, minY, maxY, height - padding, padding),
    color: colorByCluster.get(p.cluster)!,
  }));

  const links: LaidOutLink[] = (data.links ?? [])
    .filter(
      (l) =>
        l.from >= 0 &&
        l.from < points.length &&
        l.to >= 0 &&
        l.to < points.length,
    )
    .map((l) => ({
      x1: points[l.from].cx,
      y1: points[l.from].cy,
      x2: points[l.to].cx,
      y2: points[l.to].cy,
    }));

  const clusters = [...colorByCluster.entries()].map(([name, color]) => ({
    name,
    color,
  }));

  return { points, links, clusters };
}
