'use client';

// src/components/studio/SourceEditClient.tsx
// Phase 5a Task 6 — client component for Source create/edit/delete.
// Owns controlled form state, fires POST/PUT/DELETE against the Studio API,
// then uses router.push + router.refresh for navigation after mutations.

import type { Source } from '@/lib/types';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  /** Existing source for edit mode; undefined for create mode. */
  source?: Source;
  /** Modules that cite this source — read-only display. Empty for create mode. */
  citingModules?: Array<{ id: string; name: string }>;
}

interface FormState {
  kind: 'url' | 'transcript' | 'doc' | 'paper';
  title: string;
  url: string;
  author: string;
  cluster: string;
  summary: string;
  thesis: string;
  mechanism: string;
  quotes: string;   // newline-separated in the textarea
  grounds: string;  // comma-separated in the input
  raw_text: string;
}

function sourceToForm(s: Source | undefined): FormState {
  if (!s) {
    return {
      kind: 'doc',
      title: '',
      url: '',
      author: '',
      cluster: '',
      summary: '',
      thesis: '',
      mechanism: '',
      quotes: '',
      grounds: '',
      raw_text: '',
    };
  }
  return {
    kind: s.kind,
    title: s.title,
    url: s.url ?? '',
    author: s.author ?? '',
    cluster: s.cluster ?? '',
    summary: s.summary ?? '',
    thesis: s.thesis ?? '',
    mechanism: s.mechanism ?? '',
    quotes: (s.quotes ?? []).join('\n'),
    grounds: (s.grounds ?? []).join(', '),
    raw_text: s.raw_text ?? '',
  };
}

function formToBody(f: FormState): Record<string, unknown> {
  const quotes = f.quotes
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);
  const grounds = f.grounds
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  return {
    kind: f.kind,
    title: f.title.trim(),
    url: f.url.trim() || undefined,
    author: f.author.trim() || undefined,
    cluster: f.cluster.trim() || undefined,
    summary: f.summary.trim() || undefined,
    thesis: f.thesis.trim() || undefined,
    mechanism: f.mechanism.trim() || undefined,
    quotes: quotes.length > 0 ? quotes : undefined,
    grounds: grounds.length > 0 ? grounds : undefined,
    raw_text: f.raw_text.trim() || undefined,
  };
}

const inputCls =
  'w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-emerald-500 focus:outline-none';
const labelCls = 'block text-xs font-medium text-neutral-400 mb-1';

export function SourceEditClient({ source, citingModules = [] }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => sourceToForm(source));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isCreate = !source;

  function set(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const url = isCreate
      ? '/api/studio/source'
      : `/api/studio/source/${source!.id}`;
    const method = isCreate ? 'POST' : 'PUT';

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToBody(form)),
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

    const j = await res.json();
    const targetId = isCreate ? j.id : source!.id;
    startTransition(() => {
      router.push(`/studio/sources/${targetId}`);
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!source) return;
    if (!confirm(`Delete source ${source.id}?`)) return;
    setError(null);

    let res: Response;
    try {
      res = await fetch(`/api/studio/source/${source.id}`, { method: 'DELETE' });
    } catch (err) {
      setError(String(err));
      return;
    }

    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }

    startTransition(() => {
      router.push('/studio/sources');
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Citing modules chip list */}
      {citingModules.length > 0 && (
        <p className="text-sm text-neutral-400">
          Cited by:{' '}
          {citingModules.map((m) => (
            <span
              key={m.id}
              className="mr-1 rounded bg-neutral-700 px-2 py-0.5 font-mono text-xs text-neutral-200"
            >
              {m.id}
            </span>
          ))}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ID — read-only in edit mode, hidden in create mode */}
        {!isCreate && (
          <div>
            <label className={labelCls}>ID</label>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm text-emerald-400">
              {source!.id}
            </div>
          </div>
        )}

        {/* Row: kind + url */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>
              Kind <span className="text-red-400">*</span>
            </label>
            <select
              value={form.kind}
              onChange={(e) => set('kind', e.target.value)}
              className={inputCls}
              required
            >
              <option value="url">url</option>
              <option value="transcript">transcript</option>
              <option value="doc">doc</option>
              <option value="paper">paper</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://..."
              className={inputCls}
            />
          </div>
        </div>

        {/* Title */}
        <div>
          <label className={labelCls}>
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Source title"
            className={inputCls}
            required
          />
        </div>

        {/* Row: author + cluster */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Author</label>
            <input
              type="text"
              value={form.author}
              onChange={(e) => set('author', e.target.value)}
              placeholder="Author name"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Cluster</label>
            <input
              type="text"
              value={form.cluster}
              onChange={(e) => set('cluster', e.target.value)}
              placeholder="e.g. Cluster 1 — RL post-training"
              className={inputCls}
            />
          </div>
        </div>

        {/* Summary */}
        <div>
          <label className={labelCls}>Summary</label>
          <textarea
            rows={3}
            value={form.summary}
            onChange={(e) => set('summary', e.target.value)}
            placeholder="Brief summary of the source"
            className={inputCls}
          />
        </div>

        {/* Thesis */}
        <div>
          <label className={labelCls}>Thesis</label>
          <textarea
            rows={4}
            value={form.thesis}
            onChange={(e) => set('thesis', e.target.value)}
            placeholder="Core thesis or argument"
            className={inputCls}
          />
        </div>

        {/* Mechanism */}
        <div>
          <label className={labelCls}>Mechanism</label>
          <textarea
            rows={4}
            value={form.mechanism}
            onChange={(e) => set('mechanism', e.target.value)}
            placeholder="Mechanism that matters"
            className={inputCls}
          />
        </div>

        {/* Quotes */}
        <div>
          <label className={labelCls}>Quotes</label>
          <textarea
            rows={4}
            value={form.quotes}
            onChange={(e) => set('quotes', e.target.value)}
            placeholder="One quote per line"
            className={inputCls}
          />
        </div>

        {/* Grounds */}
        <div>
          <label className={labelCls}>Grounds</label>
          <input
            type="text"
            value={form.grounds}
            onChange={(e) => set('grounds', e.target.value)}
            placeholder="B1, B2, B3"
            className={inputCls}
          />
        </div>

        {/* Raw text */}
        <div>
          <label className={labelCls}>Raw text</label>
          <textarea
            rows={6}
            value={form.raw_text}
            onChange={(e) => set('raw_text', e.target.value)}
            placeholder="Fetched body or pasted transcript"
            className={inputCls}
          />
        </div>

        {/* Error banner */}
        {error && (
          <div className="rounded border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Button row */}
        <div className="flex items-center gap-3">
          <Link
            href="/studio/sources"
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {!isCreate && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
