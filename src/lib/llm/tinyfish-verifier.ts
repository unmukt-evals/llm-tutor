// src/lib/llm/tinyfish-verifier.ts
// Web-grounded verification. Composes (a) the existing LLMClient to extract a
// small set of KEY claims from the proposal and to write the final report, and
// (b) the tinyfish MCP client to fetch web evidence for each claim. The final
// LLM call uses the SAME buildVerifyRequest as LLMVerifier but augmented with
// a "GROUNDING — web evidence per claim" block so the verifier can react to
// the snippets explicitly. Same Verifier interface as LLMVerifier — fully
// swappable behind the factory.

import type {
  LLMClient,
  LLMRequest,
  VerificationInput,
  VerificationReport,
  Verifier,
} from '@/lib/llm/types';
import { buildVerifyRequest, parseVerifyReport } from '@/lib/llm/verify';
import type { TinyfishMcpClient, TinyfishSearchResult } from '@/lib/llm/mcp/tinyfish-client';

const CLAIM_EXTRACT_SYSTEM = [
  'You extract a SHORT list (3–5) of the most VERIFIABLE, falsifiable factual claims',
  'from a candidate teaching module. Skip pedagogy/style. Keep each claim under 20 words.',
  'Return ONE ```json block: { "claims": [string, string, ...] }.',
].join(' ');

const CLAIM_EXTRACT_USER_PREFIX = [
  'Extract 3–5 KEY verifiable factual claims from this proposal. Prefer claims you could',
  'check against the open web (names, dates, versions, numbers, mechanisms). Return only the json.',
].join(' ');

/** PURE: build the LLM request that asks for a small claim list. */
export function buildClaimExtractRequest(input: VerificationInput): LLMRequest {
  const content = [
    CLAIM_EXTRACT_USER_PREFIX,
    '--- PROPOSED MODULE MARKDOWN ---',
    input.candidateMarkdown,
    '--- END MODULE ---',
    '--- PROPOSED POOL JSON ---',
    input.candidatePoolJson,
    '--- END POOL ---',
  ].join('\n\n');
  return {
    system: CLAIM_EXTRACT_SYSTEM,
    messages: [{ role: 'user', content }],
    temperature: 0,
    maxTokens: 1024,
  };
}

/** PURE: parse the claim-list LLM response into an array of strings. */
export function parseClaimList(raw: string): string[] {
  const fence = /```json\s*\n([\s\S]*?)\n```/m.exec(raw);
  const jsonText = fence ? fence[1] : raw;
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText.trim());
  } catch {
    throw new Error('Claim-list response is not valid JSON.');
  }
  const o = obj as { claims?: unknown };
  if (!Array.isArray(o.claims)) {
    throw new Error('Claim-list response is missing "claims" array.');
  }
  const claims = o.claims
    .map((c) => String(c ?? '').trim())
    .filter((c) => c.length > 0);
  if (claims.length === 0) {
    throw new Error('Claim-list response had no usable claims.');
  }
  // Clamp to 5 — extra defensive against runaway lists.
  return claims.slice(0, 5);
}

/** PURE: render the grounding evidence block to append to the verify request. */
export function renderGroundingBlock(
  groundings: ReadonlyArray<{ claim: string; results: TinyfishSearchResult[] }>,
): string {
  if (groundings.length === 0) return '';
  const lines: string[] = ['--- GROUNDING — web evidence per claim ---'];
  for (const g of groundings) {
    lines.push(`CLAIM: ${g.claim}`);
    if (g.results.length === 0) {
      lines.push('  (no web evidence retrieved)');
    } else {
      for (const r of g.results) {
        const head = r.title || r.url || '(untitled)';
        const url = r.url ? ` [${r.url}]` : '';
        const snippet = r.snippet ? `\n    ${r.snippet.replace(/\s+/g, ' ').slice(0, 400)}` : '';
        lines.push(`  - ${head}${url}${snippet}`);
      }
    }
  }
  lines.push('--- END GROUNDING ---');
  lines.push(
    'Treat the GROUNDING as INDEPENDENT evidence. If a claim is contradicted by the web',
    'evidence, mark it "contradicted". If the evidence does not corroborate, mark "unverified".',
    'If corroborated, mark "verified".',
  );
  return lines.join('\n');
}

/** PURE: splice a grounding block into the base verify request. */
export function augmentVerifyRequest(
  base: LLMRequest,
  groundingBlock: string,
): LLMRequest {
  if (groundingBlock.length === 0) return base;
  const original = base.messages[0]?.content ?? '';
  // Insert the grounding block right before the final "Verify now…" instruction.
  // The base message ends with that instruction joined by \n\n, so we splice
  // by inserting the block before the last paragraph.
  const parts = original.split('\n\n');
  const last = parts.pop() ?? '';
  const augmented = [...parts, groundingBlock, last].join('\n\n');
  return {
    ...base,
    messages: [{ role: 'user', content: augmented }],
  };
}

export interface TinyfishVerifierOptions {
  /** Max results per claim. Default 3. */
  resultsPerClaim?: number;
  /** Console-like logger for graceful-degrade warnings. */
  logger?: { warn: (...args: unknown[]) => void };
}

/**
 * Web-grounded Verifier. Uses an LLMClient + a TinyfishMcpClient to add web
 * evidence to the existing adversarial verification pass. On ANY tinyfish error
 * (network, expired token, parse), falls back to the plain LLM-only pass —
 * verification must never break the user's accept flow.
 */
export class TinyfishVerifier implements Verifier {
  private readonly resultsPerClaim: number;
  private readonly logger: { warn: (...args: unknown[]) => void };

  constructor(
    private readonly llm: LLMClient,
    private readonly mcp: TinyfishMcpClient,
    opts: TinyfishVerifierOptions = {},
  ) {
    this.resultsPerClaim = opts.resultsPerClaim ?? 3;
    // eslint-disable-next-line no-console
    this.logger = opts.logger ?? { warn: (...a) => console.warn(...a) };
  }

  async verify(input: VerificationInput): Promise<VerificationReport> {
    let groundingBlock = '';

    try {
      // (a) extract key claims via the LLM
      const claimRaw = await this.llm.generate(buildClaimExtractRequest(input));
      const claims = parseClaimList(claimRaw);

      // (b) search the web for each claim (sequential — keeps load light and
      // tests deterministic; we can parallelise later if it's worth it)
      const groundings: { claim: string; results: TinyfishSearchResult[] }[] = [];
      for (const claim of claims) {
        try {
          const results = await this.mcp.search(claim, { maxResults: this.resultsPerClaim });
          groundings.push({ claim, results });
        } catch (err) {
          // Per-claim failure should not kill the run — record empty evidence.
          this.logger.warn(
            `[TinyfishVerifier] search failed for claim, continuing without evidence: ${String(err)}`,
          );
          groundings.push({ claim, results: [] });
        }
      }

      groundingBlock = renderGroundingBlock(groundings);
    } catch (err) {
      // Whole grounding pipeline failed (claim-extract LLM error, or all
      // searches threw before reaching per-claim catch, etc.). Degrade to the
      // plain LLM verifier path.
      this.logger.warn(
        `[TinyfishVerifier] grounding pipeline failed, degrading to LLM-only verification: ${String(err)}`,
      );
      groundingBlock = '';
    }

    // (c) augment the verify request and (d) parse the report. We always run
    // the verification LLM call — with or without grounding.
    const base = buildVerifyRequest(input);
    const finalReq = augmentVerifyRequest(base, groundingBlock);
    const raw = await this.llm.generate(finalReq);
    return parseVerifyReport(raw);
  }
}
