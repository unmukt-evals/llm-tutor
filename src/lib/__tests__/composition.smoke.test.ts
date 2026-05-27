// Task 16 — end-to-end composition smoke test.
// Proves the S-INGEST + S-STATE foundation composes through the PUBLIC §7
// barrels (getCurriculumRepository / getStateStore) — not the impls directly.
// Loads the fixture curriculum into a temp dir, parses it, then round-trips a
// ModuleState through the JSON sidecar. No real Obsidian folder is touched.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getCurriculumRepository } from '@/lib/ingest';
import { getStateStore } from '@/lib/state';

const FIXTURE = resolve(__dirname, '../ingest/__tests__/fixtures/B01-sample.md');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'llmtutor-compose-'));
  await copyFile(FIXTURE, join(dir, 'B01-sample.md'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('foundation composition (public barrels)', () => {
  it('loads the curriculum and round-trips state, never writing a .md', async () => {
    // S-INGEST: load the fixture curriculum via the §7 factory.
    const repo = getCurriculumRepository();
    const curriculum = await repo.load(dir);
    expect(curriculum.modules.map((m) => m.id)).toEqual(['B01']);
    const mod = curriculum.byId('B01');
    expect(mod?.passes.engineer).toContain('pins prompts, decoding, and scoring');

    // S-STATE: default read, mutate the loaded module's state, atomic write, reload.
    const store = getStateStore(dir);
    const state = await store.read();
    expect(state.version).toBe(1);
    state.xp.total = 42;
    state.modules[mod!.id] = { ...(await store.getModule(mod!.id)), mastery: 'fuzzy' };
    await store.write(state);

    const reloaded = await store.read();
    expect(reloaded.xp.total).toBe(42);
    expect(reloaded.modules.B01.mastery).toBe('fuzzy');
    expect((await store.getModule('B01')).mastery).toBe('fuzzy');

    // Contract: the sidecar exists, no leftover tmp, and the .md is untouched.
    const files = await readdir(dir);
    expect(files).toContain('_llmtutor-state.json');
    expect(files).toContain('B01-sample.md');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});
