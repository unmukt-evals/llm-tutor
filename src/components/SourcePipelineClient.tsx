// src/components/SourcePipelineClient.tsx
// Review-gate UI for the source pipeline. Steps: (1) input source (URL → fetch,
// or paste a transcript) + optional target module; (2) Generate → a Candidate;
// (3) Verify → a VerificationReport; (4) review the DIFF (old → proposed module +
// pool) and the report; (5) Accept & apply → write. Nothing writes without the
// Accept click. Thin: all logic lives in the tested cores + client wrappers.
'use client';

import { useState } from 'react';
import {
  postFetch,
  postGenerate,
  postVerify,
  postApply,
  type GenerateResult,
} from '@/lib/source/api-client';
import { diffLines, type DiffLine } from '@/lib/source/diff';
import type { VerificationReport } from '@/lib/llm/types';

function DiffView({
  oldText,
  newText,
  label,
}: {
  oldText: string;
  newText: string;
  label: string;
}) {
  const lines: DiffLine[] = diffLines(oldText, newText);
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
      <pre className="mt-1 max-h-96 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'add'
                ? 'bg-green-100 text-green-900'
                : l.kind === 'remove'
                  ? 'bg-red-100 text-red-900 line-through'
                  : 'text-slate-600'
            }
          >
            {l.kind === 'add' ? '+ ' : l.kind === 'remove' ? '- ' : '  '}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ReportView({ report }: { report: VerificationReport }) {
  const verdictColor =
    report.overallVerdict === 'looks-sound'
      ? 'text-green-700'
      : report.overallVerdict === 'reject'
        ? 'text-red-700'
        : 'text-amber-700';
  return (
    <div className="mt-4 rounded border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-700">
        Verification (independent third-pass)
      </h3>
      <p className={`mt-1 text-sm font-medium ${verdictColor}`}>
        Verdict: {report.overallVerdict} — {report.summary}
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {report.claims.map((c, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={
                c.status === 'verified'
                  ? 'text-green-700'
                  : c.status === 'contradicted'
                    ? 'text-red-700'
                    : 'text-amber-700'
              }
            >
              [{c.status}]
            </span>
            <span className="text-slate-700">
              {c.claim}
              {c.note ? ` — ${c.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SourcePipelineClient() {
  const [url, setUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [targetModuleId, setTargetModuleId] = useState('');
  const [gen, setGen] = useState<GenerateResult | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const discard = () => {
    setGen(null);
    setReport(null);
    setApplied(null);
    setError(null);
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-bold text-slate-900">Add a source</h1>
      <p className="mt-1 text-sm text-slate-600">
        Drop a URL (fetched server-side) or paste a transcript. The LLM proposes a module + MCQ
        pool grounded in the source; an independent pass verifies it; you review a diff and accept.
        Nothing is written until you click Accept &amp; apply.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="https://… (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-slate-800 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!url || busy !== null}
          onClick={() => run('fetch', async () => setSourceText(await postFetch(url)))}
        >
          {busy === 'fetch' ? 'Fetching…' : 'Fetch URL'}
        </button>
      </div>

      <textarea
        className="mt-3 h-48 w-full rounded border border-slate-300 p-2 font-mono text-xs"
        placeholder="…or paste a transcript / source text here"
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
      />

      <div className="mt-3 flex items-center gap-2">
        <input
          className="w-56 rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="Target module id (blank = new)"
          value={targetModuleId}
          onChange={(e) => setTargetModuleId(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!sourceText.trim() || busy !== null}
          onClick={() =>
            run('generate', async () => {
              setReport(null);
              setApplied(null);
              setGen(await postGenerate(sourceText, targetModuleId || undefined));
            })
          }
        >
          {busy === 'generate' ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {gen && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Proposed: {gen.candidate.moduleId}
              {gen.moduleFileName ? ' (update)' : ' (new module)'}
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded bg-purple-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={busy !== null}
                onClick={() =>
                  run('verify', async () => setReport(await postVerify(gen.candidate, sourceText)))
                }
              >
                {busy === 'verify' ? 'Verifying…' : 'Run verification'}
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                disabled={busy !== null}
                onClick={() =>
                  run('generate', async () => {
                    setReport(null);
                    setApplied(null);
                    setGen(await postGenerate(sourceText, targetModuleId || undefined));
                  })
                }
              >
                {busy === 'generate' ? 'Regenerating…' : 'Regenerate'}
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                disabled={busy !== null}
                onClick={discard}
              >
                Discard
              </button>
            </div>
          </div>

          {report && <ReportView report={report} />}

          <DiffView
            label="Module markdown"
            oldText={gen.oldMarkdown}
            newText={gen.candidate.markdown}
          />
          <DiffView label="MCQ pool" oldText={gen.oldPoolJson} newText={gen.candidate.poolJson} />

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy !== null || applied !== null}
              onClick={() =>
                run('apply', async () => {
                  const w = await postApply(gen.candidate, gen.moduleFileName);
                  setApplied(`Applied → ${w.moduleFile} + ${w.poolFile}`);
                })
              }
            >
              {busy === 'apply' ? 'Applying…' : 'Accept & apply'}
            </button>
            {applied && <span className="text-sm font-medium text-green-700">{applied}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
