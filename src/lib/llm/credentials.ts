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

// ── Tinyfish MCP credential (sibling to claudeAiOauth) ───────────────────────
// Lives at mcpOAuth["tinyfish|<id>"] inside the same Keychain JSON. Fields:
//   { serverName, serverUrl, accessToken, refreshToken, expiresAt, scope, ... }
// We only need serverUrl + accessToken + expiresAt for read-only tool calls.

export interface TinyfishCredential {
  serverUrl: string;
  accessToken: string;
  expiresAt: number; // epoch ms
}

/**
 * Parse the tinyfish entry from the same Claude Code Keychain JSON blob. Looks
 * up the first `mcpOAuth[key]` whose key starts with "tinyfish|". Throws a
 * clear error if missing, malformed, or lacking an access token / server URL.
 */
export function parseTinyfishCreds(raw: string): TinyfishCredential {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('Could not parse Claude Code Keychain JSON when looking for tinyfish creds.');
  }
  const mcp = (obj as { mcpOAuth?: unknown })?.mcpOAuth as
    | Record<string, unknown>
    | undefined;
  if (!mcp || typeof mcp !== 'object') {
    throw new Error('Keychain JSON has no mcpOAuth section — sign in to the tinyfish MCP first.');
  }
  const key = Object.keys(mcp).find((k) => k.startsWith('tinyfish|'));
  if (!key) {
    throw new Error('No tinyfish entry under mcpOAuth — sign in to the tinyfish MCP first.');
  }
  const entry = mcp[key] as
    | { serverUrl?: unknown; accessToken?: unknown; expiresAt?: unknown }
    | undefined;
  if (!entry || typeof entry !== 'object') {
    throw new Error('Tinyfish MCP entry is malformed.');
  }
  if (typeof entry.serverUrl !== 'string' || entry.serverUrl.length === 0) {
    throw new Error('Tinyfish MCP entry is missing serverUrl.');
  }
  if (typeof entry.accessToken !== 'string' || entry.accessToken.length === 0) {
    throw new Error('Tinyfish MCP entry is missing accessToken.');
  }
  const expiresAt = typeof entry.expiresAt === 'number' ? entry.expiresAt : 0;
  return {
    serverUrl: entry.serverUrl,
    accessToken: entry.accessToken,
    expiresAt,
  };
}
