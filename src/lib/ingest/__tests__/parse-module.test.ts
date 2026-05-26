import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseModule } from '@/lib/ingest/parse-module';
import type { Module } from '@/lib/types';

const FIXTURE = resolve(__dirname, 'fixtures/B01-sample.md');

describe('parseModule — identity + whyThisMatters', () => {
  let mod: Module;
  beforeAll(async () => {
    mod = parseModule(await readFile(FIXTURE, 'utf8'));
  });

  it('reads frontmatter into id/track/name', () => {
    expect(mod.id).toBe('B01');
    expect(mod.track).toBe('B');
    expect(mod.name).toBe('Eval harnesses & harness engineering');
  });

  it('reads prerequisites and primary sources', () => {
    expect(mod.prerequisites).toEqual(['M03', 'M04']);
    expect(mod.primarySources).toEqual(['S4', 'S5']);
  });

  it('captures why-this-matters text', () => {
    expect(mod.whyThisMatters).toContain('every score downstream is a confident lie');
  });

  it('does not throw and leaves whyThisMatters empty string when section absent', () => {
    const noWhy = parseModule('---\nmodule_id: X01\ntrack: A\nname: X\n---\n\n## Sources\n- S1\n');
    expect(noWhy.whyThisMatters).toBe('');
    expect(noWhy.id).toBe('X01');
  });
});
