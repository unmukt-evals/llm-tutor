// app/module/[id]/assess/page.tsx
// Server component: MCQ diagnostic assessment page (plan-03 wiring).
//
// Loads the module's MCQ pool via the FileMCQRepository factory and the module's
// persisted state via the StateStore, then hands both — as serializable props —
// to the client <McqRunner/>, which owns the (already-tested) diagnostic engine.
//
// Next 15: dynamic `params` is a Promise and must be awaited.
//
// Graceful empty states (never throws — that would break `next build`, which
// renders this route):
//   - CURRICULUM_DIR unset           → friendly "no curriculum loaded" message
//   - no mcq/<id>.json authored yet  → "no assessment authored" + link back
//   - else                           → render the runner

import Link from 'next/link';
import { McqRunner } from '@/components/McqRunner';
import { getMcqRepository } from '@/lib/mcq';
import { getStateStore } from '@/lib/state';

interface PageProps {
  // Next 15: dynamic route params are async.
  params: Promise<{ id: string }>;
}

export default async function AssessPage({ params }: PageProps) {
  const { id } = await params;

  const curriculumDir = process.env.CURRICULUM_DIR;
  if (!curriculumDir) {
    return (
      <main className="mx-auto max-w-xl px-6 py-8">
        <div className="rounded border-l-4 border-red-400 bg-red-50 p-4 text-sm font-medium text-red-700">
          No curriculum loaded. Set the{' '}
          <code className="rounded bg-red-100 px-1 py-0.5">CURRICULUM_DIR</code>{' '}
          environment variable to point at your curriculum folder, then reload.
        </div>
      </main>
    );
  }

  const [pool, moduleState] = await Promise.all([
    getMcqRepository(curriculumDir).loadPool(id),
    getStateStore(curriculumDir).getModule(id),
  ]);

  if (!pool) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-6 py-8">
        <h1 className="text-xl font-semibold text-slate-800">Assessment</h1>
        <p className="rounded-lg bg-slate-100 p-4 text-sm italic text-slate-500">
          No assessment authored for this module yet.
        </p>
        <Link
          href={`/module/${id}`}
          className="inline-block text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
        >
          &larr; Back to the module
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href={`/module/${id}`}
        className="inline-block text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800"
      >
        &larr; Back to the module
      </Link>
      <McqRunner moduleId={id} pool={pool} state={moduleState} />
    </main>
  );
}
