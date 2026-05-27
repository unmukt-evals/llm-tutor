// src/lib/llm/types.ts
// Shared contracts for the V-PIPE LLM layer. PURE type-only module (no runtime,
// no I/O). The token NEVER appears in any of these types — the client only ever
// receives prompts and returns text; the access token stays inside the impure
// client implementations (oauth-client.ts / client.ts).

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number; // default applied by the client (8192)
  temperature?: number; // default applied by the client (0)
}

/** A pluggable LLM. Strategies: OAuth (primary), API key (fallback). */
export interface LLMClient {
  /** Returns the assistant's text. Throws a clear Error on auth/network/parse failure. */
  generate(req: LLMRequest): Promise<string>;
}

// ── Generation candidate ─────────────────────────────────────────────────────
export interface GenerateInput {
  sourceText: string;
  /** Target module id to UPDATE, or undefined to propose a NEW module. */
  targetModuleId?: string;
  /** The existing module markdown when updating (so the LLM extends, not replaces blindly). */
  existingMarkdown?: string;
  /** The existing pool JSON when updating. */
  existingPoolJson?: string;
}

/** The two files the LLM proposes. Always carried together. */
export interface Candidate {
  moduleId: string;
  markdown: string; // full module .md (frontmatter + sections)
  poolJson: string; // full MCQPool JSON
}

// ── Verification third-pass ──────────────────────────────────────────────────
export interface VerificationInput {
  sourceText: string;
  curriculumPurpose: string; // short statement of why this curriculum exists
  candidateMarkdown: string;
  candidatePoolJson: string;
}

export interface ClaimCheck {
  claim: string;
  groundedInSource: boolean;
  alignedWithPurpose: boolean;
  status: 'verified' | 'unverified' | 'contradicted';
  note: string;
}

export interface VerificationReport {
  claims: ClaimCheck[];
  overallVerdict: 'looks-sound' | 'needs-changes' | 'reject';
  summary: string;
}

/** Independent verifier. FOLLOW-ON: a tinyfish web-grounded verifier behind this same interface. */
export interface Verifier {
  verify(input: VerificationInput): Promise<VerificationReport>;
}
