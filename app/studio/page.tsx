// app/studio/page.tsx
// Studio dashboard — Phase 5a skeleton, expanded in 5b.
// Shows live counts for Sources, Modules, and Pools (all 5b-active), plus a
// faded Drafts placeholder until Phase 5c absorbs it. Reads via getCmsIndex —
// zero network, O(1) from the SQLite mirror.

import { getCmsIndex } from '@/lib/cms';
import Link from 'next/link';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

export default async function StudioDashboardPage() {
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const sources = cms.getSources();
  const curriculum = cms.getCurriculum();
  const poolIds = cms.getPoolIds();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Studio</h1>
      <p className="text-sm text-slate-600">Authoring surface for the LLM Tutor curriculum.</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <DashboardCard href="/studio/sources" label="Sources" count={sources.length} />
        <DashboardCard
          href="/studio/modules"
          label="Modules"
          count={curriculum.modules.length}
        />
        <DashboardCard href="/studio/pools" label="Pools" count={poolIds.length} />
        <DashboardCard href="#" label="Drafts" count={null} faded />
      </div>
    </div>
  );
}

function DashboardCard({
  href,
  label,
  count,
  faded = false,
}: {
  href: string;
  label: string;
  count: number | null;
  faded?: boolean;
}) {
  const content = (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${
        faded ? 'opacity-50' : 'hover:shadow-md hover:border-slate-300'
      }`}
    >
      <div className="text-sm text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{count ?? '—'}</div>
    </div>
  );
  return faded ? <>{content}</> : <Link href={href}>{content}</Link>;
}
