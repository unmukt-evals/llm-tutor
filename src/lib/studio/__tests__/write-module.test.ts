// src/lib/studio/__tests__/write-module.test.ts
// Phase 5b — Studio module writer. Atomic temp+rename, re-validate at write
// time, resolve existing `<id>-<slug>.md` or `<id>.md` filenames, fall back to
// moduleFileName for new modules. Refuses path-traversing ids.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeModule } from '@/lib/studio/write-module';

const VALID_MD = (id = 'M99', name = 'Test Module') =>
  `---\nmodule_id: ${id}\nname: ${name}\n---\n\n## Why this matters\n\nbecause.\n\n### Engineer pass\n- x\n`;

describe('writeModule', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-write-module-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a new module file as <id>-<slug>.md when none exists', async () => {
    const md = VALID_MD('M99', 'Test Module');
    const result = await writeModule(dir, 'M99', md);
    expect(result.file).toBe('M99-test-module.md');
    const onDisk = await readFile(join(dir, result.file), 'utf8');
    expect(onDisk).toContain('module_id: M99');
    expect(onDisk.endsWith('\n')).toBe(true);
  });

  it('overwrites an existing <id>-<slug>.md in place', async () => {
    const original = VALID_MD('M99', 'Test Module');
    await writeFile(join(dir, 'M99-test-module.md'), original, 'utf8');
    const updated = VALID_MD('M99', 'Test Module').replace('because.', 'because updated.');
    const result = await writeModule(dir, 'M99', updated);
    expect(result.file).toBe('M99-test-module.md');
    const onDisk = await readFile(join(dir, result.file), 'utf8');
    expect(onDisk).toContain('because updated.');
    // Only one file for this id exists — no stray <id>-<new-slug>.md.
    const entries = await readdir(dir);
    expect(entries.filter((f) => f.startsWith('M99'))).toEqual(['M99-test-module.md']);
  });

  it('resolves an existing <id>.md file (no slug suffix)', async () => {
    const original = VALID_MD('M99', 'Test Module');
    await writeFile(join(dir, 'M99.md'), original, 'utf8');
    const updated = VALID_MD('M99', 'Test Module').replace('because.', 'because changed.');
    const result = await writeModule(dir, 'M99', updated);
    expect(result.file).toBe('M99.md');
    const onDisk = await readFile(join(dir, 'M99.md'), 'utf8');
    expect(onDisk).toContain('because changed.');
  });

  it('refuses to write malformed markdown (no Why this matters)', async () => {
    const bad = `---\nmodule_id: M99\nname: T\n---\n\n# T\n`;
    await expect(writeModule(dir, 'M99', bad)).rejects.toThrow();
    // Nothing on disk.
    await expect(stat(join(dir, 'M99-t.md'))).rejects.toBeTruthy();
  });

  it('refuses when url id does not match parsed module id', async () => {
    const md = VALID_MD('M99', 'Test Module');
    await expect(writeModule(dir, 'M88', md)).rejects.toThrow(/mismatch/i);
  });

  it('refuses path-traversing ids', async () => {
    const md = VALID_MD('M99', 'Test Module');
    await expect(writeModule(dir, '../evil', md)).rejects.toThrow(/unsafe/i);
  });

  it('is atomic: a validation failure leaves no .tmp file behind', async () => {
    const original = VALID_MD('M99', 'Test Module');
    await writeFile(join(dir, 'M99-test-module.md'), original, 'utf8');
    await expect(writeModule(dir, 'M99', 'not-a-module')).rejects.toThrow();
    const entries = await readdir(dir);
    expect(entries.every((f) => !f.endsWith('.tmp'))).toBe(true);
    // Original file untouched.
    const onDisk = await readFile(join(dir, 'M99-test-module.md'), 'utf8');
    expect(onDisk).toContain('because.');
  });

  it('normalizes content to end with a single trailing newline', async () => {
    const md = VALID_MD('M99', 'Test Module').replace(/\n$/, ''); // strip trailing nl
    const result = await writeModule(dir, 'M99', md);
    const onDisk = await readFile(join(dir, result.file), 'utf8');
    expect(onDisk.endsWith('\n')).toBe(true);
    expect(onDisk.endsWith('\n\n')).toBe(false);
  });
});

// Ensure the mcq/ dir is not touched by writeModule (modules ↔ pools are now
// independent in Phase 5b — the dual-file applyCandidate is for /source apply
// only).
describe('writeModule isolation', () => {
  it('does not create or touch mcq/<id>.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'llmtutor-write-module-iso-'));
    try {
      await mkdir(join(dir, 'mcq'), { recursive: true });
      await writeModule(dir, 'M99', VALID_MD('M99', 'Test Module'));
      // mcq dir still empty
      const mcqEntries = await readdir(join(dir, 'mcq'));
      expect(mcqEntries).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
