// src/lib/llm/verify.ts
// Independent verification third-pass. Implements the Verifier interface with an
// LLMClient. PURE prompt build + report parse; the call is the only impure step
// (client injected → unit-testable with a mock).
// FOLLOW-ON: a TinyfishVerifier behind this same Verifier interface that grounds
// claims against the live web via mcp__tinyfish__search/fetch_content. Not built
// here — it plugs in behind the identical Verifier.verify(input) contract.

import type {
  ClaimCheck,
  LLMClient,
  LLMRequest,
  VerificationInput,
  VerificationReport,
  Verifier,
} from '@/lib/llm/types';

const SYSTEM = [
  'You are an INDEPENDENT, skeptical fact-checker. You did NOT write the proposal.',
  'Do NOT agree by default. Your job is to find ungrounded or contradicted claims.',
  'For each substantive claim in the proposal decide: is it grounded in the SOURCE,',
  'and is it aligned with the curriculum PURPOSE. Then give an overall verdict.',
  'Return ONE ```json block matching exactly:',
  '{ "claims": [ { "claim": string, "groundedInSource": boolean, "alignedWithPurpose": boolean,',
  '"status": "verified"|"unverified"|"contradicted", "note": string } ],',
  '"overallVerdict": "looks-sound"|"needs-changes"|"reject", "summary": string }.',
].join(' ');

/** PURE: build the verification request. */
export function buildVerifyRequest(input: VerificationInput): LLMRequest {
  const content = [
    '--- CURRICULUM PURPOSE ---', input.curriculumPurpose, '--- END PURPOSE ---',
    '--- SOURCE ---', input.sourceText, '--- END SOURCE ---',
    '--- PROPOSED MODULE MARKDOWN ---', input.candidateMarkdown, '--- END MODULE ---',
    '--- PROPOSED POOL JSON ---', input.candidatePoolJson, '--- END POOL ---',
    'Verify now. Be adversarial and independent. Return the json report.',
  ].join('\n\n');
  return { system: SYSTEM, messages: [{ role: 'user', content }], temperature: 0, maxTokens: 4096 };
}

const VALID_VERDICTS = ['looks-sound', 'needs-changes', 'reject'] as const;
const VALID_STATUS = ['verified', 'unverified', 'contradicted'] as const;

/** PURE: parse the report from a json-fenced or bare-json LLM response. */
export function parseVerifyReport(raw: string): VerificationReport {
  const fence = /```json\s*\n([\s\S]*?)\n```/m.exec(raw);
  const jsonText = fence ? fence[1] : raw;
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText.trim());
  } catch {
    throw new Error('Verification report is not valid JSON.');
  }
  const o = obj as Record<string, unknown>;
  if (!VALID_VERDICTS.includes(o.overallVerdict as (typeof VALID_VERDICTS)[number])) {
    throw new Error('Verification report has an invalid or missing overallVerdict.');
  }
  if (!Array.isArray(o.claims)) {
    throw new Error('Verification report claims must be an array.');
  }
  const claims: ClaimCheck[] = (o.claims as unknown[]).map((raw, i) => {
    const c = raw as Record<string, unknown>;
    if (!VALID_STATUS.includes(c.status as (typeof VALID_STATUS)[number])) {
      throw new Error(`Verification claim ${i} has an invalid status.`);
    }
    return {
      claim: String(c.claim ?? ''),
      groundedInSource: Boolean(c.groundedInSource),
      alignedWithPurpose: Boolean(c.alignedWithPurpose),
      status: c.status as ClaimCheck['status'],
      note: String(c.note ?? ''),
    };
  });
  return {
    claims,
    overallVerdict: o.overallVerdict as VerificationReport['overallVerdict'],
    summary: String(o.summary ?? ''),
  };
}

export class LLMVerifier implements Verifier {
  constructor(private readonly client: LLMClient) {}

  async verify(input: VerificationInput): Promise<VerificationReport> {
    const raw = await this.client.generate(buildVerifyRequest(input));
    return parseVerifyReport(raw);
  }
}
