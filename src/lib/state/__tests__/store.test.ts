import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStateStore } from '@/lib/state/store';
import { getStateStore } from '@/lib/state';
import { defaultTutorState } from '@/lib/state/defaults';
import type { TutorState } from '@/lib/types';

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

  it('returns a valid default-shaped state when the sidecar is a JSON array', async () => {
    await writeFile(join(dir, '_llmtutor-state.json'), '[]', 'utf8');
    const store = new JsonStateStore(dir);
    const s = await store.read();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
    expect(s.streak).toBeDefined();
    expect(s.xp).toBeDefined();
    expect(s.sessionLog).toBeDefined();
  });

  it('merges a partial object sidecar with defaults so all top-level keys exist', async () => {
    await writeFile(join(dir, '_llmtutor-state.json'), JSON.stringify({ version: 1 }), 'utf8');
    const store = new JsonStateStore(dir);
    const s = await store.read();
    expect(s.version).toBe(1);
    expect(s.modules).toEqual({});
    expect(s.flashcards).toBeDefined();
    expect(s.xp).toBeDefined();
    expect(s.streak).toBeDefined();
    expect(s.sessionLog).toBeDefined();
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

describe('JsonStateStore.write — atomicity + write target', () => {
  // A non-default, fully-populated state exercises the round-trip on real data,
  // not just an empty default.
  function richState(): TutorState {
    const s = defaultTutorState();
    s.xp = { total: 250, thisWeek: 40 };
    s.streak = { count: 7, lastActive: '2026-05-27', freezeTokens: 0 };
    s.flashcards['B01-c01'] = { lastTested: '2026-05-20', intervalDays: 14, ease: 'good' };
    s.modules.B01 = {
      mastery: 'verified',
      masteryHistory: [
        { level: 'fuzzy', at: '2026-05-10', via: 'mcq' },
        { level: 'verified', at: '2026-05-25', via: 'stress-test' },
      ],
      mcq: {
        matrix: { easy: { topic: { seen: 3, correct: 3 } }, medium: {}, hard: { logic: { seen: 2, correct: 2 } } },
        distractorLog: [{ qid: 'B01-q1', chose: 2, at: '2026-05-11' }],
        dimensionProfile: { topic: 'solid', logic: 'solid', example: 'fuzzy', extension: 'solid' },
        recentCorrect: [{ qid: 'B01-q5', at: '2026-05-24' }],
      },
      stressTest: { board: 'passed', researcher: 'passed', analyst: 'passed' },
    };
    s.sessionLog = [{ module: 'B01', at: '2026-05-25', events: ['read:engineer', 'mcq:6'] }];
    return s;
  }

  it('round-trips a non-default state through write then read (deep-equal)', async () => {
    const store = new JsonStateStore(dir);
    const s = richState();
    await store.write(s);

    const reloaded = await store.read();
    expect(reloaded).toEqual(s);
    expect(reloaded.xp.total).toBe(250);
    expect(reloaded.modules.B01.mastery).toBe('verified');
    expect(reloaded.modules.B01.mcq.matrix.hard.logic?.correct).toBe(2);
    expect(reloaded.flashcards['B01-c01'].intervalDays).toBe(14);
    expect(reloaded.streak.count).toBe(7);
  });

  it('leaves no leftover .tmp file after a successful write', async () => {
    const store = new JsonStateStore(dir);
    await store.write(await store.read());
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(files).toContain('_llmtutor-state.json');
  });

  it('only ever writes the sidecar JSON — never a .md file', async () => {
    const store = new JsonStateStore(dir);
    await store.write(await store.read());
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.md'))).toBe(false);
  });

  it('produces pretty-printed JSON (2-space indent) for diff-readability', async () => {
    const store = new JsonStateStore(dir);
    await store.write(await store.read());
    const raw = await readFile(join(dir, '_llmtutor-state.json'), 'utf8');
    expect(raw).toContain('\n  "version": 1');
  });

  it('never touches read-only .md curriculum files — byte-identical + unchanged mtime', async () => {
    // Seed the dir with a curriculum module note AND its (hypothetical) sidecar,
    // exactly as the real curriculum dir is laid out.
    const mdPath = join(dir, 'B01-x.md');
    const mdContent = '---\nmodule_id: B01\ntrack: B\nname: X\n---\n\n## Why this matters\nRead-only.\n';
    await writeFile(mdPath, mdContent, 'utf8');
    const before = await readFile(mdPath, 'utf8');
    const beforeStat = await stat(mdPath);

    const store = new JsonStateStore(dir);
    await store.write(richState());

    // The .md is still present and byte-identical, and its mtime did not change.
    const after = await readFile(mdPath, 'utf8');
    const afterStat = await stat(mdPath);
    expect(after).toBe(before);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);

    // Only the sidecar JSON exists alongside the .md — no stray writes.
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['B01-x.md', '_llmtutor-state.json'].sort());
  });

  it('cleans up the .tmp on a failed rename and re-throws the original error', async () => {
    const store = new JsonStateStore(dir);
    // Make the rename target a NON-EMPTY directory: renaming a file onto a
    // non-empty dir fails (ENOTEMPTY/EISDIR/EEXIST depending on platform),
    // forcing the catch branch after the temp file is already written.
    const sidecarAsDir = join(dir, '_llmtutor-state.json');
    await mkdir(sidecarAsDir);
    await writeFile(join(sidecarAsDir, 'blocker'), 'x', 'utf8');

    await expect(store.write(defaultTutorState())).rejects.toBeInstanceOf(Error);

    // No orphaned temp left behind by the failed write.
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
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
