'use client';

// src/components/studio/CardsEditClient.tsx
// Phase 5c — client editor for the raw `_flashcards.md` deck.
// Two panes:
//   left  — controlled <textarea> bound to the markdown body.
//   right — read-only preview: total card count + breakdown by module track.
// Save → PUT /api/studio/cards with { markdown }. 4xx/5xx surface a red banner.
// On success: router.refresh so the server re-parses and rehydrates the
// preview pane (and the dashboard count).

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  initialMarkdown: string;
  initialCount: number;
  /** Cards-per-track breakdown for the preview pane. */
  byTrack: Record<string, number>;
}

export function CardsEditClient({ initialMarkdown, initialCount, byTrack }: Props) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState<string>(initialMarkdown);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = markdown !== initialMarkdown;

  async function handleSave() {
    setError(null);
    let res: Response;
    try {
      res = await fetch('/api/studio/cards', {
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

  const trackEntries = Object.entries(byTrack).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Markdown — `_flashcards.md`
          </label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            rows={30}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <aside className="space-y-2 text-sm">
          <div className="rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">
              Parse preview
            </h2>
            <dl className="space-y-1 text-xs">
              <Row label="Total cards" value={String(initialCount)} mono />
              {trackEntries.length === 0 ? (
                <Row label="By module" value="—" />
              ) : (
                trackEntries.map(([mod, n]) => (
                  <Row key={mod} label={mod || '(no module)'} value={String(n)} mono />
                ))
              )}
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
        <Link href="/studio" className="text-sm text-slate-500 hover:text-slate-700">
          Back to Studio
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
