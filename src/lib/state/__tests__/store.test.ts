import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStateStore } from '@/lib/state/store';
import { getStateStore } from '@/lib/state';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'llmtutor-state-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('JsonStateStore.read', () => {
  it('returns a default v1 state when the sidecar is missing', async () => {
    const store = new JsonStateStore(dir);
    const s = await store.read();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
    expect(s.streak.freezeTokens).toBe(1);
  });

  it('reads an existing sidecar', async () => {
    const seed = {
      version: 1,
      modules: { B01: { mastery: 'solid' } },
      flashcards: {},
      xp: { total: 99, thisWeek: 10 },
      streak: { count: 3, lastActive: '2026-05-01', freezeTokens: 0 },
      sessionLog: [],
    };
    await writeFile(join(dir, '_llmtutor-state.json'), JSON.stringify(seed), 'utf8');
    const store = new JsonStateStore(dir);
    const s = await store.read();
    expect(s.xp.total).toBe(99);
    expect(s.modules.B01.mastery).toBe('solid');
  });

  it('returns a default state when the sidecar is unparseable JSON', async () => {
    await writeFile(join(dir, '_llmtutor-state.json'), '{ not valid json ]]', 'utf8');
    const store = new JsonStateStore(dir);
    const s = await store.read();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
    expect(s.streak.freezeTokens).toBe(1);
  });

  it('returns a default state when the sidecar parses to a non-object (e.g. null)', async () => {
    await writeFile(join(dir, '_llmtutor-state.json'), 'null', 'utf8');
    const store = new JsonStateStore(dir);
    const s = await store.read();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
  });
});

describe('JsonStateStore.getModule', () => {
  it('returns a default blank ModuleState when the id is absent', async () => {
    const store = new JsonStateStore(dir);
    const ms = await store.getModule('NEW01');
    expect(ms.mastery).toBe('blank');
    expect(ms.mcq.dimensionProfile.topic).toBe('untested');
  });

  it('returns the stored ModuleState when present', async () => {
    const store = new JsonStateStore(dir);
    const s = await store.read();
    s.modules.B01 = { ...(await store.getModule('B01')), mastery: 'fuzzy' };
    await store.write(s);
    const ms = await store.getModule('B01');
    expect(ms.mastery).toBe('fuzzy');
  });
});

describe('getStateStore factory', () => {
  it('returns a StateStore reading the sidecar in the given dir', async () => {
    const store = getStateStore(dir);
    const s = await store.read();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
  });
});
