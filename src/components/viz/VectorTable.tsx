// src/components/viz/VectorTable.tsx
// Styled token → example-dims table (the "token embeddings table", not ASCII).
// Pure pass-through of validated VectorTableData; no client interactivity needed.
import type { VectorTableData } from '@/lib/types';

export default function VectorTable({
  data,
  title,
}: {
  data: VectorTableData;
  title?: string;
}) {
  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-2 py-1 font-medium">token</th>
              {data.dims.map((d) => (
                <th key={d} className="px-2 py-1 text-right font-mono font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.token} className="border-b border-slate-100">
                <td className="px-2 py-1 font-medium text-slate-800">{row.token}</td>
                {row.values.map((v, i) => (
                  <td key={i} className="px-2 py-1 text-right font-mono text-slate-600">
                    {v.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
