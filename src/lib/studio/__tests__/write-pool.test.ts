// src/lib/studio/__tests__/write-pool.test.ts
// Phase 5b — Studio pool writer. Atomic temp+rename, re-validate at write
// time via validatePool, refuse moduleId mismatch with the url id.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePool } from '@/lib/studio/write-pool';

const validPool = (moduleId = 'M99') => ({
  moduleId,
  questions: [
    {
      id: `${moduleId}-q01`,
      moduleId,
      difficulty: 'easy',
      dimension: 'topic',
      stem: 's',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      distractorMisconception: { '1': 'm', '2': 'm', '3': 'm' },
      explanation: 'e',
    },
  ],
});

describe('writePool', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-write-pool-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes mcq/<id>.json pretty-printed with trailing newline', async () => {
    const result = await writePool(dir, 'M99', JSON.stringify(validPool('M99')));
    expect(result.file).toBe(join('mcq', 'M99.json'));
    const onDisk = await readFile(join(dir, 'mcq', 'M99.json'), 'utf8');
    expect(onDisk.endsWith('\n')).toBe(true);
    // Pretty-printed → contains a newline + indent
    expect(onDisk).toContain('  "moduleId": "M99"');
    // Round-trips through JSON.parse
    expect(JSON.parse(onDisk).moduleId).toBe('M99');
  });

  it('creates the mcq/ dir when missing', async () => {
    // dir has no mcq/ subdir yet
    const result = await writePool(dir, 'M99', JSON.stringify(validPool('M99')));
    const onDisk = await readFile(join(dir, result.file), 'utf8');
    expect(JSON.parse(onDisk).moduleId).toBe('M99');
  });

  it('overwrites an existing pool file', async () => {
    await mkdir(join(dir, 'mcq'), { recursive: true });
    await writePool(dir, 'M99', JSON.stringify(validPool('M99')));
    const updated = validPool('M99');
    updated.questions[0].stem = 'changed stem';
    await writePool(dir, 'M99', JSON.stringify(updated));
    const onDisk = JSON.parse(await readFile(join(dir, 'mcq', 'M99.json'), 'utf8'));
    expect(onDisk.questions[0].stem).toBe('changed stem');
  });

  it('refuses invalid JSON', async () => {
    await expect(writePool(dir, 'M99', '{ not json')).rejects.toThrow();
    await expect(stat(join(dir, 'mcq', 'M99.json'))).rejects.toBeTruthy();
  });

  it('refuses malformed pool (validatePool fails)', async () => {
    const bad = { moduleId: 'M99', questions: [{ id: 'q', moduleId: 'M99' /* missing rest */ }] };
    await expect(writePool(dir, 'M99', JSON.stringify(bad))).rejects.toThrow();
  });

  it('refuses moduleId mismatch with url id', async () => {
    const pool = validPool('M99');
    await expect(writePool(dir, 'M88', JSON.stringify(pool))).rejects.toThrow(/mismatch/i);
  });

  it('refuses path-traversing ids', async () => {
    const pool = validPool('M99');
    await expect(writePool(dir, '../evil', JSON.stringify(pool))).rejects.toThrow(/unsafe/i);
  });

  it('is atomic: validation failure leaves no .tmp behind', async () => {
    await mkdir(join(dir, 'mcq'), { recursive: true });
    await writePool(dir, 'M99', JSON.stringify(validPool('M99')));
    await expect(writePool(dir, 'M99', '{ bad json')).rejects.toThrow();
    const entries = await readdir(join(dir, 'mcq'));
    expect(entries.every((f) => !f.endsWith('.tmp'))).toBe(true);
    // Original file preserved.
    const onDisk = JSON.parse(await readFile(join(dir, 'mcq', 'M99.json'), 'utf8'));
    expect(onDisk.questions[0].stem).toBe('s');
  });
});
