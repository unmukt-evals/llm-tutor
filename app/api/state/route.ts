// app/api/state/route.ts
// HTTP surface over the plan-01 StateStore (00-shared-model.md §7).
//   GET   /api/state            → TutorState (full sidecar)
//   PATCH /api/state  { path, value } → deep-set at `path`, atomic write, returns updated TutorState
// Server-only: wraps getStateStore(CURRICULUM_DIR); the sidecar is the single source of truth.

import { NextResponse } from 'next/server';
import { getStateStore } from '@/lib/state';
import { deepSet } from '@/lib/state/deep-set';
import { getCmsIndex } from '@/lib/cms';
import type { TutorState } from '@/lib/types';

// Never cache; state mutates and must be read fresh each request.
export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) {
    throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  }
  return dir;
}

export async function GET() {
  try {
    const store = getStateStore(getCurriculumDir());
    const state = await store.read();
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

interface PatchBody {
  path: string[];
  value: unknown;
}

function isValidPatchBody(body: unknown): body is PatchBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { path?: unknown }).path) &&
    (body as { path: unknown[] }).path.every((k) => typeof k === 'string')
  );
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isValidPatchBody(body)) {
    return NextResponse.json(
      { error: 'Body must be { path: string[]; value: unknown }' },
      { status: 400 }
    );
  }

  const store = getStateStore(getCurriculumDir());
  // Read-modify-write: read current state, deep-set at path (clones along the
  // path, preserving unknown keys), then atomically persist via the StateStore.
  let current: TutorState;
  try {
    current = await store.read();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  let updated: TutorState;
  try {
    updated = deepSet<TutorState>(current, body.path, body.value);
  } catch (err) {
    // deepSet throws on unsafe keys (__proto__, constructor, prototype) → 400.
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }

  try {
    await store.write(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Phase 2: keep the SQLite mirror in sync with the just-written sidecar so
  // subsequent reads via getCmsIndex().getFullState() / getModuleState() see
  // the new state without waiting for the next lazyRefresh's hash recompute.
  // The sidecar remains the source of truth — this is a cache refresh, and a
  // mirror failure must NOT fail the write the client just succeeded at.
  try {
    const cms = await getCmsIndex(getCurriculumDir());
    await cms.reindexState();
  } catch (err) {
    console.warn(`[api/state] reindexState failed (sidecar write succeeded): ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json(updated);
}
