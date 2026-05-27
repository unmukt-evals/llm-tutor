// src/lib/api-client.ts
// Thin fetch wrappers for /api/state — used by client components only.
// Server components call StateStore directly; never import this from server code.

import type { TutorState } from './types';

const BASE = '/api/state';

/** Extract the server's `{error}` message from a non-2xx response, if present. */
async function extractErrorMessage(res: Response, prefix: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') {
      return `${prefix}: ${res.status} — ${body.error}`;
    }
  } catch {
    // body was not JSON; fall through to status-text fallback
  }
  return `${prefix}: ${res.status} ${res.statusText}`;
}

/** Fetch the full TutorState from the sidecar. */
export async function fetchState(): Promise<TutorState> {
  const res = await fetch(BASE, { cache: 'no-store' });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'fetchState'));
  return res.json() as Promise<TutorState>;
}

/**
 * Apply a deep patch to the sidecar.
 * `path` is an array of keys, e.g. ['modules', 'B01', 'mastery'].
 * `value` is the new value at that path.
 * Returns the updated TutorState.
 */
export async function patchState(path: string[], value: unknown): Promise<TutorState> {
  const res = await fetch(BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, value }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res, 'patchState'));
  return res.json() as Promise<TutorState>;
}
