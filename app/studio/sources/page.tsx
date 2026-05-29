// app/studio/sources/page.tsx
// Sources list page — Phase 5a Task 5.
// Server component. Lists all sources from getCmsIndex, with a per-row
// citation count from getModulesForSource. Empty state shows a friendly
// message instead of an empty table.

import { getCmsIndex } from '@/lib/cms';
import Link from 'next/link';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export default async function SourcesListPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const sources = cms.getSources();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sources ({sources.length})</h1>
        <Link
          href="/studio/sources/new"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500"
        >
          + Add source
        </Link>
      </div>

      {sources.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No sources yet — click <strong className="text-white">+ Add source</strong> to create one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-800/50 text-left text-xs uppercase text-neutral-400">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Cluster</th>
                <th className="px-3 py-2">Cited by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {sources.map((s) => {
                const citing = cms.getModulesForSource(s.id);
                return (
                  <tr key={s.id} className="hover:bg-neutral-800/40">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link
                        href={`/studio/sources/${s.id}`}
                        className="text-emerald-400 hover:underline"
                      >
                        {s.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{s.title}</td>
                    <td className="px-3 py-2 text-neutral-400">{s.kind}</td>
                    <td className="px-3 py-2 text-neutral-400">{s.cluster ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-400">
                      {citing.length > 0 ? citing.map((m) => m.id).join(', ') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
