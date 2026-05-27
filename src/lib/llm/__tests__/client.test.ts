// src/lib/llm/__tests__/client.test.ts
// Tests for the impure clients + factory. fetch is mocked; the keychain read is
// injected (no live network, no real `security` call).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  OAuthLLMClient,
  ApiKeyLLMClient,
  getLLMClient,
  DEFAULT_MODEL,
} from '@/lib/llm/client';
import type { LLMRequest } from '@/lib/llm/types';

const FUTURE = 32503680000000;

function okResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => JSON.stringify({ content: [{ type: 'text', text }] }),
    headers: new Headers(),
  } as unknown as Response;
}

function errResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    statusText: 'Bad',
    json: async () => ({ error: { message: body } }),
    text: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const REQ: LLMRequest = { system: 'caller-system', messages: [{ role: 'user', content: 'hi' }] };

function rawCred(expiresAt: number): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: 'tok-abc', expiresAt } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe('OAuthLLMClient', () => {
  it('bakes in the validated recipe: model, OAuth headers, prepended identity', async () => {
    fetchMock.mockResolvedValue(okResponse('the answer'));
    const client = new OAuthLLMClient(
      DEFAULT_MODEL,
      async () => rawCred(FUTURE),
      () => new Date(0),
    );
    const out = await client.generate(REQ);
    expect(out).toBe('the answer');

    expect(DEFAULT_MODEL).toBe('claude-sonnet-4-6');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-abc');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(headers['content-type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.system.startsWith("You are Claude Code, Anthropic's official CLI for Claude.")).toBe(
      true,
    );
    expect(body.system).toContain('caller-system');
    expect(body.max_tokens).toBe(8192);
    expect(body.temperature).toBe(0);
  });

  it('prepends the identity even when no caller system is supplied', async () => {
    fetchMock.mockResolvedValue(okResponse('x'));
    const client = new OAuthLLMClient(DEFAULT_MODEL, async () => rawCred(FUTURE), () => new Date(0));
    await client.generate({ messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.system).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
  });

  it('throws on an expired token before any fetch', async () => {
    const client = new OAuthLLMClient(
      DEFAULT_MODEL,
      async () => rawCred(1000),
      () => new Date(FUTURE),
    );
    await expect(client.generate(REQ)).rejects.toThrow(/expired/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a non-2xx error with status detail', async () => {
    fetchMock.mockResolvedValue(errResponse(404, 'model not found'));
    const client = new OAuthLLMClient(DEFAULT_MODEL, async () => rawCred(FUTURE), () => new Date(0));
    await expect(client.generate(REQ)).rejects.toThrow(/404.*model not found/);
  });

  it('throws when keychain read fails', async () => {
    const client = new OAuthLLMClient(
      DEFAULT_MODEL,
      async () => {
        throw new Error('no creds');
      },
      () => new Date(0),
    );
    await expect(client.generate(REQ)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ApiKeyLLMClient', () => {
  it('uses the x-api-key header path and does NOT prepend the identity', async () => {
    fetchMock.mockResolvedValue(okResponse('answer'));
    const client = new ApiKeyLLMClient('sk-test');
    const out = await client.generate(REQ);
    expect(out).toBe('answer');
    const init = fetchMock.mock.calls[0][1];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers.authorization).toBeUndefined();
    expect(headers['anthropic-beta']).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('caller-system'); // passed through, not prefixed
    expect(body.model).toBe('claude-sonnet-4-6');
  });
});

describe('getLLMClient', () => {
  it('returns the API-key client when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    expect(getLLMClient()).toBeInstanceOf(ApiKeyLLMClient);
  });

  it('returns the OAuth client when no API key is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getLLMClient()).toBeInstanceOf(OAuthLLMClient);
  });
});
