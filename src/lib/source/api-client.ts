// src/lib/source/api-client.ts
// Browser-only fetch wrappers for /api/source/*. Mirrors src/lib/api-client.ts.
// NEVER import from server code. The server never returns the access token, so
// none of these response shapes carry it.
'use client';

import type { Candidate, VerificationReport } from '@/lib/llm/types';
import type { SourceInput } from '@/lib/source/apply-source';

/** Extract the server's `{error}` message from a non-2xx response, if present. */
async function errMsg(res: Response, prefix: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return `${prefix}: ${res.status} — ${body.error}`;
  } catch {
    /* body was not JSON */
  }
  return `${prefix}: ${res.status} ${res.statusText}`;
}

/** POST a URL to be fetched + text-extracted server-side. */
export async function postFetch(url: string): Promise<string> {
  const res = await fetch('/api/source/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'postFetch'));
  return ((await res.json()) as { text: string }).text;
}

export interface GenerateResult {
  candidate: Candidate;
  oldMarkdown: string;
  oldPoolJson: string;
  moduleFileName: string | null;
}

/** POST source text (+ optional target module) to generate a Candidate. */
export async function postGenerate(
  sourceText: string,
  targetModuleId?: string,
): Promise<GenerateResult> {
  const res = await fetch('/api/source/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceText, targetModuleId }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'postGenerate'));
  return (await res.json()) as GenerateResult;
}

/** POST a candidate + source for the independent verification third-pass. */
export async function postVerify(
  candidate: Candidate,
  sourceText: string,
): Promise<VerificationReport> {
  const res = await fetch('/api/source/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate, sourceText }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'postVerify'));
  return ((await res.json()) as { report: VerificationReport }).report;
}

/**
 * POST a candidate to be re-validated + atomically written (the ONLY write).
 *
 * @param candidate      The candidate to apply.
 * @param moduleFileName The file to write the module markdown to, or null.
 * @param source         Optional source metadata to persist as a Source entity
 *                       alongside the module. Legacy callers that omit it keep
 *                       working — the source is simply not recorded.
 */
export async function postApply(
  candidate: Candidate,
  moduleFileName: string | null,
  source?: SourceInput,
): Promise<{ moduleFile: string; poolFile: string }> {
  const res = await fetch('/api/source/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate, moduleFileName, source }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'postApply'));
  return ((await res.json()) as { written: { moduleFile: string; poolFile: string } }).written;
}
