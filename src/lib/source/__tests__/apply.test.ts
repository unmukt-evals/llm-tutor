// src/lib/source/__tests__/apply.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moduleSlug, moduleFileName, applyCandidate } from '@/lib/source/apply';
import type { Candidate } from '@/lib/llm/types';

const GOOD_MD = `---\nmodule_id: M99\nname: Test Module\n---\n\n## Why this matters\n\nbecause.\n\n### Engineer pass\n- x\n`;
const GOOD_POOL = JSON.stringify({
  moduleId: 'M99',
  questions: [
    {
      id: 'M99-q01', moduleId: 'M99', difficulty: 'easy', dimension: 'topic',
      stem: 's', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      distractorMisconception: { '1': 'm', '2': 'm', '3': 'm' }, explanation: 'e',
    },
  ],
});

describe('moduleSlug / moduleFileName', () => {
  it('slugifies a name', () => {
    expect(moduleSlug('Embeddings & Vectors!')).toBe('embeddings-vectors');
  });
  it('builds <id>-<slug>.md', () => {
    expect(moduleFileName('M02', 'Embeddings')).toBe('M02-embeddings.md');
  });
});

describe('applyCandidate', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-apply-'));
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the module .md and mcq/<id>.json', async () => {
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: GOOD_POOL };
    const result = await applyCandidate(dir, c, 'M99-test-module.md');
    const md = await readFile(join(dir, 'M99-test-module.md'), 'utf8');
    const pool = await readFile(join(dir, 'mcq', 'M99.json'), 'utf8');
    expect(md).toContain('module_id: M99');
    expect(JSON.parse(pool).moduleId).toBe('M99');
    expect(result.moduleFile).toBe('M99-test-module.md');
    expect(result.poolFile).toBe(join('mcq', 'M99.json'));
  });

  it('creates the mcq/ dir when missing', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'llmtutor-apply-bare-'));
    try {
      const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: GOOD_POOL };
      await applyCandidate(bare, c, 'M99-test-module.md');
      const pool = await readFile(join(bare, 'mcq', 'M99.json'), 'utf8');
      expect(JSON.parse(pool).moduleId).toBe('M99');
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it('re-validates and refuses to write a malformed pool', async () => {
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: '{ broken' };
    await expect(applyCandidate(dir, c, 'M99-test-module.md')).rejects.toThrow();
    // Nothing written.
    await expect(readFile(join(dir, 'M99-test-module.md'), 'utf8')).rejects.toBeTruthy();
  });
});
