// src/lib/llm/generate.ts
// Generate/update a module + its MCQ pool from a source. PURE prompt build +
// output parse; the LLM call is the only impure step (the client is injected,
// so generateCandidate is unit-testable with a mock).

import type { Candidate, GenerateInput, LLMClient, LLMRequest } from '@/lib/llm/types';
import { validateCandidate } from '@/lib/llm/candidate';

const SYSTEM = [
  'You generate curriculum content for a local LLM-engineering tutor.',
  'You MUST ground every claim in the provided SOURCE. Do not invent facts.',
  'You MUST return EXACTLY two fenced blocks and nothing that breaks them:',
  'first a ```markdown block containing the COMPLETE module .md file',
  '(YAML frontmatter with module_id + name, then ## Why this matters, ## Anchor scenarios,',
  'a Teach outline with ### 10-year-old pass / ### Engineer pass / ### Operator pass,',
  'and the other standard sections), then a ```json block containing the MCQPool.',
  'The pool MUST have: moduleId (matching the module_id); questions[] each with id, moduleId,',
  'difficulty (easy|medium|hard), dimension (topic|logic|example|extension), stem, exactly 4 options,',
  'correctIndex (0..3), distractorMisconception keyed by EXACTLY the wrong-option indices,',
  'and a non-empty explanation.',
].join(' ');

/** PURE: build the LLM request for generation/update. */
export function buildGenerateRequest(input: GenerateInput): LLMRequest {
  const parts: string[] = [];
  if (input.targetModuleId) {
    parts.push(`Update the EXISTING module "${input.targetModuleId}" using the source below.`);
    parts.push('Extend and correct it; preserve good existing material. Keep the module_id.');
    if (input.existingMarkdown) {
      parts.push(
        '--- EXISTING MODULE MARKDOWN ---',
        input.existingMarkdown,
        '--- END EXISTING MODULE MARKDOWN ---',
      );
    }
    if (input.existingPoolJson) {
      parts.push('--- EXISTING POOL JSON ---', input.existingPoolJson, '--- END EXISTING POOL JSON ---');
    }
  } else {
    parts.push('Propose a NEW module (choose a sensible module_id and name) using the source below.');
  }
  parts.push('--- SOURCE ---', input.sourceText, '--- END SOURCE ---');
  parts.push('Return the two fenced blocks now.');

  return {
    system: SYSTEM,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
    temperature: 0,
    maxTokens: 8192,
  };
}

interface ParsedOutput {
  markdown: string;
  poolJson: string;
}

/**
 * PURE: extract EXACTLY one ```markdown and EXACTLY one ```json fenced block.
 * Throws a clear error on a missing OR duplicate fence, or when either is absent.
 */
export function parseGenerateOutput(raw: string): ParsedOutput {
  const grabAll = (lang: string): string[] => {
    const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```', 'g');
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) out.push(m[1]);
    return out;
  };

  const mdBlocks = grabAll('markdown');
  if (mdBlocks.length === 0) throw new Error('LLM output is missing a ```markdown block.');
  if (mdBlocks.length > 1) throw new Error('LLM output has more than one ```markdown block.');

  const jsonBlocks = grabAll('json');
  if (jsonBlocks.length === 0) throw new Error('LLM output is missing a ```json block.');
  if (jsonBlocks.length > 1) throw new Error('LLM output has more than one ```json block.');

  return { markdown: mdBlocks[0], poolJson: jsonBlocks[0] };
}

/** IMPURE only via the injected client: produce a validated Candidate. */
export async function generateCandidate(
  client: LLMClient,
  input: GenerateInput,
): Promise<Candidate> {
  const req = buildGenerateRequest(input);
  const raw = await client.generate(req);
  const { markdown, poolJson } = parseGenerateOutput(raw);
  const candidate: Candidate = {
    moduleId: input.targetModuleId ?? '', // filled from parsed module below
    markdown,
    poolJson,
  };
  const { module: mod } = validateCandidate(candidate); // throws on guardrail failure
  return { ...candidate, moduleId: mod.id };
}
