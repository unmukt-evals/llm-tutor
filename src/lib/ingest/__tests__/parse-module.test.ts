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

describe('parseModule — passes, anchors, lab spec', () => {
  let mod: Module;
  beforeAll(async () => {
    mod = parseModule(await readFile(FIXTURE, 'utf8'));
  });

  it('maps the three depth passes to the canonical keys', () => {
    expect(mod.passes.tenYearOld).toContain('everyone takes the same test');
    expect(mod.passes.engineer).toContain('pins prompts, decoding, and scoring');
    expect(mod.passes.operator).toContain('defend the harness to an auditor');
  });

  it('captures anchors as per-item list (2 items, markers stripped)', () => {
    expect(mod.anchors.length).toBe(2);
    expect(mod.anchors[0]).toContain('the eval says 92%');
    expect(mod.anchors[1]).toContain('The board asks why the number moved');
  });

  it('prose anchors section (no list markers) → length 1', () => {
    const prose = parseModule(
      '---\nmodule_id: Z01\ntrack: A\nname: Z\n---\n\n## Anchor scenarios\n\nSome prose anchor text here.\n',
    );
    expect(prose.anchors.length).toBe(1);
    expect(prose.anchors[0]).toContain('Some prose anchor text here.');
  });

  it('captures the lab spec text', () => {
    expect(mod.labSpec).toContain('temperature=0');
  });

  it('leaves passes undefined when a pass heading is absent', () => {
    const partial = parseModule(
      '---\nmodule_id: Y01\ntrack: A\nname: Y\n---\n\n### Engineer pass\nonly engineer here\n',
    );
    expect(partial.passes.engineer).toBe('only engineer here');
    expect(partial.passes.tenYearOld).toBeUndefined();
    expect(partial.passes.operator).toBeUndefined();
    expect(partial.labSpec).toBeUndefined();
  });
});
