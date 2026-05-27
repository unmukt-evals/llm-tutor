// src/lib/llm/__tests__/generate.test.ts
import { describe, it, expect } from 'vitest';
import { buildGenerateRequest, parseGenerateOutput, generateCandidate } from '@/lib/llm/generate';
import type { GenerateInput, LLMClient, LLMRequest } from '@/lib/llm/types';

const GOOD_MD = `---\nmodule_id: M99\nname: Test\n---\n\n## Why this matters\n\nbecause.\n\n### Engineer pass\n- x\n`;
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

function envelope(md: string, pool: string): string {
  return ['Here is the proposal:', '```markdown', md, '```', '```json', pool, '```'].join('\n');
}

describe('buildGenerateRequest', () => {
  it('includes the source text and a NEW-module instruction when no target', () => {
    const input: GenerateInput = { sourceText: 'SOURCE-XYZ' };
    const req = buildGenerateRequest(input);
    expect(req.messages[0].content).toContain('SOURCE-XYZ');
    expect(req.messages[0].content).toMatch(/new module/i);
    expect(req.temperature).toBe(0);
  });

  it('includes the existing markdown + pool when updating', () => {
    const input: GenerateInput = {
      sourceText: 'S', targetModuleId: 'M02', existingMarkdown: 'OLD-MD', existingPoolJson: 'OLD-POOL',
    };
    const req = buildGenerateRequest(input);
    expect(req.messages[0].content).toContain('M02');
    expect(req.messages[0].content).toContain('OLD-MD');
    expect(req.messages[0].content).toContain('OLD-POOL');
  });
});

describe('parseGenerateOutput', () => {
  it('extracts the markdown + json fences', () => {
    const out = parseGenerateOutput(envelope(GOOD_MD, GOOD_POOL));
    expect(out.markdown.trim()).toBe(GOOD_MD.trim());
    expect(JSON.parse(out.poolJson).moduleId).toBe('M99');
  });

  it('throws when the markdown fence is missing', () => {
    expect(() => parseGenerateOutput('```json\n{}\n```')).toThrow(/markdown/i);
  });

  it('throws when the json fence is missing', () => {
    expect(() => parseGenerateOutput('```markdown\nx\n```')).toThrow(/json/i);
  });

  it('throws when there is a duplicate markdown fence', () => {
    const dup = ['```markdown', 'a', '```', '```markdown', 'b', '```', '```json', '{}', '```'].join('\n');
    expect(() => parseGenerateOutput(dup)).toThrow(/more than one.*markdown/i);
  });

  it('throws when there is a duplicate json fence', () => {
    const dup = ['```markdown', 'a', '```', '```json', '{}', '```', '```json', '{}', '```'].join('\n');
    expect(() => parseGenerateOutput(dup)).toThrow(/more than one.*json/i);
  });
});

describe('generateCandidate', () => {
  it('returns a validated Candidate from a mock client', async () => {
    const client: LLMClient = {
      async generate(_req: LLMRequest) {
        return envelope(GOOD_MD, GOOD_POOL);
      },
    };
    const c = await generateCandidate(client, { sourceText: 'S' });
    expect(c.moduleId).toBe('M99');
    expect(c.markdown).toContain('module_id: M99');
  });

  it('throws when the LLM output fails the guardrails (bad json)', async () => {
    const client: LLMClient = {
      async generate() {
        return envelope(GOOD_MD, '{ broken');
      },
    };
    await expect(generateCandidate(client, { sourceText: 'S' })).rejects.toThrow();
  });
});
