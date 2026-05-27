# V-PIPE — Source → Content Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop a URL or paste a transcript → an Anthropic LLM (authed via the user's Claude Code OAuth credential from the macOS Keychain) generates a proposed module markdown + MCQ pool grounded in the source → an independent LLM verification third-pass reports per-claim grounding/alignment → a review-gate diff UI shows old → proposed + the report → on explicit accept, structured atomic writers persist the module `.md` and `mcq/<id>.json` to `CURRICULUM_DIR`.

**Architecture:** Everything that touches the OAuth token, the network, or the filesystem lives behind narrow impure edges; everything else is a PURE, node-env-vitest-tested helper. A pluggable `LLMClient` interface has two strategies: the **primary** OAuth strategy reads `claudeAiOauth.accessToken` from the Keychain (via `security`) and calls Anthropic's `/v1/messages` with the OAuth/`oauth-2025-04-20` beta headers Claude Code uses; the **fallback** API-key strategy reads `ANTHROPIC_API_KEY`. The keychain credential PARSE + expiry-check are pure functions (given the raw JSON string); only the `security` exec and the `fetch` are impure. The generate step builds a prompt (pure) and parses the LLM's structured `<module>…</module>` + `<pool>…</pool>` output (pure) into a candidate that MUST `parseModule`-round-trip AND pass `validatePool` before it is offered. A `Verifier` interface runs an independent anti-yes-man LLM call (pure prompt-build + pure report-parse) producing a structured `VerificationReport`. The diff model is pure; the writers are atomic temp+rename, re-validating immediately before write; nothing writes without an explicit accept. The token is NEVER returned to the client — all LLM/keychain/write work happens in server route handlers; the client only sees source input, the candidate text, the diff, and the report.

**Tech Stack:** Next 15 (App Router), React 19, TypeScript (strict), Tailwind v3 (+ `@tailwindcss/typography`), Vitest 3 (node env, `globals: true`, alias `@` → `src`, test glob `src/**/*.test.ts`). Node built-ins `node:child_process` (Keychain read), `node:fs/promises` (atomic writes). Reuses: `parseModule` (`src/lib/ingest/parse-module.ts`), `validatePool` (`src/lib/mcq/repository.ts`), `Module`/`Viz`/`MCQPool`/`MCQQuestion` (`src/lib/types.ts`), the `/api/state` route pattern, the `JsonStateStore` atomic-write pattern (`src/lib/state/store.ts`), `api-client.ts` fetch-wrapper pattern, `ModuleReaderClient.tsx`. NO new runtime deps (Anthropic called via raw `fetch`; HTML→text is hand-rolled). tinyfish web-grounded verification is a documented FOLLOW-ON behind the same `Verifier` interface — NOT built here.

---

## Design decisions (locked)

- **OAuth credential source = the macOS Keychain item Claude Code already maintains.** Confirmed by inspection (the genuinely-novel piece flagged in the spec's "Open items"): `security find-generic-password -s "Claude Code-credentials" -w` returns JSON `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier }, mcpOAuth: {...} }`. `expiresAt` is an **integer epoch milliseconds**. We read `accessToken`; if `expiresAt` is in the past we throw a clear, actionable error (we do NOT attempt a refresh — refreshing is Claude Code's job; the user runs any Claude Code command to refresh). This is the OAuth/`user:inference` path, so the request sends `anthropic-beta: oauth-2025-04-20` and `Authorization: Bearer <accessToken>` (NOT `x-api-key`).
- **`LLMClient` interface (one method, message-based):**
  ```ts
  // src/lib/llm/types.ts
  export interface LLMMessage {
    role: 'user' | 'assistant';
    content: string;
  }
  export interface LLMRequest {
    system?: string;
    messages: LLMMessage[];
    maxTokens?: number; // default 8192
    temperature?: number; // default 0
  }
  export interface LLMClient {
    /** Returns the assistant's text. Throws a clear Error on auth/network/parse failure. */
    generate(req: LLMRequest): Promise<string>;
  }
  ```
- **`Verifier` interface (independent third-pass):**
  ```ts
  // src/lib/llm/types.ts (same file)
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
  export interface Verifier {
    verify(input: VerificationInput): Promise<VerificationReport>;
  }
  ```
- **The LLM strategies are the ONLY impure edges in the LLM layer.** `parseCredentialJson` (string → `{ accessToken; expiresAt }`), `assertNotExpired` (epoch ms + now → throw or return), `buildGenerateRequest` (inputs → `LLMRequest`), `parseGenerateOutput` (raw text → `{ markdown; poolJson }`), `buildVerifyRequest`, `parseVerifyReport` are ALL pure and unit-tested with literals. The `OAuthLLMClient`/`ApiKeyLLMClient` only do exec + fetch and delegate parsing to the pure helpers. In tests, `Verifier`/`LLMClient` are hand-mocked objects (no network).
- **"Round-trip" guardrail = the LLM emits a FULL module `.md`; we run `parseModule` on it and assert the result is a structurally-complete `Module`.** The existing parser is intentionally lossy (it ignores e.g. "Teach outline", "Session log"), so a byte-identical round-trip is impossible and NOT the contract. The contract (`assertParsesAsModule`, pure) is: `parseModule(markdown)` does not throw AND the resulting `Module` has a non-empty `id`, non-empty `name`, non-empty `whyThisMatters`, and at least one depth pass. Any `visuals` declared still parse via the existing `parseVisuals`. The pool guardrail is the existing `validatePool` (throws on malformed).
- **The LLM must return a strict envelope** so parsing is deterministic: exactly one ` ```markdown … ``` ` fenced block (the module file, frontmatter included) followed by exactly one ` ```json … ``` ` fenced block (the pool). `parseGenerateOutput` extracts the two fences by language tag; missing/duplicate fence → clear throw. The verify call returns one ` ```json … ``` ` block matching `VerificationReport`.
- **Diff model is pure + line-based.** `diffLines(oldText, newText)` → `DiffLine[]` (a minimal LCS line diff, no dep). The review UI renders old-module-vs-proposed-module and old-pool-vs-proposed-pool diffs plus the report. "Accept-all" applies the whole candidate; per-section accept lets the user accept the module, the pool, or both independently (a candidate is two files; per-FILE accept is the granularity).
- **Writers re-validate immediately before writing.** `applyCandidate` calls `assertParsesAsModule` + `validatePool` again right before the atomic temp+rename, so even a candidate that sat in a request body cannot be written if malformed. Module file path = `<CURRICULUM_DIR>/<fileName>` where `fileName` is `<id>-<slug>.md` for a new module, or the EXISTING file's basename when updating (passed through from the route, which resolves it by reading the dir). Pool path = `<CURRICULUM_DIR>/mcq/<id>.json`.
- **Token never reaches the client.** All four routes (`/api/source/fetch`, `/api/source/generate`, `/api/source/verify`, `/api/source/apply`) are server route handlers (`export const dynamic = 'force-dynamic'`). The keychain read happens only inside `OAuthLLMClient`. Responses contain only source text, candidate markdown/pool, the report, and the diff — never the access token. A test asserts the access token string never appears in any route's JSON response shape (by construction: the client type has no token field).

## File structure

| File | Responsibility |
|---|---|
| `src/lib/llm/types.ts` (create) | `LLMMessage`, `LLMRequest`, `LLMClient`, `VerificationInput`, `ClaimCheck`, `VerificationReport`, `Verifier`. |
| `src/lib/llm/credential.ts` (create) | PURE `parseCredentialJson(raw)` + `assertNotExpired(expiresAt, now)`. |
| `src/lib/llm/__tests__/credential.test.ts` (create) | Unit tests for credential parse + expiry. |
| `src/lib/llm/oauth-client.ts` (create) | `OAuthLLMClient` (impure: `security` exec + Anthropic fetch); reads via `credential.ts`. |
| `src/lib/llm/api-key-client.ts` (create) | `ApiKeyLLMClient` (impure: Anthropic fetch with `x-api-key`) — documented fallback. |
| `src/lib/llm/client-factory.ts` (create) | `getLLMClient()` → OAuth if keychain available, else API-key if `ANTHROPIC_API_KEY` set, else clear throw. |
| `src/lib/llm/generate.ts` (create) | PURE `buildGenerateRequest(input)` + `parseGenerateOutput(raw)`; impure `generateCandidate(client, input)`. |
| `src/lib/llm/__tests__/generate.test.ts` (create) | Unit tests for build + parse + `generateCandidate` with a mock client. |
| `src/lib/llm/verify.ts` (create) | PURE `buildVerifyRequest(input)` + `parseVerifyReport(raw)`; `LLMVerifier` class wrapping an `LLMClient`. |
| `src/lib/llm/__tests__/verify.test.ts` (create) | Unit tests for build + parse + `LLMVerifier` with a mock client. |
| `src/lib/llm/candidate.ts` (create) | PURE `assertParsesAsModule(markdown)` (uses `parseModule`); `validateCandidate(c)` (module + pool). |
| `src/lib/llm/__tests__/candidate.test.ts` (create) | Unit tests for the round-trip + pool guardrails. |
| `src/lib/source/html-to-text.ts` (create) | PURE `htmlToText(html)` — strip scripts/styles/tags, decode entities, collapse whitespace. |
| `src/lib/source/__tests__/html-to-text.test.ts` (create) | Unit tests for `htmlToText`. |
| `src/lib/source/fetch-url.ts` (create) | Impure `fetchUrlText(url)` — `fetch` + `htmlToText`. |
| `src/lib/source/diff.ts` (create) | PURE `diffLines(oldText, newText)` → `DiffLine[]`. |
| `src/lib/source/__tests__/diff.test.ts` (create) | Unit tests for `diffLines`. |
| `src/lib/source/apply.ts` (create) | Impure `applyCandidate(dir, candidate, fileName)` — re-validate + atomic writes. PURE `moduleSlug(name)` + `moduleFileName(id, name)`. |
| `src/lib/source/__tests__/apply.test.ts` (create) | Unit tests: pure namers; impure write into a tmp dir (real fs). |
| `src/lib/source/api-client.ts` (create) | Client fetch wrappers for the four `/api/source/*` routes (browser-only). |
| `app/api/source/fetch/route.ts` (create) | POST `{ url }` → `{ text }`. |
| `app/api/source/generate/route.ts` (create) | POST `{ sourceText, targetModuleId? }` → `{ candidate, oldMarkdown, oldPoolJson }`. |
| `app/api/source/verify/route.ts` (create) | POST `{ candidate, sourceText }` → `{ report }`. |
| `app/api/source/apply/route.ts` (create) | POST `{ candidate }` → `{ ok: true }` (writes; re-validates first). |
| `app/(shell)/source/page.tsx` (create) | Server page: `Add source` route; renders the client review-gate. |
| `src/components/SourcePipelineClient.tsx` (create) | Client UI: input → generate → verify → diff → accept/apply. |
| `app/(shell)/source/__smoke__` (n/a) | Components validated by typecheck + build (vitest is node-env). |

---

## Task 1: LLM layer types

**Files:**
- Create: `src/lib/llm/types.ts`
- Test: (covered by typecheck; consumed by later tasks)

- [ ] **Step 1: Write the types file**

```ts
// src/lib/llm/types.ts
// Shared contracts for the V-PIPE LLM layer. PURE type-only module (no runtime,
// no I/O). The token NEVER appears in any of these types — the client only ever
// receives prompts and returns text; the access token stays inside the impure
// client implementations (oauth-client.ts).

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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm/types.ts
git commit -m "feat(v1c): add LLMClient + Verifier + Candidate interfaces

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Keychain credential parse + expiry (PURE)

**Files:**
- Create: `src/lib/llm/credential.ts`
- Test: `src/lib/llm/__tests__/credential.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/llm/__tests__/credential.test.ts
import { describe, it, expect } from 'vitest';
import { parseCredentialJson, assertNotExpired } from '@/lib/llm/credential';

const FUTURE = 32503680000000; // year 3000 in epoch ms
const PAST = 1000; // 1970

function rawCred(expiresAt: number): string {
  return JSON.stringify({
    claudeAiOauth: { accessToken: 'tok-abc', refreshToken: 'r', expiresAt, scopes: ['user:inference'] },
  });
}

describe('parseCredentialJson', () => {
  it('extracts the access token and expiresAt', () => {
    const c = parseCredentialJson(rawCred(FUTURE));
    expect(c.accessToken).toBe('tok-abc');
    expect(c.expiresAt).toBe(FUTURE);
  });

  it('throws a clear error when JSON is unparseable', () => {
    expect(() => parseCredentialJson('not json')).toThrow(/parse/i);
  });

  it('throws when claudeAiOauth.accessToken is missing', () => {
    expect(() => parseCredentialJson(JSON.stringify({ claudeAiOauth: {} }))).toThrow(/accessToken/);
  });
});

describe('assertNotExpired', () => {
  it('passes when expiresAt is in the future', () => {
    expect(() => assertNotExpired(FUTURE, new Date(0))).not.toThrow();
  });

  it('throws an actionable error when expired', () => {
    expect(() => assertNotExpired(PAST, new Date(FUTURE))).toThrow(
      /expired.*run any Claude Code command/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/llm/__tests__/credential.test.ts`
Expected: FAIL — cannot resolve `@/lib/llm/credential`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/llm/credential.ts
// PURE helpers for the Claude Code OAuth credential. NO I/O here — the raw JSON
// is read by the impure client (oauth-client.ts) and passed in. expiresAt is an
// integer epoch-milliseconds timestamp (confirmed by inspecting the live item).

export interface ClaudeCredential {
  accessToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Parse the JSON returned by `security find-generic-password -s "Claude Code-credentials" -w`.
 * Shape: { claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, ... }, ... }.
 * Throws a clear error if unparseable or missing the access token.
 */
export function parseCredentialJson(raw: string): ClaudeCredential {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('Could not parse Claude OAuth credential JSON from the Keychain.');
  }
  const oauth = (obj as { claudeAiOauth?: unknown })?.claudeAiOauth as
    | { accessToken?: unknown; expiresAt?: unknown }
    | undefined;
  if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken.length === 0) {
    throw new Error('Claude OAuth credential is missing claudeAiOauth.accessToken.');
  }
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0;
  return { accessToken: oauth.accessToken, expiresAt };
}

/**
 * Throw a clear, actionable error if the token has already expired.
 * `now` is injected so this is deterministic and unit-testable.
 */
export function assertNotExpired(expiresAt: number, now: Date): void {
  if (expiresAt !== 0 && expiresAt <= now.getTime()) {
    throw new Error(
      'Claude OAuth token expired — run any Claude Code command to refresh it, then retry.',
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/llm/__tests__/credential.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/credential.ts src/lib/llm/__tests__/credential.test.ts
git commit -m "feat(v1c): pure Claude OAuth credential parse + expiry check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: OAuth + API-key LLM clients (impure edges) + factory

**Files:**
- Create: `src/lib/llm/oauth-client.ts`
- Create: `src/lib/llm/api-key-client.ts`
- Create: `src/lib/llm/client-factory.ts`
- Test: validated by typecheck + build (impure network/exec edges are not unit-tested; pure parsing they delegate to is tested in Task 2).

- [ ] **Step 1: Write the OAuth client**

```ts
// src/lib/llm/oauth-client.ts
// IMPURE edge: reads the Claude Code OAuth token from the macOS Keychain and
// calls Anthropic's Messages API on the OAuth (user:inference) path. SERVER-ONLY.
// The access token NEVER leaves this module.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LLMClient, LLMRequest } from '@/lib/llm/types';
import { parseCredentialJson, assertNotExpired } from '@/lib/llm/credential';

const execFileAsync = promisify(execFile);

// A current Claude model id. Update when migrating model versions.
export const DEFAULT_MODEL = 'claude-opus-4-20250514';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

async function readKeychainCredential(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    return stdout.trim();
  } catch {
    throw new Error(
      `Could not read the Claude Code OAuth credential from the Keychain (service "${KEYCHAIN_SERVICE}"). Sign in with Claude Code first.`,
    );
  }
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  error?: { message?: string };
}

export class OAuthLLMClient implements LLMClient {
  constructor(
    private readonly model: string = DEFAULT_MODEL,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(req: LLMRequest): Promise<string> {
    const raw = await readKeychainCredential();
    const cred = parseCredentialJson(raw);
    assertNotExpired(cred.expiresAt, this.now());

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cred.accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 8192,
        temperature: req.temperature ?? 0,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }
    const json = (await res.json()) as AnthropicResponse;
    if (json.error?.message) throw new Error(`Anthropic error: ${json.error.message}`);
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    if (!text) throw new Error('Anthropic returned an empty response.');
    return text;
  }
}
```

- [ ] **Step 2: Write the API-key fallback client**

```ts
// src/lib/llm/api-key-client.ts
// IMPURE edge: documented fallback strategy. Calls Anthropic's Messages API with
// a pay-per-token API key (env ANTHROPIC_API_KEY) instead of the OAuth path.
// SERVER-ONLY. Same LLMClient interface as OAuthLLMClient.

import type { LLMClient, LLMRequest } from '@/lib/llm/types';
import { DEFAULT_MODEL } from '@/lib/llm/oauth-client';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  error?: { message?: string };
}

export class ApiKeyLLMClient implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(req: LLMRequest): Promise<string> {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 8192,
        temperature: req.temperature ?? 0,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }
    const json = (await res.json()) as AnthropicResponse;
    if (json.error?.message) throw new Error(`Anthropic error: ${json.error.message}`);
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
    if (!text) throw new Error('Anthropic returned an empty response.');
    return text;
  }
}
```

- [ ] **Step 3: Write the factory**

```ts
// src/lib/llm/client-factory.ts
// SERVER-ONLY. Chooses the LLM strategy: OAuth (primary), API key (fallback).
// The OAuth client lazily validates the Keychain at call time, so the factory
// returns it whenever an explicit ANTHROPIC_API_KEY is NOT set.

import type { LLMClient } from '@/lib/llm/types';
import { OAuthLLMClient } from '@/lib/llm/oauth-client';
import { ApiKeyLLMClient } from '@/lib/llm/api-key-client';

export function getLLMClient(): LLMClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey.length > 0) return new ApiKeyLLMClient(apiKey);
  // Default: OAuth via the Claude Code Keychain credential.
  return new OAuthLLMClient();
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/oauth-client.ts src/lib/llm/api-key-client.ts src/lib/llm/client-factory.ts
git commit -m "feat(v1c): OAuth + API-key LLM clients + strategy factory

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Candidate guardrails — module round-trip + pool validation (PURE)

**Files:**
- Create: `src/lib/llm/candidate.ts`
- Test: `src/lib/llm/__tests__/candidate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/llm/__tests__/candidate.test.ts`
Expected: FAIL — cannot resolve `@/lib/llm/candidate`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/llm/candidate.ts
// PURE guardrails. A candidate is only ever offered/applied if BOTH hold:
//   - the markdown parses as a structurally-complete Module (round-trip contract)
//   - the pool JSON parses + passes validatePool
// The existing parseModule is intentionally lossy, so the contract is structural
// completeness, NOT a byte-identical round-trip.

import { parseModule } from '@/lib/ingest/parse-module';
import { validatePool } from '@/lib/mcq/repository';
import type { Module } from '@/lib/types';
import type { Candidate } from '@/lib/llm/types';

/**
 * Parse `markdown` via the production parser and assert the result is a usable
 * Module. Throws a clear error otherwise. Returns the parsed Module on success.
 */
export function assertParsesAsModule(markdown: string): Module {
  let mod: Module;
  try {
    mod = parseModule(markdown);
  } catch (err) {
    throw new Error(`Proposed module markdown did not parse: ${String(err)}`);
  }
  if (!mod.id || mod.id.length === 0) {
    throw new Error('Proposed module is missing module_id / id.');
  }
  if (!mod.name || mod.name.length === 0) {
    throw new Error('Proposed module is missing a name.');
  }
  if (!mod.whyThisMatters || mod.whyThisMatters.trim().length === 0) {
    throw new Error('Proposed module is missing a non-empty "Why this matters" section.');
  }
  const hasPass = Boolean(mod.passes.tenYearOld || mod.passes.engineer || mod.passes.operator);
  if (!hasPass) {
    throw new Error('Proposed module has no depth pass (10-year-old / Engineer / Operator).');
  }
  return mod;
}

/** Validate BOTH files of a candidate. Throws on the first failure. */
export function validateCandidate(c: Candidate): { module: Module } {
  const module = assertParsesAsModule(c.markdown);
  let parsedPool: unknown;
  try {
    parsedPool = JSON.parse(c.poolJson);
  } catch {
    throw new Error('Proposed MCQ pool is not valid JSON.');
  }
  validatePool(parsedPool); // throws with a human-readable message on failure
  return { module };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/llm/__tests__/candidate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/candidate.ts src/lib/llm/__tests__/candidate.test.ts
git commit -m "feat(v1c): candidate guardrails — module round-trip + validatePool

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Generate — prompt build + output parse + generateCandidate (PURE core + mocked edge)

**Files:**
- Create: `src/lib/llm/generate.ts`
- Test: `src/lib/llm/__tests__/generate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

  it('throws when the LLM output fails the guardrails', async () => {
    const client: LLMClient = {
      async generate() {
        return envelope(GOOD_MD, '{ broken');
      },
    };
    await expect(generateCandidate(client, { sourceText: 'S' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/llm/__tests__/generate.test.ts`
Expected: FAIL — cannot resolve `@/lib/llm/generate`.

- [ ] **Step 3: Write the implementation**

```ts
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
  'The pool MUST have: moduleId; questions[] each with id, moduleId, difficulty',
  '(easy|medium|hard), dimension (topic|logic|example|extension), stem, exactly 4 options,',
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
      parts.push('--- EXISTING MODULE MARKDOWN ---', input.existingMarkdown, '--- END EXISTING MODULE MARKDOWN ---');
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

/** PURE: extract the single ```markdown and single ```json fenced blocks. */
export function parseGenerateOutput(raw: string): ParsedOutput {
  const grab = (lang: string): string | null => {
    // Match a fenced block opening with the given language tag.
    const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```', 'm');
    const m = re.exec(raw);
    return m ? m[1] : null;
  };
  const markdown = grab('markdown');
  if (markdown === null) throw new Error('LLM output is missing a ```markdown block.');
  const poolJson = grab('json');
  if (poolJson === null) throw new Error('LLM output is missing a ```json block.');
  return { markdown, poolJson };
}

/** IMPURE only via the injected client: produce a validated Candidate. */
export async function generateCandidate(client: LLMClient, input: GenerateInput): Promise<Candidate> {
  const req = buildGenerateRequest(input);
  const raw = await client.generate(req);
  const { markdown, poolJson } = parseGenerateOutput(raw);
  const candidate: Candidate = {
    moduleId: input.targetModuleId ?? '', // filled from parsed module below
    markdown,
    poolJson,
  };
  const { module } = validateCandidate(candidate); // throws on guardrail failure
  return { ...candidate, moduleId: module.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/llm/__tests__/generate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/generate.ts src/lib/llm/__tests__/generate.test.ts
git commit -m "feat(v1c): generate — prompt build + output parse + generateCandidate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Verify — anti-yes-man prompt build + report parse + LLMVerifier (PURE core + mocked edge)

**Files:**
- Create: `src/lib/llm/verify.ts`
- Test: `src/lib/llm/__tests__/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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

  it('throws on a report missing overallVerdict', () => {
    expect(() => parseVerifyReport(JSON.stringify({ claims: [] }))).toThrow(/verdict/i);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/llm/__tests__/verify.test.ts`
Expected: FAIL — cannot resolve `@/lib/llm/verify`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/llm/verify.ts
// Independent verification third-pass. Implements the Verifier interface with an
// LLMClient. PURE prompt build + report parse; the call is the only impure step
// (client injected → unit-testable with a mock).
// FOLLOW-ON: a TinyfishVerifier behind this same Verifier interface that grounds
// claims against the live web via mcp__tinyfish__search/fetch_content.

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
    'Verify now. Be adversarial. Return the json report.',
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/llm/__tests__/verify.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/verify.ts src/lib/llm/__tests__/verify.test.ts
git commit -m "feat(v1c): verify — anti-yes-man third-pass (prompt build + report parse + LLMVerifier)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: HTML → text extractor (PURE) + URL fetch edge

**Files:**
- Create: `src/lib/source/html-to-text.ts`
- Create: `src/lib/source/fetch-url.ts`
- Test: `src/lib/source/__tests__/html-to-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/source/__tests__/html-to-text.test.ts
import { describe, it, expect } from 'vitest';
import { htmlToText } from '@/lib/source/html-to-text';

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script and style content entirely', () => {
    const html = '<style>.a{color:red}</style><p>keep</p><script>var x=1;</script>';
    expect(htmlToText(html)).toBe('keep');
  });

  it('decodes common entities', () => {
    expect(htmlToText('<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39; &nbsp;g</p>'))
      .toBe('a & b < c > d "e" \'f\' g');
  });

  it('collapses whitespace and newlines', () => {
    expect(htmlToText('<div>one</div>\n\n\n<div>two</div>')).toBe('one\ntwo');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/source/__tests__/html-to-text.test.ts`
Expected: FAIL — cannot resolve `@/lib/source/html-to-text`.

- [ ] **Step 3: Write the implementations**

```ts
// src/lib/source/html-to-text.ts
// PURE, dependency-free HTML → readable text. Good enough for feeding a source
// page into the LLM: drops script/style, converts block boundaries to newlines,
// strips remaining tags, decodes common entities, collapses whitespace.

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function htmlToText(html: string): string {
  if (!html) return '';
  let s = html;
  // Drop script/style blocks (content included).
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  // Block-level close/break tags → newline boundaries.
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (m) => ENTITIES[m] ?? m);
  // Collapse runs of spaces/tabs, trim each line, drop blank lines, trim ends.
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return s.trim();
}
```

```ts
// src/lib/source/fetch-url.ts
// IMPURE edge: server-side fetch of a source URL → readable text via htmlToText.
import { htmlToText } from '@/lib/source/html-to-text';

export async function fetchUrlText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'llm-tutor/1.0' } });
  } catch (err) {
    throw new Error(`Could not fetch URL: ${String(err)}`);
  }
  if (!res.ok) throw new Error(`URL fetch failed: ${res.status} ${res.statusText}`);
  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();
  if (ct.includes('text/html') || /<html|<body|<p[ >]/i.test(body)) return htmlToText(body);
  // Plain text / markdown / json source: pass through.
  return body.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/source/__tests__/html-to-text.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/source/html-to-text.ts src/lib/source/fetch-url.ts src/lib/source/__tests__/html-to-text.test.ts
git commit -m "feat(v1c): html-to-text extractor + URL fetch edge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Line diff model (PURE)

**Files:**
- Create: `src/lib/source/diff.ts`
- Test: `src/lib/source/__tests__/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/source/__tests__/diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffLines } from '@/lib/source/diff';

describe('diffLines', () => {
  it('marks unchanged lines as context', () => {
    const d = diffLines('a\nb', 'a\nb');
    expect(d.map((l) => l.kind)).toEqual(['context', 'context']);
  });

  it('marks an added line', () => {
    const d = diffLines('a', 'a\nb');
    expect(d).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('marks a removed line', () => {
    const d = diffLines('a\nb', 'a');
    expect(d).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'b' },
    ]);
  });

  it('handles a replaced line as remove then add', () => {
    const d = diffLines('a\nx\nc', 'a\ny\nc');
    expect(d).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'remove', text: 'x' },
      { kind: 'add', text: 'y' },
      { kind: 'context', text: 'c' },
    ]);
  });

  it('treats empty-old as all additions', () => {
    const d = diffLines('', 'a\nb');
    expect(d).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/source/__tests__/diff.test.ts`
Expected: FAIL — cannot resolve `@/lib/source/diff`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/source/diff.ts
// PURE, dependency-free line diff via LCS. Renders old → proposed in the review
// gate. `remove` lines precede `add` lines at each divergence (replace shows as
// remove-then-add). Empty old/new degrade to all-add / all-remove.

export type DiffKind = 'context' | 'add' | 'remove';
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

function splitLines(s: string): string[] {
  // An empty string is zero lines (not one empty line) for diff purposes.
  return s.length === 0 ? [] : s.split('\n');
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: a[i] });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/source/__tests__/diff.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/source/diff.ts src/lib/source/__tests__/diff.test.ts
git commit -m "feat(v1c): pure LCS line-diff model for the review gate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Apply — file namers (PURE) + atomic structured writers (real-fs test)

**Files:**
- Create: `src/lib/source/apply.ts`
- Test: `src/lib/source/__tests__/apply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/source/__tests__/apply.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moduleSlug, moduleFileName, applyCandidate } from '@/lib/source/apply';
import type { Candidate } from '@/lib/llm/types';

const GOOD_MD = `---\nmodule_id: M99\nname: Test Module\n---\n\n## Why this matters\n\nbecause.\n\n### Engineer pass\n- x\n`;
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

describe('moduleSlug / moduleFileName', () => {
  it('slugifies a name', () => {
    expect(moduleSlug('Embeddings & Vectors!')).toBe('embeddings-vectors');
  });
  it('builds <id>-<slug>.md', () => {
    expect(moduleFileName('M02', 'Embeddings')).toBe('M02-embeddings.md');
  });
});

describe('applyCandidate', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-apply-'));
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the module .md and mcq/<id>.json', async () => {
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: GOOD_POOL };
    const result = await applyCandidate(dir, c, 'M99-test-module.md');
    const md = await readFile(join(dir, 'M99-test-module.md'), 'utf8');
    const pool = await readFile(join(dir, 'mcq', 'M99.json'), 'utf8');
    expect(md).toContain('module_id: M99');
    expect(JSON.parse(pool).moduleId).toBe('M99');
    expect(result.moduleFile).toBe('M99-test-module.md');
    expect(result.poolFile).toBe('mcq/M99.json');
  });

  it('re-validates and refuses to write a malformed pool', async () => {
    const c: Candidate = { moduleId: 'M99', markdown: GOOD_MD, poolJson: '{ broken' };
    await expect(applyCandidate(dir, c, 'M99-test-module.md')).rejects.toThrow();
    // Nothing written.
    await expect(readFile(join(dir, 'M99-test-module.md'), 'utf8')).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/source/__tests__/apply.test.ts`
Expected: FAIL — cannot resolve `@/lib/source/apply`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/source/apply.ts
// Apply a candidate to CURRICULUM_DIR. PURE namers; IMPURE atomic writers that
// RE-VALIDATE (assertParsesAsModule + validatePool) immediately before writing.
// Atomic = write to <path>.tmp then rename over the target (same fs), mirroring
// JsonStateStore.write. NEVER uses sed; this is the only place V-PIPE writes .md.

import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Candidate } from '@/lib/llm/types';
import { validateCandidate } from '@/lib/llm/candidate';

/** PURE: kebab-case slug from a module name (alnum runs joined by '-'). */
export function moduleSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** PURE: default module filename "<id>-<slug>.md" for a NEW module. */
export function moduleFileName(id: string, name: string): string {
  const slug = moduleSlug(name);
  return slug ? `${id}-${slug}.md` : `${id}.md`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export interface ApplyResult {
  moduleFile: string; // relative to dir
  poolFile: string; // relative to dir
}

/**
 * Write the candidate's module .md (at `moduleFileName`, relative to `dir`) and
 * its pool at `mcq/<id>.json`. Re-validates FIRST; throws (writing nothing) if
 * the candidate fails the guardrails. The pool is written pretty-printed.
 */
export async function applyCandidate(
  dir: string,
  candidate: Candidate,
  moduleFileName: string,
): Promise<ApplyResult> {
  // Re-validate at the last possible moment (defense in depth).
  validateCandidate(candidate); // throws on malformed markdown or pool

  const moduleAbs = join(dir, moduleFileName);
  const poolRel = join('mcq', `${candidate.moduleId}.json`);
  const poolAbs = join(dir, poolRel);

  // Normalize pool JSON formatting (pretty-printed, trailing newline).
  const poolPretty = `${JSON.stringify(JSON.parse(candidate.poolJson), null, 2)}\n`;

  await atomicWrite(moduleAbs, candidate.markdown.endsWith('\n') ? candidate.markdown : `${candidate.markdown}\n`);
  await atomicWrite(poolAbs, poolPretty);

  return { moduleFile: moduleFileName, poolFile: poolRel };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/source/__tests__/apply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/source/apply.ts src/lib/source/__tests__/apply.test.ts
git commit -m "feat(v1c): apply — pure namers + atomic re-validating writers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Server routes — fetch, generate, verify, apply

**Files:**
- Create: `app/api/source/fetch/route.ts`
- Create: `app/api/source/generate/route.ts`
- Create: `app/api/source/verify/route.ts`
- Create: `app/api/source/apply/route.ts`
- Test: validated by typecheck + build (route handlers; the logic they call is unit-tested in Tasks 2–9). The OAuth token is never put in any response body — by construction the route returns only text/candidate/report/diff.

- [ ] **Step 1: Write the fetch route**

```ts
// app/api/source/fetch/route.ts
// POST { url } → { text }. Server-only; fetches a source URL and extracts text.
import { NextResponse } from 'next/server';
import { fetchUrlText } from '@/lib/source/fetch-url';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || url.length === 0) {
    return NextResponse.json({ error: 'Body must be { url: string }' }, { status: 400 });
  }
  try {
    const text = await fetchUrlText(url);
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write the generate route**

```ts
// app/api/source/generate/route.ts
// POST { sourceText, targetModuleId? } → { candidate, oldMarkdown, oldPoolJson }.
// Server-only: runs the LLM (OAuth/keychain), validates the candidate. The access
// token NEVER appears in the response — only the proposed files.
import { NextResponse } from 'next/server';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getLLMClient } from '@/lib/llm/client-factory';
import { generateCandidate } from '@/lib/llm/generate';
import type { GenerateInput } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set.');
  return dir;
}

/** Find the existing module .md file for a given module id (frontmatter scan by filename prefix). */
async function findModuleFile(dir: string, moduleId: string): Promise<string | null> {
  const entries = await readdir(dir);
  const match = entries.find((f) => f.endsWith('.md') && f.startsWith(`${moduleId}-`));
  if (match) return match;
  const exact = entries.find((f) => f === `${moduleId}.md`);
  return exact ?? null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { sourceText, targetModuleId } = (body ?? {}) as {
    sourceText?: unknown;
    targetModuleId?: unknown;
  };
  if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
    return NextResponse.json({ error: 'Body must include non-empty sourceText' }, { status: 400 });
  }

  const dir = getCurriculumDir();
  const input: GenerateInput = { sourceText };
  let oldMarkdown = '';
  let oldPoolJson = '';
  let moduleFileName: string | null = null;

  if (typeof targetModuleId === 'string' && targetModuleId.length > 0) {
    input.targetModuleId = targetModuleId;
    moduleFileName = await findModuleFile(dir, targetModuleId);
    if (moduleFileName) {
      oldMarkdown = await readFile(join(dir, moduleFileName), 'utf8').catch(() => '');
      input.existingMarkdown = oldMarkdown;
    }
    oldPoolJson = await readFile(join(dir, 'mcq', `${targetModuleId}.json`), 'utf8').catch(() => '');
    if (oldPoolJson) input.existingPoolJson = oldPoolJson;
  }

  try {
    const client = getLLMClient();
    const candidate = await generateCandidate(client, input);
    return NextResponse.json({
      candidate,
      oldMarkdown,
      oldPoolJson,
      moduleFileName, // null → a NEW module (client uses default name on apply)
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 3: Write the verify route**

```ts
// app/api/source/verify/route.ts
// POST { candidate, sourceText } → { report }. Independent third-pass via the
// same LLM client (a DIFFERENT, adversarial prompt). FOLLOW-ON: swap LLMVerifier
// for a tinyfish web-grounded Verifier behind the same interface.
import { NextResponse } from 'next/server';
import { getLLMClient } from '@/lib/llm/client-factory';
import { LLMVerifier } from '@/lib/llm/verify';
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
    const verifier = new LLMVerifier(getLLMClient());
    const report = await verifier.verify(input);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
```

- [ ] **Step 4: Write the apply route**

```ts
// app/api/source/apply/route.ts
// POST { candidate, moduleFileName? } → { ok: true, written }. Re-validates and
// atomically writes the module .md + mcq/<id>.json. Nothing is written unless the
// request reaches here (explicit accept on the client). Server-only.
import { NextResponse } from 'next/server';
import { applyCandidate, moduleFileName as defaultModuleFileName } from '@/lib/source/apply';
import { assertParsesAsModule } from '@/lib/llm/candidate';
import type { Candidate } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set.');
  return dir;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { candidate, moduleFileName } = (body ?? {}) as {
    candidate?: Candidate;
    moduleFileName?: unknown;
  };
  if (!candidate || typeof candidate.markdown !== 'string' || typeof candidate.poolJson !== 'string') {
    return NextResponse.json({ error: 'Body must include a candidate' }, { status: 400 });
  }

  try {
    const dir = getCurriculumDir();
    // Resolve filename: prefer the existing file passed through; else derive a default.
    const mod = assertParsesAsModule(candidate.markdown);
    const fileName =
      typeof moduleFileName === 'string' && moduleFileName.length > 0
        ? moduleFileName
        : defaultModuleFileName(mod.id, mod.name);
    const written = await applyCandidate(dir, candidate, fileName);
    return NextResponse.json({ ok: true, written });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (routes compile; build succeeds).

- [ ] **Step 6: Commit**

```bash
git add app/api/source
git commit -m "feat(v1c): server routes — source fetch/generate/verify/apply

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Client fetch wrappers for the source routes

**Files:**
- Create: `src/lib/source/api-client.ts`
- Test: validated by typecheck + build (browser fetch wrappers, mirrors `src/lib/api-client.ts` which is also untested-by-unit).

- [ ] **Step 1: Write the client**

```ts
// src/lib/source/api-client.ts
// Browser-only fetch wrappers for /api/source/*. Mirrors src/lib/api-client.ts.
// NEVER import from server code. The server never returns the access token, so
// none of these response shapes carry it.
'use client';

import type { Candidate, VerificationReport } from '@/lib/llm/types';

async function errMsg(res: Response, prefix: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return `${prefix}: ${res.status} — ${body.error}`;
  } catch {
    /* not JSON */
  }
  return `${prefix}: ${res.status} ${res.statusText}`;
}

export async function fetchSourceUrl(url: string): Promise<string> {
  const res = await fetch('/api/source/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'fetchSourceUrl'));
  return ((await res.json()) as { text: string }).text;
}

export interface GenerateResult {
  candidate: Candidate;
  oldMarkdown: string;
  oldPoolJson: string;
  moduleFileName: string | null;
}

export async function generateFromSource(
  sourceText: string,
  targetModuleId?: string,
): Promise<GenerateResult> {
  const res = await fetch('/api/source/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceText, targetModuleId }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'generateFromSource'));
  return (await res.json()) as GenerateResult;
}

export async function verifyCandidate(
  candidate: Candidate,
  sourceText: string,
): Promise<VerificationReport> {
  const res = await fetch('/api/source/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate, sourceText }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'verifyCandidate'));
  return ((await res.json()) as { report: VerificationReport }).report;
}

export async function applyCandidate(
  candidate: Candidate,
  moduleFileName: string | null,
): Promise<{ moduleFile: string; poolFile: string }> {
  const res = await fetch('/api/source/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate, moduleFileName }),
  });
  if (!res.ok) throw new Error(await errMsg(res, 'applyCandidate'));
  return ((await res.json()) as { written: { moduleFile: string; poolFile: string } }).written;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/source/api-client.ts
git commit -m "feat(v1c): browser fetch wrappers for /api/source/*

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Review-gate UI — SourcePipelineClient + the /source page

**Files:**
- Create: `src/components/SourcePipelineClient.tsx`
- Create: `app/(shell)/source/page.tsx`
- Test: validated by typecheck + build (client component; vitest is node-env and does not render React). The pure diff/parse logic it relies on is unit-tested in Tasks 8/5/6.

- [ ] **Step 1: Write the client component**

```tsx
// src/components/SourcePipelineClient.tsx
// Review-gate UI for V-PIPE. Steps: (1) input source (URL → fetch, or paste a
// transcript) + optional target module; (2) Generate → a Candidate; (3) Verify →
// a VerificationReport; (4) review the DIFF (old → proposed module + pool) and the
// report; (5) Accept-all → apply (writes). Nothing writes without the Accept click.
'use client';

import { useState } from 'react';
import {
  fetchSourceUrl,
  generateFromSource,
  verifyCandidate,
  applyCandidate,
  type GenerateResult,
} from '@/lib/source/api-client';
import { diffLines, type DiffLine } from '@/lib/source/diff';
import type { VerificationReport } from '@/lib/llm/types';

function DiffView({ oldText, newText, label }: { oldText: string; newText: string; label: string }) {
  const lines: DiffLine[] = diffLines(oldText, newText);
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
      <pre className="mt-1 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'add'
                ? 'bg-green-100 text-green-900'
                : l.kind === 'remove'
                  ? 'bg-red-100 text-red-900 line-through'
                  : 'text-gray-600'
            }
          >
            {l.kind === 'add' ? '+ ' : l.kind === 'remove' ? '- ' : '  '}
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ReportView({ report }: { report: VerificationReport }) {
  const verdictColor =
    report.overallVerdict === 'looks-sound'
      ? 'text-green-700'
      : report.overallVerdict === 'reject'
        ? 'text-red-700'
        : 'text-amber-700';
  return (
    <div className="mt-4 rounded border border-gray-200 p-3">
      <h3 className="text-sm font-semibold text-gray-700">Verification (independent third-pass)</h3>
      <p className={`mt-1 text-sm font-medium ${verdictColor}`}>
        Verdict: {report.overallVerdict} — {report.summary}
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {report.claims.map((c, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={
                c.status === 'verified'
                  ? 'text-green-700'
                  : c.status === 'contradicted'
                    ? 'text-red-700'
                    : 'text-amber-700'
              }
            >
              [{c.status}]
            </span>
            <span className="text-gray-700">
              {c.claim} {c.note ? `— ${c.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SourcePipelineClient() {
  const [url, setUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [targetModuleId, setTargetModuleId] = useState('');
  const [gen, setGen] = useState<GenerateResult | null>(null);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-bold">Add a source</h1>
      <p className="mt-1 text-sm text-gray-600">
        Drop a URL (fetched server-side) or paste a transcript. The LLM proposes a module + MCQ
        pool grounded in the source; an independent pass verifies it; you review a diff and accept.
        Nothing is written until you click Accept.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder="https://… (optional)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          className="rounded bg-gray-800 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!url || busy !== null}
          onClick={() => run('fetch', async () => setSourceText(await fetchSourceUrl(url)))}
        >
          {busy === 'fetch' ? 'Fetching…' : 'Fetch URL'}
        </button>
      </div>

      <textarea
        className="mt-3 h-48 w-full rounded border border-gray-300 p-2 font-mono text-xs"
        placeholder="…or paste a transcript / source text here"
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
      />

      <div className="mt-3 flex items-center gap-2">
        <input
          className="w-48 rounded border border-gray-300 px-2 py-1 text-sm"
          placeholder="Target module id (blank = new)"
          value={targetModuleId}
          onChange={(e) => setTargetModuleId(e.target.value)}
        />
        <button
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          disabled={!sourceText.trim() || busy !== null}
          onClick={() =>
            run('generate', async () => {
              setReport(null);
              setApplied(null);
              setGen(await generateFromSource(sourceText, targetModuleId || undefined));
            })
          }
        >
          {busy === 'generate' ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {gen && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Proposed: {gen.candidate.moduleId}</h2>
            <button
              className="rounded bg-purple-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={busy !== null}
              onClick={() =>
                run('verify', async () =>
                  setReport(await verifyCandidate(gen.candidate, sourceText)),
                )
              }
            >
              {busy === 'verify' ? 'Verifying…' : 'Run verification'}
            </button>
          </div>

          {report && <ReportView report={report} />}

          <DiffView label="Module markdown" oldText={gen.oldMarkdown} newText={gen.candidate.markdown} />
          <DiffView label="MCQ pool" oldText={gen.oldPoolJson} newText={gen.candidate.poolJson} />

          <div className="mt-4 flex items-center gap-3">
            <button
              className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy !== null}
              onClick={() =>
                run('apply', async () => {
                  const w = await applyCandidate(gen.candidate, gen.moduleFileName);
                  setApplied(`Applied → ${w.moduleFile} + ${w.poolFile}`);
                })
              }
            >
              {busy === 'apply' ? 'Applying…' : 'Accept all & apply'}
            </button>
            {applied && <span className="text-sm font-medium text-green-700">{applied}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

```tsx
// app/(shell)/source/page.tsx
// The "Add source" review-gate page. Renders the client pipeline component.
import SourcePipelineClient from '@/components/SourcePipelineClient';

export const dynamic = 'force-dynamic';

export default function SourcePage() {
  return <SourcePipelineClient />;
}
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS (page + component compile; build succeeds; no lint errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/SourcePipelineClient.tsx "app/(shell)/source/page.tsx"
git commit -m "feat(v1c): review-gate UI — SourcePipelineClient + /source page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Wire an "Add source" affordance into the shell + full green gate

**Files:**
- Modify: `app/(shell)/layout.tsx` (or the sidebar component it renders) — add a link to `/source`.
- Test: full suite + typecheck + lint + build.

- [ ] **Step 1: Read the shell layout to find the nav insertion point**

Run: `npm run -s test -- --root . >/dev/null 2>&1; sed -n '1,60p' "app/(shell)/layout.tsx"`
Expected: shows the layout JSX; locate the sidebar/nav element. (If the sidebar is a separate component, e.g. `src/components/Sidebar.tsx` from V-NAV, edit that instead — add the link in the same list the module rows render in.)

- [ ] **Step 2: Add an "Add source" link**

Add a navigation link to `/source` in the shell's sidebar/header nav. Example (adapt the exact element/classes to the existing nav markup you found in Step 1 — place it alongside the existing top-level links such as the map/flashcards links):

```tsx
<a
  href="/source"
  className="block rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
>
  + Add source
</a>
```

- [ ] **Step 3: Run the full green gate**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: ALL PASS. New suites green: `credential`, `candidate`, `generate`, `verify`, `html-to-text`, `diff`, `apply`. Existing suites unaffected.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(v1c): wire '+ Add source' into the shell nav; V-PIPE green

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Follow-on (documented, NOT built here)

- **Tinyfish web-grounded verifier.** Implement a `TinyfishVerifier implements Verifier` (same `verify(VerificationInput) → VerificationReport`) that calls `mcp__tinyfish__search` / `mcp__tinyfish__fetch_content` to ground each claim against the live web rather than only the supplied source. Swap it into `app/api/source/verify/route.ts` behind a flag; the route, client, and UI need no changes because the interface is unchanged.
- **OAuth token auto-refresh.** Today an expired token throws an actionable error. A later pass could use `claudeAiOauth.refreshToken` to refresh; out of scope (refreshing is Claude Code's responsibility and re-writing the Keychain item is risky).
- **Per-claim accept granularity.** Today accept is per-file (module + pool, accept-all). A later pass could let the user reject specific claims/questions before apply.

---

## Self-review

**1. Spec coverage (§3 V-PIPE):**
- Inputs — URL fetch + pasted transcript + optional target module → Task 7 (fetch/html-to-text), Task 10 (fetch route), Task 12 (UI inputs + target field). ✓
- LLM generate/update (Anthropic OAuth) → Tasks 2–5 (credential, clients, factory, generate). ✓ (tinyfish-fetch for the URL is replaced by a plain server `fetch` + `htmlToText` per the architecture decision in the task brief; noted explicitly.)
- Verification third-pass → Task 6 (verify), Task 10 (verify route); tinyfish web-grounded verifier documented as follow-on. ✓
- Diff view → Task 8 (diff model) + Task 12 (DiffView). ✓
- User accepts → apply with structured atomic writers + validatePool before write → Task 9 (apply) + Task 10 (apply route, re-validate). ✓
- Guardrails: validatePool ✓ (Tasks 4, 9), parseModule round-trip ✓ (Task 4), atomic structured writes ✓ (Task 9), nothing applies without accept ✓ (apply only reachable via the Accept button → Task 12), token never reaches client ✓ (Task 3 keeps token inside OAuthLLMClient; routes return only text/candidate/report — Task 10).

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every test step has full assertions; no "similar to Task N". ✓

**3. Type consistency:** `LLMClient.generate(LLMRequest) → string`, `Verifier.verify(VerificationInput) → VerificationReport`, `Candidate { moduleId, markdown, poolJson }`, `GenerateInput`, `VerificationReport`, `DiffLine { kind, text }`, `assertParsesAsModule`/`validateCandidate`, `applyCandidate(dir, candidate, fileName)`, `moduleFileName(id, name)` — names are consistent across types (Task 1), generate (Task 5), verify (Task 6), candidate (Task 4), apply (Task 9), routes (Task 10), client (Task 11), UI (Task 12). `DEFAULT_MODEL` exported from `oauth-client.ts` and reused by `api-key-client.ts`. ✓
