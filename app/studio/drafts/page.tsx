// app/studio/drafts/page.tsx
// Phase 5c — Drafts hub. The draft pipeline (URL fetch → LLM generate → diff →
// verify → apply) is a transient in-session flow; there is no persistent draft
// queue. This page is an entry point that explains that and links into
// /studio/drafts/new where the actual pipeline lives.

import Link from 'next/link';

export const metadata = { title: 'LLM Tutor — Studio — Drafts' };

export default function DraftsHubPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Drafts</h1>
        <Link
          href="/studio/drafts/new"
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          + Start new draft
        </Link>
      </div>
      <p className="text-sm text-slate-600">
        Drafts are transient: each session starts a new draft, accepts or rejects it, then moves on.
        There is no queue — sources, modules, pools, and cards are the durable surfaces.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Click <strong className="text-slate-900">Start new draft</strong> to fetch a URL, run the
        LLM generator, review the diff, and apply.
      </div>
    </div>
  );
}
