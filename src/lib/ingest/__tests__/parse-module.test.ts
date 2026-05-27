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

describe('parseModule — diagram extraction', () => {
  let mod: Module;
  beforeAll(async () => {
    mod = parseModule(await readFile(FIXTURE, 'utf8'));
  });

  it('extracts both fenced blocks from the engineer pass as Diagram objects', () => {
    expect(mod.diagrams.length).toBe(2);
  });

  it('first block: kind is mermaid, body contains the graph content, no backticks or lang tag', () => {
    const d = mod.diagrams[0];
    expect(d.kind).toBe('mermaid');
    expect(d.body).toContain('graph TD');
    expect(d.body).toContain('Prompt --> Decode --> Score');
    expect(d.body).not.toContain('```');
    expect(d.body).not.toContain('mermaid');
  });

  it('second block: kind is ascii, body contains the ascii content, no backticks or lang tag', () => {
    const d = mod.diagrams[1];
    expect(d.kind).toBe('ascii');
    expect(d.body).toContain('[prompt] -> [decode] -> [score]');
    expect(d.body).not.toContain('```');
    expect(d.body).not.toContain('text');
  });

  it('infers kind:code for a non-mermaid non-ascii language tag', () => {
    const withCode = parseModule(
      '---\nmodule_id: K01\ntrack: A\nname: K\n---\n\n### Engineer pass\n```python\nx = 1\n```\n',
    );
    expect(withCode.diagrams.length).toBe(1);
    expect(withCode.diagrams[0].kind).toBe('code');
    expect(withCode.diagrams[0].body).toBe('x = 1');
  });

  it('infers kind:ascii for an empty language tag', () => {
    const withEmpty = parseModule(
      '---\nmodule_id: L01\ntrack: A\nname: L\n---\n\n### Engineer pass\n```\nsome ascii\n```\n',
    );
    expect(withEmpty.diagrams.length).toBe(1);
    expect(withEmpty.diagrams[0].kind).toBe('ascii');
    expect(withEmpty.diagrams[0].body).toBe('some ascii');
  });

  it('returns no diagrams when the engineer pass has no fenced blocks', () => {
    const noDiag = parseModule(
      '---\nmodule_id: Z01\ntrack: A\nname: Z\n---\n\n### Engineer pass\nprose only, no fences\n',
    );
    expect(noDiag.diagrams).toEqual([]);
  });

  it('returns no diagrams when there is no engineer pass', () => {
    const noPass = parseModule('---\nmodule_id: N01\ntrack: A\nname: N\n---\n\n## Sources\n- S1\n');
    expect(noPass.diagrams).toEqual([]);
  });
});

describe('parseModule — application drills', () => {
  let mod: Module;
  beforeAll(async () => {
    mod = parseModule(await readFile(FIXTURE, 'utf8'));
  });

  it('parses two drills with scenario + double-clicks', () => {
    expect(mod.drills.length).toBe(2);
    expect(mod.drills[0].scenario).toContain('eval set leaked into training');
    expect(mod.drills[0].dc1).toContain('Distinguish contamination');
    expect(mod.drills[0].dc2).toContain('contamination probe');
  });

  it('handles a drill with only dc1 (dc2 undefined)', () => {
    expect(mod.drills[1].scenario).toContain('Two runs of the same model');
    expect(mod.drills[1].dc1).toContain('three nondeterminism sources');
    expect(mod.drills[1].dc2).toBeUndefined();
  });

  it('returns no drills when the section is absent', () => {
    const noDrills = parseModule('---\nmodule_id: D01\ntrack: A\nname: D\n---\n\n## Sources\n- S1\n');
    expect(noDrills.drills).toEqual([]);
  });
});

describe('parseModule — stress tests, flashcards, sources', () => {
  let mod: Module;
  beforeAll(async () => {
    mod = parseModule(await readFile(FIXTURE, 'utf8'));
  });

  it('parses three stress-test lenses', () => {
    expect(mod.stressTests.length).toBe(3);
    expect(mod.stressTests.map((s) => s.lens)).toEqual(['board', 'researcher', 'analyst']);
    expect(mod.stressTests[0].question).toContain('decision-grade');
    expect(mod.stressTests[2].question).toContain('production number');
  });

  it('parses flashcard seeds as lines', () => {
    expect(mod.flashcardSeeds.length).toBe(2);
    expect(mod.flashcardSeeds[0]).toContain('What makes an eval');
  });

  it('parses sources as lines', () => {
    expect(mod.sources.length).toBe(2);
    expect(mod.sources[0]).toContain('S4 — Construct validity');
  });

  it('returns empty arrays when those sections are absent', () => {
    const bare = parseModule('---\nmodule_id: E01\ntrack: A\nname: E\n---\n\n## Why this matters\nx\n');
    expect(bare.stressTests).toEqual([]);
    expect(bare.flashcardSeeds).toEqual([]);
    expect(bare.sources).toEqual([]);
  });
});
