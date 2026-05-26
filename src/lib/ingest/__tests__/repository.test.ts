import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CurriculumRepositoryImpl } from '@/lib/ingest/repository';
import { getCurriculumRepository } from '@/lib/ingest';
import * as parseModuleModule from '@/lib/ingest/parse-module';

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

describe('CurriculumRepository.load – per-file error isolation', () => {
  let isoDir: string;

  beforeAll(async () => {
    isoDir = await mkdtemp(join(tmpdir(), 'llmtutor-iso-'));
    await writeFile(join(isoDir, 'M01-tokens.md'), MOD_A, 'utf8');
    await writeFile(join(isoDir, 'BAD-broken.md'), MOD_B, 'utf8');
  });

  afterAll(async () => {
    await rm(isoDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('skips a file whose parseModule throws, loads remaining valid modules, and does not reject', async () => {
    // Spy on parseModule so that the call for BAD-broken.md throws.
    const spy = vi.spyOn(parseModuleModule, 'parseModule').mockImplementation((raw) => {
      // The real parseModule is called for both files; throw only for the bad one.
      // We detect the bad file by its content matching MOD_B (which has "B01").
      if (raw.includes('B01')) {
        throw new Error('simulated parse failure');
      }
      return vi.mocked(parseModuleModule.parseModule).getMockImplementation()!.call(null, raw);
    });

    // Re-spy without recursion: use the real implementation for the good file.
    spy.mockRestore();
    const realParseModule = (await import('@/lib/ingest/parse-module')).parseModule;
    vi.spyOn(parseModuleModule, 'parseModule').mockImplementation((raw) => {
      if (raw.includes('B01')) throw new Error('simulated parse failure');
      return realParseModule(raw);
    });

    const repo = new CurriculumRepositoryImpl();
    const curr = await expect(repo.load(isoDir)).resolves.toBeDefined();
    void curr; // suppress unused warning — resolves assertion is sufficient
  });

  it('valid module is present and bad module is absent after parse error', async () => {
    const realParseModule = (await import('@/lib/ingest/parse-module')).parseModule;
    vi.spyOn(parseModuleModule, 'parseModule').mockImplementation((raw) => {
      if (raw.includes('B01')) throw new Error('simulated parse failure');
      return realParseModule(raw);
    });

    const repo = new CurriculumRepositoryImpl();
    const curr = await repo.load(isoDir);
    const ids = curr.modules.map((m) => m.id);
    expect(ids).toContain('M01');
    expect(ids).not.toContain('B01');
  });
});
