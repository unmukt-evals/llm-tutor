import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CurriculumRepositoryImpl } from '@/lib/ingest/repository';
import { getCurriculumRepository } from '@/lib/ingest';

let dir: string;

const MOD_A = `---
module_id: M01
track: A
name: Tokens
prerequisites: []
primary_sources: []
---

## Why this matters
Tokens are the atom.

### Engineer pass
A token is a subword unit.
`;

const MOD_B = `---
module_id: B01
track: B
name: Eval harnesses
prerequisites: [M01]
primary_sources: [S4]
---

## Why this matters
Bad harness, confident lie.

### Engineer pass
Pin everything.
`;

describe('CurriculumRepository.load', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-curr-'));
    await writeFile(join(dir, 'M01-tokens.md'), MOD_A, 'utf8');
    await writeFile(join(dir, 'B01-harness.md'), MOD_B, 'utf8');
    // these must be ignored:
    await writeFile(join(dir, '_sources.md'), '# sources\n', 'utf8');
    await writeFile(join(dir, '_flashcards.md'), '# cards\n', 'utf8');
    await writeFile(join(dir, '_curriculum.md'), '# toc\n', 'utf8');
    await writeFile(join(dir, '_progress.md'), '# progress\n', 'utf8');
    await writeFile(join(dir, 'notes.txt'), 'not markdown', 'utf8');
    // a .md file WITHOUT module_id frontmatter must also be skipped (not crash):
    await writeFile(join(dir, 'README.md'), '# Curriculum\nNo frontmatter here.\n', 'utf8');
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads only real module *.md files (skips _-prefixed, non-md, and no-module_id)', async () => {
    const repo = new CurriculumRepositoryImpl();
    const curr = await repo.load(dir);
    const ids = curr.modules.map((m) => m.id).sort();
    expect(ids).toEqual(['B01', 'M01']);
  });

  it('collects distinct tracks in stable order', async () => {
    const repo = new CurriculumRepositoryImpl();
    const curr = await repo.load(dir);
    expect(curr.tracks).toEqual(['A', 'B']);
  });

  it('byId resolves a module and returns undefined for misses', async () => {
    const repo = new CurriculumRepositoryImpl();
    const curr = await repo.load(dir);
    expect(curr.byId('B01')?.name).toBe('Eval harnesses');
    expect(curr.byId('NOPE')).toBeUndefined();
  });

  it('orders modules by filename', async () => {
    const repo = new CurriculumRepositoryImpl();
    const curr = await repo.load(dir);
    // B01-harness.md sorts before M01-tokens.md alphabetically
    expect(curr.modules.map((m) => m.id)).toEqual(['B01', 'M01']);
  });

  it('getCurriculumRepository() factory returns a working CurriculumRepository (§7)', async () => {
    const repo = getCurriculumRepository();
    const curr = await repo.load(dir);
    expect(curr.modules.map((m) => m.id)).toEqual(['B01', 'M01']);
    expect(curr.tracks).toEqual(['A', 'B']);
  });
});
