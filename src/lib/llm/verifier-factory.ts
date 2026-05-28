// src/lib/llm/verifier-factory.ts
// SERVER-ONLY factory: returns a TinyfishVerifier when tinyfish creds are
// present and not expired; otherwise falls back to the LLM-only LLMVerifier
// with a clear console.warn. NEVER imported by client components — the
// Keychain read uses `security` via child_process, so importing this from a
// 'use client' component would fail the build.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Verifier } from '@/lib/llm/types';
import { LLMVerifier } from '@/lib/llm/verify';
import { getLLMClient } from '@/lib/llm/client';
import { parseTinyfishCreds, assertNotExpired } from '@/lib/llm/credentials';
import { TinyfishMcpClient } from '@/lib/llm/mcp/tinyfish-client';
import { TinyfishVerifier } from '@/lib/llm/tinyfish-verifier';

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

async function readKeychainBlob(): Promise<string> {
  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-w',
  ]);
  return stdout.trim();
}

export interface GetVerifierOptions {
  /** Injected for testing — returns the raw Keychain JSON. */
  readKeychain?: () => Promise<string>;
  /** Injected for testing — current time used for expiry checks. */
  now?: () => Date;
  /** Injected for testing — logger for the fallback warning. */
  logger?: { warn: (...args: unknown[]) => void };
}

/**
 * Try TinyfishVerifier (web-grounded). On any failure (no creds, expired,
 * malformed, keychain inaccessible) fall back to the plain LLMVerifier so the
 * user's accept flow keeps working. The bearer token never leaves the
 * TinyfishMcpClient instance.
 */
export async function getVerifier(opts: GetVerifierOptions = {}): Promise<Verifier> {
  const readKeychain = opts.readKeychain ?? readKeychainBlob;
  const now = opts.now ?? (() => new Date());
  const logger = opts.logger ?? {
    // eslint-disable-next-line no-console
    warn: (...args: unknown[]) => console.warn(...args),
  };
  const llm = getLLMClient();

  try {
    const blob = await readKeychain();
    const creds = parseTinyfishCreds(blob);
    assertNotExpired(creds.expiresAt, now());
    const mcp = new TinyfishMcpClient(creds.serverUrl, creds.accessToken);
    return new TinyfishVerifier(llm, mcp, { logger });
  } catch (err) {
    logger.warn(
      `[verifier-factory] tinyfish unavailable, falling back to LLM-only verification: ${String(err)}`,
    );
    return new LLMVerifier(llm);
  }
}
