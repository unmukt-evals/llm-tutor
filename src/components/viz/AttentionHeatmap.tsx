// src/components/viz/AttentionHeatmap.tsx
// Grid heatmap (for M03-style attention). Cell opacity = normalized intensity
// from the PURE prepareHeatmap helper (unit-tested). No client interactivity.
import type { AttentionHeatmapData } from '@/lib/types';
import { prepareHeatmap } from '@/lib/viz/heatmap';

export default function AttentionHeatmap({
  data,
  title,
}: {
  data: AttentionHeatmapData;
  title?: string;
}) {
  const prepared = prepareHeatmap(data);
  const cols = prepared.colLabels.length;

  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `auto repeat(${cols}, minmax(2rem, 1fr))` }}
        >
          {/* Header row: empty corner + column labels */}
          <div />
          {prepared.colLabels.map((c) => (
            <div key={`col-${c}`} className="px-1 text-center text-[10px] text-slate-500">
              {c}
            </div>
          ))}
          {/* Body rows */}
          {prepared.rowLabels.map((rowLabel, r) => (
            <RowFragment
              key={`row-${r}`}
              rowLabel={rowLabel}
              cells={prepared.cells.filter((cell) => cell.row === r)}
            />
          ))}
        </div>
      </div>
    </figure>
  );
}

function RowFragment({
  rowLabel,
  cells,
}: {
  rowLabel: string;
  cells: { col: number; value: number; intensity: number }[];
}) {
  return (
    <>
      <div className="pr-1 text-right text-[10px] leading-8 text-slate-500">{rowLabel}</div>
      {cells
        .slice()
        .sort((a, b) => a.col - b.col)
        .map((cell) => (
          <div
            key={`cell-${cell.col}`}
            title={cell.value.toFixed(3)}
            className="h-8 rounded-sm"
            style={{ backgroundColor: `rgba(37, 99, 235, ${cell.intensity})` }}
          />
        ))}
    </>
  );
}
