import { describe, it, expect } from 'vitest';
import { prepareScatter } from '@/lib/viz/scatter';
import type { EmbeddingScatterData } from '@/lib/types';

const data: EmbeddingScatterData = {
  points: [
    { label: 'bank', x: 0, y: 0, cluster: 'finance' },
    { label: 'JPMorgan', x: 10, y: 10, cluster: 'finance' },
    { label: 'AI agent', x: -10, y: -10, cluster: 'ai' },
  ],
  links: [{ from: 0, to: 1 }],
};

describe('prepareScatter', () => {
  it('maps data extremes to the padded plot box corners', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    // min x (-10) → left edge (padding); max x (10) → right edge (width-padding)
    const minX = out.points.find((p) => p.label === 'AI agent')!;
    const maxX = out.points.find((p) => p.label === 'JPMorgan')!;
    expect(minX.cx).toBeCloseTo(10);
    expect(maxX.cx).toBeCloseTo(90);
  });

  it('inverts the y axis (SVG y grows downward): max data-y → top', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    const maxY = out.points.find((p) => p.label === 'JPMorgan')!; // y=10 (max)
    const minY = out.points.find((p) => p.label === 'AI agent')!; // y=-10 (min)
    expect(maxY.cy).toBeCloseTo(10); // top
    expect(minY.cy).toBeCloseTo(90); // bottom
  });

  it('assigns a stable color per cluster (same cluster → same color)', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    const bank = out.points.find((p) => p.label === 'bank')!;
    const jpm = out.points.find((p) => p.label === 'JPMorgan')!;
    const ai = out.points.find((p) => p.label === 'AI agent')!;
    expect(bank.color).toBe(jpm.color);
    expect(bank.color).not.toBe(ai.color);
  });

  it('resolves link index pairs to laid-out endpoints', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    expect(out.links.length).toBe(1);
    const l = out.links[0];
    expect(l.x1).toBeCloseTo(out.points[0].cx);
    expect(l.y1).toBeCloseTo(out.points[0].cy);
    expect(l.x2).toBeCloseTo(out.points[1].cx);
    expect(l.y2).toBeCloseTo(out.points[1].cy);
  });

  it('handles a degenerate axis (all x equal) by centering', () => {
    const flat: EmbeddingScatterData = {
      points: [
        { label: 'a', x: 5, y: 0, cluster: 'c' },
        { label: 'b', x: 5, y: 4, cluster: 'c' },
      ],
    };
    const out = prepareScatter(flat, { width: 100, height: 100, padding: 10 });
    // both x equal → centered horizontally at (width)/2
    expect(out.points[0].cx).toBeCloseTo(50);
    expect(out.points[1].cx).toBeCloseTo(50);
  });

  it('drops links whose indices are out of range', () => {
    const out = prepareScatter(
      { points: data.points, links: [{ from: 0, to: 99 }] },
      { width: 100, height: 100, padding: 10 },
    );
    expect(out.links).toEqual([]);
  });
});
