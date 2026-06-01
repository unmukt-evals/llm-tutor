'use client';

// src/components/studio/ModuleEditClient.tsx
// Phase 5b — client editor for a single Module's raw markdown.
// Two panes:
//   left  — controlled <textarea> bound to the markdown body
//   right — read-only parse preview (id, track, name, pass titles, visuals
//           count). The preview is derived from the SERVER-parsed Module on
//           initial mount; after a save the page calls router.refresh() so
//           the server re-parses and rehydrates the preview.
// Save → PUT /api/studio/module/[id] with { markdown }. 4xx/5xx surface a
// red error banner. On success: router.push back to the modules list +
// router.refresh.

import type { Module } from '@/lib/types';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  initialMarkdown: string;
  /** Server-parsed Module for the parse preview pane. */
  initialModule: Module;
}

export function ModuleEditClient({ id, initialMarkdown, initialModule }: Props) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState<string>(initialMarkdown);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = markdown !== initialMarkdown;

  async function handleSave() {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/studio/module/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
    } catch (err) {
      setError(String(err));
      return;
    }

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  function handleDiscard() {
    setMarkdown(initialMarkdown);
    setError(null);
  }

  // Derive a compact pass-title list for the preview pane from the server-parsed
  // Module. This is intentionally NOT recomputed client-side as the user types —
  // re-parsing on every keystroke would just duplicate the server validator and
  // diverge over time. Save → router.refresh re-hydrates from server.
  const passTitles: string[] = [];
  if (initialModule.passes.tenYearOld) passTitles.push('10-year-old');
  if (initialModule.passes.engineer) passTitles.push('Engineer');
  if (initialModule.passes.operator) passTitles.push('Operator');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Editor pane (2/3 on wide screens) */}
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Markdown
          </label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            rows={30}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Parse preview pane */}
        <aside className="space-y-2 text-sm">
          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">
              Parse preview
            </h2>
            <dl className="space-y-1 text-xs">
              <Row label="ID" value={initialModule.id} mono />
              <Row label="Track" value={initialModule.track} mono />
              <Row label="Name" value={initialModule.name} />
              <Row
                label="Prereqs"
                value={initialModule.prerequisites.join(', ') || '—'}
                mono
              />
              <Row
                label="Sources"
                value={initialModule.primarySources.join(', ') || '—'}
                mono
              />
              <Row
                label="Passes"
                value={passTitles.length > 0 ? passTitles.join(' · ') : '—'}
              />
              <Row label="Visuals" value={String(initialModule.visuals.length)} mono />
              <Row label="Drills" value={String(initialModule.drills.length)} mono />
              <Row label="Diagrams" value={String(initialModule.diagrams.length)} mono />
              <Row
                label="Flashcards"
                value={String(initialModule.flashcardSeeds.length)}
                mono
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Save to re-parse against the production validator.
            </p>
          </div>
        </aside>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link href="/studio/modules" className="text-sm text-slate-500 hover:text-slate-700">
          Back to modules
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!isDirty || isPending}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`text-right text-slate-900 ${mono ? 'font-mono' : ''} max-w-[60%] truncate`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
