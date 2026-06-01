// app/studio/pools/page.tsx
// Phase 5b — Studio Pools list.
// Server component: shows one row per indexed pool with question count and
// has-module flag. Click into a row to edit the raw JSON.

import { getCmsIndex } from '@/lib/cms';
import Link from 'next/link';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export default async function PoolsListPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const poolIds = cms.getPoolIds();

  // Index for has-module-file? lookup.
  const modulesById = new Map(cms.getCurriculum().modules.map((m) => [m.id, m]));

  const rows = poolIds.map((id) => {
    const pool = cms.getPool(id);
    const mod = modulesById.get(id);
    return {
      id,
      questionCount: pool?.questions.length ?? 0,
      moduleName: mod?.name,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pools ({rows.length})</h1>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No MCQ pools yet — generate one via the source pipeline or hand-author
          a <code className="font-mono text-xs">mcq/&lt;id&gt;.json</code>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Module ID</th>
                <th className="px-3 py-2">Module name</th>
                <th className="px-3 py-2">Questions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/studio/pools/${r.id}`}
                      className="text-emerald-700 hover:underline"
                    >
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.moduleName ?? (
                      <span className="text-amber-700">orphan pool (no module file)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{r.questionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
