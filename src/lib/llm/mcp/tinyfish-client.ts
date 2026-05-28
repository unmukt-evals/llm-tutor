// src/lib/llm/mcp/tinyfish-client.ts
// Minimal MCP client for the tinyfish server. SERVER-ONLY (impure edge).
// Protocol: plain JSON-RPC over HTTP (POST), per the live-confirmed handshake
// against https://agent.tinyfish.ai/mcp:
//   - accept: application/json, text/event-stream
//   - authorization: Bearer <accessToken>
//   - content-type: application/json
//   - body: { jsonrpc: "2.0", id, method: "...", params: {...} }
// On first use we send `initialize` then `notifications/initialized`; thereafter
// we call `tools/call` for `search` / `fetch_content`.
// The bearer token NEVER leaves this module — callers see only result text.
// `fetch` is injected (constructor) so unit tests stub it directly.

export interface TinyfishSearchResult {
  /** Best-effort title for the result. */
  title: string;
  /** Best-effort URL for the result. */
  url: string;
  /** Best-effort snippet / description. */
  snippet: string;
}

export interface TinyfishSearchOpts {
  /** Maximum results to keep from the response. Default 3. */
  maxResults?: number;
}

export interface TinyfishFetchOpts {
  /** Optional render mode hint passed through to fetch_content. */
  format?: 'markdown' | 'text' | 'html';
}

/** Minimal JSON-RPC content block shape (text-bearing). */
interface McpContentBlock {
  type?: string;
  text?: string;
}

interface McpToolCallResult {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

const PROTOCOL_VERSION = '2025-11-25';

/** Parse a Server-Sent-Events body or plain JSON body into the JSON-RPC envelope. */
function parseRpcBody<T>(body: string): JsonRpcResponse<T> {
  // The server advertises text/event-stream — strip `data: ` prefixes if present.
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as JsonRpcResponse<T>;
  }
  // SSE frames: pick the first `data:` line that parses as JSON.
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^data:\s*(.*)$/.exec(line);
    if (m && m[1].trim().length > 0) {
      try {
        return JSON.parse(m[1]) as JsonRpcResponse<T>;
      } catch {
        // keep scanning
      }
    }
  }
  throw new Error('Tinyfish MCP returned an unparseable response body.');
}

/** PURE: flatten a tool-call content array into a single text string. */
function flattenText(result: McpToolCallResult | undefined): string {
  if (!result) return '';
  const blocks = result.content ?? [];
  return blocks
    .filter((b) => (b.type === 'text' || b.type === undefined) && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/** PURE: best-effort coercion of a tool result into a list of search results. */
export function coerceSearchResults(
  result: McpToolCallResult | undefined,
  maxResults: number,
): TinyfishSearchResult[] {
  // 1) Structured content (preferred when the server returns it).
  const sc = result?.structuredContent as
    | { results?: unknown; items?: unknown }
    | undefined;
  const rawList = (sc?.results ?? sc?.items) as unknown;
  if (Array.isArray(rawList)) {
    return rawList.slice(0, maxResults).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        title: String(o.title ?? o.name ?? ''),
        url: String(o.url ?? o.link ?? ''),
        snippet: String(o.snippet ?? o.description ?? o.summary ?? o.text ?? ''),
      };
    });
  }
  // 2) Fallback: parse JSON out of the flattened text payload.
  const text = flattenText(result).trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { results?: unknown }).results)
          ? ((parsed as { results: unknown[] }).results)
          : Array.isArray((parsed as { items?: unknown }).items)
            ? ((parsed as { items: unknown[] }).items)
            : [];
      return list.slice(0, maxResults).map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          title: String(o.title ?? o.name ?? ''),
          url: String(o.url ?? o.link ?? ''),
          snippet: String(o.snippet ?? o.description ?? o.summary ?? o.text ?? ''),
        };
      });
    } catch {
      // fall through to single-snippet wrapper
    }
  }
  if (text.length > 0) {
    return [{ title: '', url: '', snippet: text }].slice(0, maxResults);
  }
  return [];
}

/**
 * Minimal MCP client over JSON-RPC HTTP. Sends `initialize` once on first use.
 * The bearer token is set in the constructor and never returned to callers.
 */
export class TinyfishMcpClient {
  private rpcId = 0;
  private initialized = false;
  private progressTokenCounter = 0;

  constructor(
    private readonly serverUrl: string,
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike = (globalThis as unknown as { fetch: FetchLike }).fetch,
  ) {}

  private nextProgressToken(prefix: string): string {
    this.progressTokenCounter += 1;
    return `${prefix}-${this.progressTokenCounter}-${Date.now()}`;
  }

  /** Send one JSON-RPC request. Throws on HTTP or RPC error. */
  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.rpcId += 1;
    const id = this.rpcId;
    const res = await this.fetchImpl(this.serverUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!res.ok) {
      // NEVER include the bearer token in the surfaced message — the body is
      // server-side and may include the original request snippet on some errors,
      // so we only carry status + statusText forward.
      throw new Error(`Tinyfish MCP HTTP ${res.status} ${res.statusText} on ${method}`);
    }
    const body = await res.text();
    const env = parseRpcBody<T>(body);
    if (env.error) {
      throw new Error(`Tinyfish MCP error on ${method}: ${env.error.message}`);
    }
    return env.result as T;
  }

  /** Send a one-shot notification (no id, no response expected). */
  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    await this.fetchImpl(this.serverUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
  }

  /** Perform the MCP handshake on first use. Idempotent. */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.rpc<unknown>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'llm-tutor', version: '0.1.0' },
    });
    await this.notify('notifications/initialized', {});
    this.initialized = true;
  }

  /** Call the tinyfish `search` tool and return up to maxResults snippets. */
  async search(query: string, opts: TinyfishSearchOpts = {}): Promise<TinyfishSearchResult[]> {
    await this.ensureInitialized();
    const max = Math.max(1, opts.maxResults ?? 3);
    const result = await this.rpc<McpToolCallResult>('tools/call', {
      name: 'search',
      arguments: { query },
      _meta: { progressToken: this.nextProgressToken('search') },
    });
    return coerceSearchResults(result, max);
  }

  /** Call the tinyfish `fetch_content` tool for one URL. Returns the text payload. */
  async fetchContent(url: string, opts: TinyfishFetchOpts = {}): Promise<string> {
    await this.ensureInitialized();
    const args: Record<string, unknown> = { url };
    if (opts.format) args.format = opts.format;
    const result = await this.rpc<McpToolCallResult>('tools/call', {
      name: 'fetch_content',
      arguments: args,
      _meta: { progressToken: this.nextProgressToken('fetch') },
    });
    return flattenText(result);
  }
}
