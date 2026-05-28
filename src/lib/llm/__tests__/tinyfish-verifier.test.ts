// src/lib/llm/__tests__/tinyfish-verifier.test.ts
// Tests for the web-grounded TinyfishVerifier. Both the LLMClient and the
// TinyfishMcpClient are MOCKED — no network, no keychain reads.

import { describe, it, expect, vi } from 'vitest';
import {
  TinyfishVerifier,
  buildClaimExtractRequest,
  parseClaimList,
  renderGroundingBlock,
  augmentVerifyRequest,
} from '@/lib/llm/tinyfish-verifier';
import { buildVerifyRequest } from '@/lib/llm/verify';
import type { LLMClient, LLMRequest, VerificationInput } from '@/lib/llm/types';
import type {
  TinyfishMcpClient,
  TinyfishSearchResult,
} from '@/lib/llm/mcp/tinyfish-client';

const INPUT: VerificationInput = {
  sourceText: 'SRC',
  curriculumPurpose: 'PURPOSE',
  candidateMarkdown: 'MD-BODY',
  candidatePoolJson: 'POOL-JSON',
};

const REPORT = {
  claims: [
    {
      claim: 'C1',
      groundedInSource: true,
      alignedWithPurpose: true,
      status: 'verified',
      note: 'ok',
    },
  ],
  overallVerdict: 'looks-sound',
  summary: 'fine',
};

const CLAIM_RAW = '```json\n' + JSON.stringify({ claims: ['claim one', 'claim two', 'claim three'] }) + '\n```';
const REPORT_RAW = '```json\n' + JSON.stringify(REPORT) + '\n```';

function mockMcp(
  searches: Record<string, TinyfishSearchResult[] | Error>,
): TinyfishMcpClient {
  return {
    search: vi.fn(async (q: string) => {
      const v = searches[q];
      if (v instanceof Error) throw v;
      if (!v) return [];
      return v;
    }),
    fetchContent: vi.fn(async () => ''),
  } as unknown as TinyfishMcpClient;
}

describe('buildClaimExtractRequest', () => {
  it('embeds the candidate and asks for 3–5 verifiable claims as json', () => {
    const req = buildClaimExtractRequest(INPUT);
    const text = (req.system ?? '') + req.messages[0].content;
    expect(text).toContain('MD-BODY');
    expect(text).toContain('POOL-JSON');
    expect(text).toMatch(/verifiable/i);
    expect(text).toMatch(/json/i);
    expect(req.temperature).toBe(0);
  });
});

describe('parseClaimList', () => {
  it('parses a fenced { claims: [...] } payload', () => {
    expect(parseClaimList(CLAIM_RAW)).toEqual(['claim one', 'claim two', 'claim three']);
  });
  it('parses a bare json object', () => {
    expect(parseClaimList(JSON.stringify({ claims: ['x'] }))).toEqual(['x']);
  });
  it('clamps to 5', () => {
    const ten = JSON.stringify({ claims: Array.from({ length: 10 }, (_, i) => `c${i}`) });
    expect(parseClaimList(ten)).toHaveLength(5);
  });
  it('throws on non-json', () => {
    expect(() => parseClaimList('not json')).toThrow(/json/i);
  });
  it('throws on missing claims array', () => {
    expect(() => parseClaimList(JSON.stringify({}))).toThrow(/claims/);
  });
  it('throws when claims are all empty', () => {
    expect(() => parseClaimList(JSON.stringify({ claims: ['', '   '] }))).toThrow(/no usable/);
  });
});

describe('renderGroundingBlock', () => {
  it('renders evidence under each claim and includes the grounding instruction', () => {
    const block = renderGroundingBlock([
      {
        claim: 'C1',
        results: [
          { title: 'T1', url: 'https://a', snippet: 'evidence one' },
          { title: 'T2', url: 'https://b', snippet: 'evidence two' },
        ],
      },
      { claim: 'C2', results: [] },
    ]);
    expect(block).toContain('CLAIM: C1');
    expect(block).toContain('T1');
    expect(block).toContain('https://a');
    expect(block).toContain('evidence one');
    expect(block).toContain('CLAIM: C2');
    expect(block).toContain('(no web evidence retrieved)');
    expect(block).toMatch(/contradicted/);
    expect(block).toMatch(/unverified/);
  });

  it('returns empty for an empty groundings array', () => {
    expect(renderGroundingBlock([])).toBe('');
  });
});

describe('augmentVerifyRequest', () => {
  it('splices the grounding block before the final instruction', () => {
    const base = buildVerifyRequest(INPUT);
    const block = renderGroundingBlock([
      { claim: 'C1', results: [{ title: 'TT', url: 'https://u', snippet: 'snip' }] },
    ]);
    const out = augmentVerifyRequest(base, block);
    const content = out.messages[0].content;
    expect(content).toContain('snip');
    // Final instruction stays last
    const lines = content.trim().split('\n\n');
    expect(lines[lines.length - 1]).toMatch(/Verify now/i);
  });

  it('returns the base unchanged for empty grounding', () => {
    const base = buildVerifyRequest(INPUT);
    expect(augmentVerifyRequest(base, '')).toBe(base);
  });
});

describe('TinyfishVerifier — happy path', () => {
  it('extracts claims, searches each, augments the verify prompt with snippets, parses report', async () => {
    const llmCalls: LLMRequest[] = [];
    const llm: LLMClient = {
      generate: vi.fn(async (req: LLMRequest) => {
        llmCalls.push(req);
        // 1st call = claim extract; 2nd call = verify
        return llmCalls.length === 1 ? CLAIM_RAW : REPORT_RAW;
      }),
    };
    const mcp = mockMcp({
      'claim one': [{ title: 'A1', url: 'https://1', snippet: 'evidence-A' }],
      'claim two': [{ title: 'A2', url: 'https://2', snippet: 'evidence-B' }],
      'claim three': [{ title: 'A3', url: 'https://3', snippet: 'evidence-C' }],
    });

    const verifier = new TinyfishVerifier(llm, mcp, {
      logger: { warn: vi.fn() },
    });
    const report = await verifier.verify(INPUT);

    expect(report.overallVerdict).toBe('looks-sound');
    // search called once per claim
    expect((mcp.search as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(3);
    // 2 LLM calls: extract + verify
    expect(llmCalls).toHaveLength(2);
    const verifyContent = llmCalls[1].messages[0].content;
    expect(verifyContent).toContain('GROUNDING — web evidence per claim');
    expect(verifyContent).toContain('evidence-A');
    expect(verifyContent).toContain('evidence-B');
    expect(verifyContent).toContain('evidence-C');
    // Base verify content is still present
    expect(verifyContent).toContain('MD-BODY');
    expect(verifyContent).toContain('SRC');
  });

  it('continues with empty evidence when one search throws', async () => {
    const llm: LLMClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(CLAIM_RAW)
        .mockResolvedValueOnce(REPORT_RAW),
    };
    const mcp = mockMcp({
      'claim one': [{ title: 'OK', url: '', snippet: 'has-evidence' }],
      'claim two': new Error('boom'),
      'claim three': [{ title: 'OK3', url: '', snippet: 'also' }],
    });
    const warn = vi.fn();
    const verifier = new TinyfishVerifier(llm, mcp, { logger: { warn } });
    const report = await verifier.verify(INPUT);
    expect(report.overallVerdict).toBe('looks-sound');
    expect(warn).toHaveBeenCalled();
    // Verify-call content still contains the two surviving snippets and a "no evidence" line
    const verifyCall = (llm.generate as unknown as { mock: { calls: LLMRequest[][] } }).mock
      .calls[1][0];
    const content = verifyCall.messages[0].content;
    expect(content).toContain('has-evidence');
    expect(content).toContain('also');
    expect(content).toContain('(no web evidence retrieved)');
  });
});

describe('TinyfishVerifier — graceful degrade', () => {
  it('falls back to plain LLM verification when claim-extract LLM call fails', async () => {
    let n = 0;
    const llm: LLMClient = {
      generate: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new Error('extract-fail');
        return REPORT_RAW;
      }),
    };
    const mcp = mockMcp({});
    const warn = vi.fn();
    const verifier = new TinyfishVerifier(llm, mcp, { logger: { warn } });
    const report = await verifier.verify(INPUT);
    expect(report.overallVerdict).toBe('looks-sound');
    expect(warn).toHaveBeenCalled();
    // No searches happened because extraction failed
    expect((mcp.search as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
    // Verify call sent — base content only (no grounding block)
    const verifyCall = (llm.generate as unknown as { mock: { calls: LLMRequest[][] } }).mock
      .calls[1][0];
    expect(verifyCall.messages[0].content).not.toContain('GROUNDING');
    expect(verifyCall.messages[0].content).toContain('MD-BODY');
  });

  it('falls back when the claim-list parse fails (LLM returned junk)', async () => {
    const llm: LLMClient = {
      generate: vi
        .fn()
        .mockResolvedValueOnce('not even json')
        .mockResolvedValueOnce(REPORT_RAW),
    };
    const mcp = mockMcp({});
    const warn = vi.fn();
    const verifier = new TinyfishVerifier(llm, mcp, { logger: { warn } });
    const report = await verifier.verify(INPUT);
    expect(report.overallVerdict).toBe('looks-sound');
    expect(warn).toHaveBeenCalled();
  });
});
