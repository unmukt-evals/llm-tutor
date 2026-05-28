// src/lib/llm/__tests__/credentials.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseCredentialJson,
  assertNotExpired,
  parseTinyfishCreds,
} from '@/lib/llm/credentials';

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

function rawTinyfish(opts: {
  serverUrl?: string;
  accessToken?: string;
  expiresAt?: number;
  withClaude?: boolean;
  withSection?: boolean;
  withEntry?: boolean;
  key?: string;
}): string {
  const {
    serverUrl = 'https://agent.tinyfish.ai/mcp',
    accessToken = 'tf-tok',
    expiresAt = FUTURE,
    withClaude = true,
    withSection = true,
    withEntry = true,
    key = 'tinyfish|ce2897ae352dc5c5',
  } = opts;
  const body: Record<string, unknown> = {};
  if (withClaude) {
    body.claudeAiOauth = { accessToken: 'claude-tok', expiresAt: FUTURE };
  }
  if (withSection) {
    body.mcpOAuth = withEntry
      ? {
          [key]: {
            serverName: 'tinyfish',
            serverUrl,
            accessToken,
            refreshToken: 'r',
            expiresAt,
            scope: 'read',
          },
        }
      : {};
  }
  return JSON.stringify(body);
}

describe('parseTinyfishCreds', () => {
  it('extracts serverUrl, accessToken, expiresAt from the tinyfish entry', () => {
    const c = parseTinyfishCreds(rawTinyfish({}));
    expect(c.serverUrl).toBe('https://agent.tinyfish.ai/mcp');
    expect(c.accessToken).toBe('tf-tok');
    expect(c.expiresAt).toBe(FUTURE);
  });

  it('throws when mcpOAuth section is missing', () => {
    expect(() => parseTinyfishCreds(rawTinyfish({ withSection: false }))).toThrow(/mcpOAuth/);
  });

  it('throws when there is no tinyfish entry', () => {
    expect(() => parseTinyfishCreds(rawTinyfish({ withEntry: false }))).toThrow(/tinyfish/);
  });

  it('throws when JSON is malformed', () => {
    expect(() => parseTinyfishCreds('not json')).toThrow(/parse/i);
  });

  it('throws when accessToken is missing', () => {
    expect(() => parseTinyfishCreds(rawTinyfish({ accessToken: '' }))).toThrow(/accessToken/);
  });

  it('throws when serverUrl is missing', () => {
    expect(() => parseTinyfishCreds(rawTinyfish({ serverUrl: '' }))).toThrow(/serverUrl/);
  });

  it('defaults expiresAt to 0 when not a number', () => {
    const raw = JSON.stringify({
      mcpOAuth: {
        'tinyfish|x': { serverUrl: 'https://x', accessToken: 't' },
      },
    });
    expect(parseTinyfishCreds(raw).expiresAt).toBe(0);
  });

  it('is compatible with assertNotExpired for the expired case', () => {
    const creds = parseTinyfishCreds(rawTinyfish({ expiresAt: PAST }));
    expect(() => assertNotExpired(creds.expiresAt, new Date(FUTURE))).toThrow(/expired/i);
  });
});
