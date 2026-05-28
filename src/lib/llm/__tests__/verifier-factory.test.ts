// src/lib/llm/__tests__/verifier-factory.test.ts
// Tests for getVerifier(). The keychain reader is INJECTED so no real `security`
// subprocess is spawned; the time source is injected for expiry control.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getVerifier } from '@/lib/llm/verifier-factory';
import { TinyfishVerifier } from '@/lib/llm/tinyfish-verifier';
import { LLMVerifier } from '@/lib/llm/verify';

const FUTURE = 32503680000000;
const PAST = 1000;

function blob(opts: {
  tinyfish?: { serverUrl?: string; accessToken?: string; expiresAt?: number } | null;
} = {}): string {
  const body: Record<string, unknown> = {
    claudeAiOauth: { accessToken: 'claude-tok', expiresAt: FUTURE },
  };
  if (opts.tinyfish === null) {
    body.mcpOAuth = {};
  } else {
    const tf = opts.tinyfish ?? {};
    body.mcpOAuth = {
      'tinyfish|abc': {
        serverUrl: tf.serverUrl ?? 'https://agent.tinyfish.ai/mcp',
        accessToken: tf.accessToken ?? 'tf-tok',
        expiresAt: tf.expiresAt ?? FUTURE,
      },
    };
  }
  return JSON.stringify(body);
}

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('getVerifier', () => {
  it('returns a TinyfishVerifier when tinyfish creds are present and unexpired', async () => {
    const warn = vi.fn();
    const v = await getVerifier({
      readKeychain: async () => blob({}),
      now: () => new Date(0),
      logger: { warn },
    });
    expect(v).toBeInstanceOf(TinyfishVerifier);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to LLMVerifier when tinyfish entry is missing', async () => {
    const warn = vi.fn();
    const v = await getVerifier({
      readKeychain: async () => blob({ tinyfish: null }),
      now: () => new Date(0),
      logger: { warn },
    });
    expect(v).toBeInstanceOf(LLMVerifier);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toMatch(/falling back/i);
  });

  it('falls back to LLMVerifier when the tinyfish token is expired', async () => {
    const warn = vi.fn();
    const v = await getVerifier({
      readKeychain: async () => blob({ tinyfish: { expiresAt: PAST } }),
      now: () => new Date(FUTURE),
      logger: { warn },
    });
    expect(v).toBeInstanceOf(LLMVerifier);
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to LLMVerifier when the keychain read itself fails', async () => {
    const warn = vi.fn();
    const v = await getVerifier({
      readKeychain: async () => {
        throw new Error('no keychain');
      },
      now: () => new Date(0),
      logger: { warn },
    });
    expect(v).toBeInstanceOf(LLMVerifier);
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to LLMVerifier when the keychain blob is malformed', async () => {
    const warn = vi.fn();
    const v = await getVerifier({
      readKeychain: async () => 'not json',
      now: () => new Date(0),
      logger: { warn },
    });
    expect(v).toBeInstanceOf(LLMVerifier);
    expect(warn).toHaveBeenCalled();
  });
});
