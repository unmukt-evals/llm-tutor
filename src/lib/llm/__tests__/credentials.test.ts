// src/lib/llm/__tests__/credentials.test.ts
import { describe, it, expect } from 'vitest';
import { parseCredentialJson, assertNotExpired } from '@/lib/llm/credentials';

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

  it('throws when claudeAiOauth itself is missing', () => {
    expect(() => parseCredentialJson(JSON.stringify({ mcpOAuth: {} }))).toThrow(/accessToken/);
  });

  it('defaults expiresAt to 0 when not a number', () => {
    const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'tok-abc' } });
    expect(parseCredentialJson(raw).expiresAt).toBe(0);
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

  it('throws when now equals expiresAt (boundary)', () => {
    expect(() => assertNotExpired(FUTURE, new Date(FUTURE))).toThrow(/expired/i);
  });

  it('passes (does not throw) when expiresAt is 0/unknown', () => {
    expect(() => assertNotExpired(0, new Date(FUTURE))).not.toThrow();
  });
});
