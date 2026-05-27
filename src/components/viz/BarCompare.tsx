// src/components/viz/BarCompare.tsx
// Labeled horizontal bars (for benchmark-style numbers). Bar width = fraction
// from the PURE prepareBars helper (unit-tested). No client interactivity.
import type { BarCompareData } from '@/lib/types';
import { prepareBars } from '@/lib/viz/bars';

export default function BarCompare({
  data,
  title,
}: {
  data: BarCompareData;
  title?: string;
}) {
  const prepared = prepareBars(data);

  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </figcaption>
      )}
      <ul className="space-y-2">
        {prepared.bars.map((b) => (
          <li key={b.label} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 truncate text-slate-700" title={b.label}>
              {b.label}
            </span>
            <span className="relative h-5 flex-1 rounded bg-slate-100">
              <span
                className="absolute inset-y-0 left-0 rounded bg-blue-500 transition-all motion-reduce:transition-none"
                style={{ width: `${(b.fraction * 100).toFixed(1)}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-slate-600">
              {b.value}
              {prepared.unit ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
