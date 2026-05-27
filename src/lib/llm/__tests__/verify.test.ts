// src/lib/llm/__tests__/verify.test.ts
import { describe, it, expect } from 'vitest';
import { buildVerifyRequest, parseVerifyReport, LLMVerifier } from '@/lib/llm/verify';
import type { LLMClient, LLMRequest, VerificationInput } from '@/lib/llm/types';

const INPUT: VerificationInput = {
  sourceText: 'SOURCE-TEXT',
  curriculumPurpose: 'PURPOSE-TEXT',
  candidateMarkdown: 'CANDIDATE-MD',
  candidatePoolJson: 'CANDIDATE-POOL',
};

const REPORT = {
  claims: [
    { claim: 'C1', groundedInSource: true, alignedWithPurpose: true, status: 'verified', note: 'ok' },
    { claim: 'C2', groundedInSource: false, alignedWithPurpose: true, status: 'unverified', note: 'not in source' },
  ],
  overallVerdict: 'needs-changes',
  summary: 'one claim is unverified',
};

describe('buildVerifyRequest', () => {
  it('embeds source, purpose, candidate, and an anti-yes-man instruction', () => {
    const req = buildVerifyRequest(INPUT);
    const text = (req.system ?? '') + req.messages[0].content;
    expect(text).toContain('SOURCE-TEXT');
    expect(text).toContain('PURPOSE-TEXT');
    expect(text).toContain('CANDIDATE-MD');
    expect(text).toMatch(/do not.*agree|skeptic|adversarial|independent/i);
  });

  it('uses temperature 0', () => {
    expect(buildVerifyRequest(INPUT).temperature).toBe(0);
  });
});

describe('parseVerifyReport', () => {
  it('parses a json-fenced report', () => {
    const raw = 'Here:\n```json\n' + JSON.stringify(REPORT) + '\n```';
    const r = parseVerifyReport(raw);
    expect(r.overallVerdict).toBe('needs-changes');
    expect(r.claims).toHaveLength(2);
    expect(r.claims[1].status).toBe('unverified');
  });

  it('parses a bare json object (no fence)', () => {
    const r = parseVerifyReport(JSON.stringify(REPORT));
    expect(r.claims).toHaveLength(2);
  });

  it('parses a looks-sound verdict', () => {
    const r = parseVerifyReport(JSON.stringify({ ...REPORT, overallVerdict: 'looks-sound' }));
    expect(r.overallVerdict).toBe('looks-sound');
  });

  it('parses a reject verdict', () => {
    const r = parseVerifyReport(JSON.stringify({ ...REPORT, overallVerdict: 'reject' }));
    expect(r.overallVerdict).toBe('reject');
  });

  it('throws on a report missing overallVerdict', () => {
    expect(() => parseVerifyReport(JSON.stringify({ claims: [] }))).toThrow(/verdict/i);
  });

  it('throws on a non-JSON response', () => {
    expect(() => parseVerifyReport('not json at all')).toThrow(/json/i);
  });

  it('throws when a claim has an invalid status', () => {
    const bad = {
      ...REPORT,
      claims: [{ claim: 'C', groundedInSource: true, alignedWithPurpose: true, status: 'maybe', note: '' }],
    };
    expect(() => parseVerifyReport(JSON.stringify(bad))).toThrow(/status/i);
  });
});

describe('LLMVerifier', () => {
  it('returns a report from a mock client', async () => {
    const client: LLMClient = {
      async generate(_req: LLMRequest) {
        return '```json\n' + JSON.stringify(REPORT) + '\n```';
      },
    };
    const verifier = new LLMVerifier(client);
    const r = await verifier.verify(INPUT);
    expect(r.overallVerdict).toBe('needs-changes');
  });
});
