// src/components/viz/EmbeddingScatter.tsx
// The headline V-VIZ illustration: a 2D SVG scatter of precomputed embedding
// coords. Points colored by cluster; hover shows the label; an optional toggle
// draws the precomputed nearest-neighbor links. All geometry comes from the
// PURE prepareScatter helper (unit-tested) — this file is presentation only.
'use client';

import { useState } from 'react';
import type { EmbeddingScatterData } from '@/lib/types';
import { prepareScatter } from '@/lib/viz/scatter';

const WIDTH = 520;
const HEIGHT = 360;
const PADDING = 28;

export default function EmbeddingScatter({
  data,
  title,
}: {
  data: EmbeddingScatterData;
  title?: string;
}) {
  const [showLinks, setShowLinks] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const laid = prepareScatter(data, { width: WIDTH, height: HEIGHT, padding: PADDING });

  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title ?? 'Embedding space (2D projection)'}
        </span>
        {laid.links.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLinks((v) => !v)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100"
          >
            {showLinks ? 'Hide' : 'Show'} nearest neighbors
          </button>
        )}
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={title ?? 'Embedding scatter plot'}
      >
        {showLinks &&
          laid.links.map((l, i) => (
            <line
              key={`link-${i}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ))}

        {laid.points.map((p, i) => (
          <g
            key={`pt-${i}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className="cursor-default"
          >
            <circle
              cx={p.cx}
              cy={p.cy}
              r={hovered === i ? 7 : 5}
              fill={p.color}
              fillOpacity={hovered === null || hovered === i ? 0.9 : 0.35}
              className="transition-all motion-reduce:transition-none"
            />
            {hovered === i && (
              <text
                x={p.cx + 9}
                y={p.cy + 4}
                className="fill-slate-800 text-[11px]"
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Cluster legend */}
      <ul className="mt-2 flex flex-wrap gap-3">
        {laid.clusters.map((c) => (
          <li key={c.name} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            {c.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}
