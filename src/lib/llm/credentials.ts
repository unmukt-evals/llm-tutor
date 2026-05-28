// src/lib/llm/credentials.ts
// PURE helpers for the Claude Code OAuth credential. NO I/O here — the raw JSON
// is read by the impure client (client.ts) and passed in. expiresAt is an
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
  if (expiresAt !== 0 && now.getTime() >= expiresAt) {
    throw new Error(
      'Claude OAuth token expired — run any Claude Code command to refresh it, then retry.',
    );
  }
}
