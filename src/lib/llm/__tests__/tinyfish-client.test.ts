// src/lib/llm/__tests__/tinyfish-client.test.ts
// Tests for the minimal tinyfish MCP HTTP/JSON-RPC client. fetch is injected
// (no network); the bearer token never appears in any thrown error message.

import { describe, it, expect, vi } from 'vitest';
import { TinyfishMcpClient, coerceSearchResults } from '@/lib/llm/mcp/tinyfish-client';

function okBody(payload: unknown): {
  ok: true;
  status: 200;
  statusText: 'OK';
  text: () => Promise<string>;
} {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  };
}

function errBody(status: number, statusText: string) {
  return {
    ok: false as const,
    status,
    statusText,
    text: async () => `err-body`,
  };
}

function rpcResult(id: number, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

describe('coerceSearchResults', () => {
  it('reads structuredContent.results', () => {
    const out = coerceSearchResults(
      {
        structuredContent: {
          results: [
            { title: 'A', url: 'https://a', snippet: 'aa' },
            { title: 'B', url: 'https://b', snippet: 'bb' },
          ],
        },
      },
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'A', url: 'https://a', snippet: 'aa' });
  });

  it('parses JSON text payload', () => {
    const out = coerceSearchResults(
      { content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'X', url: 'u' }] }) }] },
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('X');
  });

  it('wraps a bare-text result into a single snippet', () => {
    const out = coerceSearchResults(
      { content: [{ type: 'text', text: 'just some snippet' }] },
      5,
    );
    expect(out).toEqual([{ title: '', url: '', snippet: 'just some snippet' }]);
  });

  it('honors maxResults', () => {
    const out = coerceSearchResults(
      {
        structuredContent: {
          results: [
            { title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' },
          ],
        },
      },
      2,
    );
    expect(out).toHaveLength(2);
  });

  it('returns empty when nothing is parseable', () => {
    expect(coerceSearchResults({}, 5)).toEqual([]);
    expect(coerceSearchResults(undefined, 5)).toEqual([]);
  });
});

describe('TinyfishMcpClient.search', () => {
  it('initializes then calls tools/call name="search" with bearer auth and progressToken', async () => {
    const fetchMock = vi.fn();
    // initialize → handshake response
    fetchMock.mockResolvedValueOnce(okBody(rpcResult(1, { protocolVersion: '2025-11-25' })));
    // notifications/initialized → notification (no body needed but must resolve)
    fetchMock.mockResolvedValueOnce(okBody({}));
    // tools/call search → result with two hits
    fetchMock.mockResolvedValueOnce(
      okBody(
        rpcResult(2, {
          structuredContent: {
            results: [
              { title: 'Wikipedia', url: 'https://en.wikipedia.org/x', snippet: 's1' },
              { title: 'Other', url: 'https://o', snippet: 's2' },
              { title: 'Third', url: 'https://t', snippet: 's3' },
            ],
          },
        }),
      ),
    );

    const client = new TinyfishMcpClient(
      'https://agent.tinyfish.ai/mcp',
      'tok-secret',
      fetchMock as unknown as ConstructorParameters<typeof TinyfishMcpClient>[2],
    );
    const out = await client.search('what is X', { maxResults: 3 });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ title: 'Wikipedia', url: 'https://en.wikipedia.org/x' });

    // 3 fetches total: initialize, notifications/initialized, tools/call
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // initialize request
    const initCall = fetchMock.mock.calls[0];
    expect(initCall[0]).toBe('https://agent.tinyfish.ai/mcp');
    const initInit = initCall[1] as { headers: Record<string, string>; body: string };
    expect(initInit.headers.authorization).toBe('Bearer tok-secret');
    expect(initInit.headers.accept).toBe('application/json, text/event-stream');
    expect(initInit.headers['content-type']).toBe('application/json');
    const initBody = JSON.parse(initInit.body);
    expect(initBody.method).toBe('initialize');
    expect(initBody.params.protocolVersion).toBe('2025-11-25');

    // tools/call request
    const callInit = fetchMock.mock.calls[2][1] as { body: string };
    const callBody = JSON.parse(callInit.body);
    expect(callBody.method).toBe('tools/call');
    expect(callBody.params.name).toBe('search');
    expect(callBody.params.arguments).toEqual({ query: 'what is X' });
    expect(callBody.params._meta.progressToken).toMatch(/^search-/);
  });

  it('does NOT re-initialize on a second call', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okBody(rpcResult(1, {}))); // initialize
    fetchMock.mockResolvedValueOnce(okBody({})); // notifications/initialized
    fetchMock.mockResolvedValueOnce(
      okBody(rpcResult(2, { content: [{ type: 'text', text: 'ok' }] })),
    );
    fetchMock.mockResolvedValueOnce(
      okBody(rpcResult(3, { content: [{ type: 'text', text: 'ok2' }] })),
    );

    const client = new TinyfishMcpClient(
      'https://x',
      'tok',
      fetchMock as unknown as ConstructorParameters<typeof TinyfishMcpClient>[2],
    );
    await client.search('q1');
    await client.search('q2');
    expect(fetchMock).toHaveBeenCalledTimes(4); // init + notify + 2 tools/call
  });
});

describe('TinyfishMcpClient.fetchContent', () => {
  it('calls tools/call name="fetch_content" and returns text payload', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okBody(rpcResult(1, {}))); // initialize
    fetchMock.mockResolvedValueOnce(okBody({})); // notifications/initialized
    fetchMock.mockResolvedValueOnce(
      okBody(
        rpcResult(2, {
          content: [
            { type: 'text', text: 'page body line 1' },
            { type: 'text', text: 'page body line 2' },
          ],
        }),
      ),
    );

    const client = new TinyfishMcpClient(
      'https://x',
      'tok',
      fetchMock as unknown as ConstructorParameters<typeof TinyfishMcpClient>[2],
    );
    const out = await client.fetchContent('https://example.com', { format: 'markdown' });
    expect(out).toBe('page body line 1\npage body line 2');

    const callBody = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
    expect(callBody.params.name).toBe('fetch_content');
    expect(callBody.params.arguments).toEqual({ url: 'https://example.com', format: 'markdown' });
  });
});

describe('TinyfishMcpClient error handling', () => {
  it('throws on non-2xx — and does NOT leak the bearer token', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(errBody(401, 'Unauthorized'));

    const client = new TinyfishMcpClient(
      'https://x',
      'super-secret-token-do-not-leak',
      fetchMock as unknown as ConstructorParameters<typeof TinyfishMcpClient>[2],
    );
    await expect(client.search('q')).rejects.toThrow(/401.*Unauthorized/);
    try {
      await client.search('q');
    } catch (err) {
      const msg = String(err);
      expect(msg).not.toContain('super-secret-token-do-not-leak');
      expect(msg).not.toContain('Bearer');
    }
  });

  it('throws on a JSON-RPC error envelope', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(okBody(rpcResult(1, {}))); // initialize
    fetchMock.mockResolvedValueOnce(okBody({})); // notifications/initialized
    fetchMock.mockResolvedValueOnce(
      okBody({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'tool boom' } }),
    );

    const client = new TinyfishMcpClient(
      'https://x',
      'tok',
      fetchMock as unknown as ConstructorParameters<typeof TinyfishMcpClient>[2],
    );
    await expect(client.search('q')).rejects.toThrow(/tool boom/);
  });

  it('parses an SSE-framed response body', async () => {
    const sseBody = [
      'event: message',
      `data: ${JSON.stringify(rpcResult(1, { ok: true }))}`,
      '',
    ].join('\n');
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => sseBody,
    });
    fetchMock.mockResolvedValueOnce(okBody({})); // notifications/initialized
    fetchMock.mockResolvedValueOnce(
      okBody(rpcResult(2, { content: [{ type: 'text', text: 'snippet' }] })),
    );

    const client = new TinyfishMcpClient(
      'https://x',
      'tok',
      fetchMock as unknown as ConstructorParameters<typeof TinyfishMcpClient>[2],
    );
    const out = await client.search('q');
    expect(out[0].snippet).toBe('snippet');
  });
});
