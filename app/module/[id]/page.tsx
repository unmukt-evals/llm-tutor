// app/module/[id]/page.tsx
// Server component: module reader (S-READER, plan-02 Task 9).
//
// Loads the curriculum via CurriculumRepository and finds the module by the
// dynamic [id] segment. Next 15 makes `params` a Promise — it must be awaited.
//
// Renders the "Why this matters" stake banner (with a visible warning when the
// module did not author one), an anchor card listing the module's anchor
// scenarios, and the interactive <ModuleReaderClient> which owns the depth
// toggle + pass body + diagram pane. All depth-pass resolution runs through the
// already-tested resolvePass helper inside the client wrapper.
//
// CURRICULUM_DIR is read server-side. A missing value yields a friendly empty
// state (mirrors app/page.tsx) rather than throwing — throwing would break
// `next build`, which compiles this route.

import { notFound } from 'next/navigation';
import ModuleReaderClient from '@/components/ModuleReaderClient';
import { getCurriculumRepository } from '@/lib/ingest';

interface PageProps {
  // Next 15: dynamic route params are async.
  params: Promise<{ id: string }>;
}

export default async function ModuleReaderPage({ params }: PageProps) {
  const { id } = await params;

  const curriculumDir = process.env.CURRICULUM_DIR;
  if (!curriculumDir) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="rounded border-l-4 border-red-400 bg-red-50 p-4 text-sm font-medium text-red-700">
          No curriculum loaded. Set the{' '}
          <code className="rounded bg-red-100 px-1 py-0.5">CURRICULUM_DIR</code>{' '}
          environment variable to point at your curriculum folder, then reload.
        </div>
      </main>
    );
  }

  const repo = getCurriculumRepository();
  const curriculum = await repo.load(curriculumDir);
  const mod = curriculum.byId(id);
  if (!mod) notFound();

  // `module` is the reserved word in some contexts; alias for clarity in JSX.
  const m = mod;
  const hasStake = Boolean(m.whyThisMatters && m.whyThisMatters.trim());

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      {/* Why this matters — the stake banner. Absent stake is a visible warning
          per the build-spec contract (whyThisMatters is required). */}
      {hasStake ? (
        <section className="rounded border-l-4 border-amber-400 bg-amber-50 p-4 text-slate-800">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
            Why this matters
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {m.whyThisMatters}
          </p>
        </section>
      ) : (
        <section className="rounded border-l-4 border-red-400 bg-red-50 p-4 text-sm font-medium text-red-700">
          &#9888; &ldquo;Why this matters&rdquo; stake not authored for this module.
        </section>
      )}

      {/* Module title */}
      <h1 className="text-2xl font-semibold text-slate-900">{m.name}</h1>

      {/* Anchor card — lists the module's anchor scenarios. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Anchor scenarios
        </h2>
        {m.anchors.length > 0 ? (
          <ul className="space-y-2 rounded-lg bg-slate-100 p-4 text-sm text-slate-700">
            {m.anchors.map((anchor, i) => (
              <li key={i} className="whitespace-pre-wrap leading-relaxed">
                {anchor}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-slate-100 p-4 text-sm italic text-slate-500">
            No anchor scenarios authored for this module.
          </p>
        )}
      </section>

      {/* Depth toggle + pass body + diagrams — client interactive. */}
      <ModuleReaderClient module={m} />
    </main>
  );
}
