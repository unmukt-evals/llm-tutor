// app/studio/modules/page.tsx
// Phase 5b — Studio Modules list.
// Server component: reads from getCmsIndex, shows id / track / name /
// primary-sources count / has-pool flag. Click a row to edit.

import { getCmsIndex } from '@/lib/cms';
import Link from 'next/link';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export default async function ModulesListPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const curriculum = cms.getCurriculum();
  const poolIds = new Set(cms.getPoolIds());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Modules ({curriculum.modules.length})</h1>
      </div>

      {curriculum.modules.length === 0 ? (
        <p className="text-sm text-slate-500">
          No modules yet — author one in Obsidian or run the source pipeline.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Track</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Primary sources</th>
                <th className="px-3 py-2">Pool</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {curriculum.modules.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/studio/modules/${m.id}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {m.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{m.track}</td>
                  <td className="px-3 py-2">{m.name}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {m.primarySources.length > 0 ? m.primarySources.join(', ') : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {poolIds.has(m.id) ? (
                      <Link
                        href={`/studio/pools/${m.id}`}
                        className="text-emerald-700 hover:underline"
                      >
                        edit pool
                      </Link>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
