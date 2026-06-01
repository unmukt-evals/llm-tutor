// app/studio/pools/[id]/page.tsx
// Phase 5b — Studio Pool editor.
// Server component: loads raw mcq/<id>.json from disk + parsed MCQPool from
// CmsIndex, hydrates <PoolEditClient> with both. Next 15: params is a
// Promise and must be awaited.

import { notFound } from 'next/navigation';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getCmsIndex } from '@/lib/cms';
import { PoolEditClient } from '@/components/studio/PoolEditClient';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PoolEditPage({ params }: PageProps) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const pool = cms.getPool(id);
  if (!pool) notFound();

  let poolJson: string;
  try {
    poolJson = await readFile(join(dir, 'mcq', `${id}.json`), 'utf8');
  } catch {
    notFound();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">
        Edit pool · <span className="font-mono text-emerald-700">{id}</span>{' '}
        <span className="text-base font-normal text-slate-500">
          {pool.questions.length} question{pool.questions.length === 1 ? '' : 's'}
        </span>
      </h1>
      <PoolEditClient id={id} initialJson={poolJson} initialPool={pool} />
    </div>
  );
}
