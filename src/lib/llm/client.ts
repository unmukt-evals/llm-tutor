// src/lib/llm/client.ts
// IMPURE edges + factory for the V-PIPE LLM layer. SERVER-ONLY. The access
// token NEVER leaves this module (it is read from the macOS Keychain inside
// OAuthLLMClient and only ever placed on an outbound Authorization header).
//
// Validated OAuth recipe (smoke-tested live):
//   - Keychain: security find-generic-password -s "Claude Code-credentials" -w → JSON
//     (claudeAiOauth.accessToken + claudeAiOauth.expiresAt epoch-ms).
//   - POST https://api.anthropic.com/v1/messages with headers:
//       authorization: Bearer <accessToken>
//       anthropic-version: 2023-06-01
//       anthropic-beta: oauth-2025-04-20
//       content-type: application/json
//   - model: claude-sonnet-4-6 (older ids 404 on this OAuth path).
//   - System prompt MUST start with the Claude Code identity line below
//     (the user:inference OAuth identity) — we PREPEND it to any caller system.
//   - Response text = content[0].text; on non-2xx surface error.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LLMClient, LLMRequest } from '@/lib/llm/types';
import { parseCredentialJson, assertNotExpired } from '@/lib/llm/credentials';

const execFileAsync = promisify(execFile);

// CONFIRMED working on the OAuth (user:inference) path. Update when migrating models.
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// REQUIRED first line of the system prompt on the OAuth path. Confirmed working.
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** PURE: prepend the Claude Code identity to any caller-supplied system text. */
function withIdentity(system?: string): string {
  return system && system.length > 0 ? `${CLAUDE_CODE_IDENTITY}\n\n${system}` : CLAUDE_CODE_IDENTITY;
}

interface AnthropicTextBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  error?: { message?: string };
}

/** PURE: extract joined text from an Anthropic Messages response, or throw. */
function extractText(json: AnthropicResponse): string {
  if (json.error?.message) throw new Error(`Anthropic error: ${json.error.message}`);
  const text = (json.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  if (!text) throw new Error('Anthropic returned an empty response.');
  return text;
}

// ── OAuth strategy (primary) ─────────────────────────────────────────────────

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

export class OAuthLLMClient implements LLMClient {
  constructor(
    private readonly model: string = DEFAULT_MODEL,
    /** Injected for testability: how the raw keychain JSON is read. */
    private readonly readCredential: () => Promise<string> = readKeychainCredential,
    /** Injected for testability: the current time used for the expiry check. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(req: LLMRequest): Promise<string> {
    const raw = await this.readCredential();
    const cred = parseCredentialJson(raw);
    assertNotExpired(cred.expiresAt, this.now());

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cred.accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 8192,
        temperature: req.temperature ?? 0,
        system: withIdentity(req.system),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }
    return extractText((await res.json()) as AnthropicResponse);
  }
}

// ── API-key strategy (fallback) ──────────────────────────────────────────────

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
    return extractText((await res.json()) as AnthropicResponse);
  }
}

// ── Strategy factory ─────────────────────────────────────────────────────────

/**
 * Choose the LLM strategy: API key if ANTHROPIC_API_KEY is set (fallback),
 * else OAuth via the Claude Code Keychain credential (primary). The OAuth
 * client lazily validates the Keychain at call time.
 */
export function getLLMClient(): LLMClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey.length > 0) return new ApiKeyLLMClient(apiKey);
  return new OAuthLLMClient();
}
