// src/lib/api-client.ts
// Thin fetch wrappers for /api/state — used by client components only.
// Server components call StateStore directly; never import this from server code.

import type { TutorState } from './types';

const BASE = '/api/state';

/** Fetch the full TutorState from the sidecar. */
export async function fetchState(): Promise<TutorState> {
  const res = await fetch(BASE, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchState: ${res.status} ${res.statusText}`);
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
  if (!res.ok) throw new Error(`patchState: ${res.status} ${res.statusText}`);
  return res.json() as Promise<TutorState>;
}
