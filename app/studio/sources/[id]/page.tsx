// app/studio/sources/[id]/page.tsx
// Phase 5a Task 6 — Source detail/edit page.
// Server component: loads Source + citing modules from getCmsIndex,
// then hydrates <SourceEditClient> with the initial data.
// Next 15: params is a Promise and must be awaited.

import { notFound } from 'next/navigation';
import { getCmsIndex } from '@/lib/cms';
import { SourceEditClient } from '@/components/studio/SourceEditClient';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SourceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);

  const source = cms.getSourceById(id);
  if (!source) notFound();

  const citingModules = cms.getModulesForSource(id);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">
        Edit source ·{' '}
        <span className="font-mono text-emerald-400">{source.id}</span>
      </h1>
      <SourceEditClient source={source} citingModules={citingModules} />
    </div>
  );
}
