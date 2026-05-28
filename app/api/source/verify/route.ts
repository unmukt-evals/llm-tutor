// app/api/source/verify/route.ts
// POST { candidate, sourceText } → { report }. Independent third-pass via the
// same LLM client (a DIFFERENT, adversarial prompt). Server-only; the token never
// reaches the client. FOLLOW-ON: swap LLMVerifier for a tinyfish web-grounded
// Verifier behind the same interface.
import { NextResponse } from 'next/server';
import { getVerifier } from '@/lib/llm/verifier-factory';
import type { Candidate, VerificationInput } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

const CURRICULUM_PURPOSE =
  'A local, source-grounded tutor for LLM engineering: each module teaches a real ' +
  'mechanism at three depths (10-year-old, engineer, operator) and is assessed by a ' +
  'misconception-aware MCQ pool. Content must be technically correct and grounded in cited sources.';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { candidate, sourceText } = (body ?? {}) as {
    candidate?: Candidate;
    sourceText?: unknown;
  };
  if (!candidate || typeof candidate.markdown !== 'string' || typeof candidate.poolJson !== 'string') {
    return NextResponse.json({ error: 'Body must include a candidate' }, { status: 400 });
  }
  if (typeof sourceText !== 'string') {
    return NextResponse.json({ error: 'Body must include sourceText' }, { status: 400 });
  }

  const input: VerificationInput = {
    sourceText,
    curriculumPurpose: CURRICULUM_PURPOSE,
    candidateMarkdown: candidate.markdown,
    candidatePoolJson: candidate.poolJson,
  };

  try {
    const verifier = await getVerifier();
    const report = await verifier.verify(input);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
