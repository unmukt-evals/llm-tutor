'use client';

// src/components/studio/PoolEditClient.tsx
// Phase 5b — client editor for a single MCQ pool's raw JSON.
// Two panes:
//   left  — controlled <textarea> bound to the raw JSON string
//   right — read-only summary (question count, first stem, difficulty mix)
// Save → PUT /api/studio/pool/[id] with { poolJson }. The body is sent as a
// STRING so the API can re-validate the exact bytes that will hit disk.

import type { MCQPool, Difficulty } from '@/lib/types';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  initialJson: string;
  /** Server-parsed pool for the summary pane. */
  initialPool: MCQPool;
}

export function PoolEditClient({ id, initialJson, initialPool }: Props) {
  const router = useRouter();
  const [poolJson, setPoolJson] = useState<string>(initialJson);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = poolJson !== initialJson;

  async function handleSave() {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`/api/studio/pool/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolJson }),
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
    setPoolJson(initialJson);
    setError(null);
  }

  // Difficulty mix derived from the SERVER-parsed pool — only updates on save +
  // router.refresh, same rationale as ModuleEditClient.
  const diffCounts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const q of initialPool.questions) diffCounts[q.difficulty]++;
  const firstStem = initialPool.questions[0]?.stem ?? '—';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Pool JSON
          </label>
          <textarea
            value={poolJson}
            onChange={(e) => setPoolJson(e.target.value)}
            spellCheck={false}
            rows={30}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <aside className="space-y-2 text-sm">
          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">
              Pool summary
            </h2>
            <dl className="space-y-1 text-xs">
              <Row label="Module ID" value={initialPool.moduleId} mono />
              <Row label="Questions" value={String(initialPool.questions.length)} mono />
              <Row label="Easy" value={String(diffCounts.easy)} mono />
              <Row label="Medium" value={String(diffCounts.medium)} mono />
              <Row label="Hard" value={String(diffCounts.hard)} mono />
            </dl>
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-xs font-semibold uppercase text-slate-500">
                First question
              </p>
              <p className="mt-1 text-xs text-slate-700">{firstStem}</p>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Save to re-validate against the production guardrails.
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
        <Link href="/studio/pools" className="text-sm text-slate-500 hover:text-slate-700">
          Back to pools
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
