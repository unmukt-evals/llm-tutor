// app/studio/modules/[id]/page.tsx
// Phase 5b — Studio Module editor.
// Server component: loads raw markdown from disk + parsed Module from
// CmsIndex, hydrates <ModuleEditClient> with both. Next 15: params is a
// Promise and must be awaited.

import { notFound } from 'next/navigation';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getCmsIndex } from '@/lib/cms';
import { ModuleEditClient } from '@/components/studio/ModuleEditClient';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

async function resolveModulePath(dir: string, id: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const hit = entries.find(
    (f) =>
      f.endsWith('.md') &&
      !f.startsWith('_') &&
      (f === `${id}.md` || f.startsWith(`${id}-`)),
  );
  return hit ? join(dir, hit) : null;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ModuleEditPage({ params }: PageProps) {
  const { id } = await params;
  const dir = getCurriculumDir();
  const cms = await getCmsIndex(dir);
  const mod = cms.getModule(id);
  if (!mod) notFound();

  const path = await resolveModulePath(dir, id);
  if (!path) notFound();
  const markdown = await readFile(path, 'utf8');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">
        Edit module · <span className="font-mono text-emerald-700">{mod.id}</span>{' '}
        <span className="text-base font-normal text-slate-500">{mod.name}</span>
      </h1>
      <ModuleEditClient id={mod.id} initialMarkdown={markdown} initialModule={mod} />
    </div>
  );
}
