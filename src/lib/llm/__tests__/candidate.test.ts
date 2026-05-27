// src/lib/llm/__tests__/candidate.test.ts
import { describe, it, expect } from 'vitest';
import { assertParsesAsModule, validateCandidate } from '@/lib/llm/candidate';
import type { Candidate } from '@/lib/llm/types';

const GOOD_MD = `---
module_id: M99
name: Test Module
---

# M99 — Test Module

## Why this matters

Because we are testing the round-trip guardrail.

## Teach outline

### Engineer pass
- a real engineer-pass bullet
`;

const GOOD_POOL = JSON.stringify({
  moduleId: 'M99',
  questions: [
    {
      id: 'M99-q01',
      moduleId: 'M99',
      difficulty: 'easy',
      dimension: 'topic',
      stem: 'A stem',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' },
      explanation: 'because a',
    },
  ],
});

describe('assertParsesAsModule', () => {
  it('returns the parsed Module for a complete markdown', () => {
    const m = assertParsesAsModule(GOOD_MD);
    expect(m.id).toBe('M99');
    expect(m.name).toBe('Test Module');
    expect(m.whyThisMatters).toContain('round-trip');
    expect(m.passes.engineer).toBeDefined();
  });

  it('throws when module_id is missing', () => {
    const bad = GOOD_MD.replace('module_id: M99\n', '');
    expect(() => assertParsesAsModule(bad)).toThrow(/module_id|id/i);
  });

  it('throws when there is no depth pass', () => {
    const bad = `---\nmodule_id: M99\nname: X\n---\n\n## Why this matters\n\nhi\n`;
    expect(() => assertParsesAsModule(bad)).toThrow(/pass/i);
  });

  it('throws when "Why this matters" is empty', () => {
    const bad = `---\nmodule_id: M99\nname: X\n---\n\n### Engineer pass\n- x\n`;
    expect(() => assertParsesAsModule(bad)).toThrow(/why this matters/i);
  });
});

describe('validateCandidate', () => {
  it('passes for a good module + pool', () => {
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: GOOD_POOL };
    expect(() => validateCandidate(c)).not.toThrow();
  });

  it('throws when the pool JSON is malformed', () => {
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: '{ not json' };
    expect(() => validateCandidate(c)).toThrow();
  });

  it('throws when the pool fails validatePool', () => {
    const badPool = JSON.stringify({ moduleId: 'M99', questions: [{ id: 'x' }] });
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: badPool };
    expect(() => validateCandidate(c)).toThrow();
  });

  it('throws when the pool moduleId does not match the module id', () => {
    const mismatched = JSON.parse(GOOD_POOL);
    mismatched.moduleId = 'M00';
    mismatched.questions[0].moduleId = 'M00';
    mismatched.questions[0].id = 'M00-q01';
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: JSON.stringify(mismatched) };
    expect(() => validateCandidate(c)).toThrow(/match/i);
  });
});
