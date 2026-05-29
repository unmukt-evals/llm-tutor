/**
 * Tests for middleware.ts (LLMTUTOR_STUDIO_TOKEN gate).
 *
 * NOTE: vitest.config.ts includes 'src/**\/*.test.ts' but NOT root-level
 * '*.test.ts', so this test lives here in src/__tests__/ rather than at
 * the repo root alongside middleware.ts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware — LLMTUTOR_STUDIO_TOKEN gate', () => {
  it('passes through when env var is not set (open by default)', async () => {
    vi.stubEnv('LLMTUTOR_STUDIO_TOKEN', '');
    const req = new NextRequest('http://localhost/studio');
    const res = await Promise.resolve(middleware(req));
    // NextResponse.next() returns a 200 response
    expect(res.status).toBe(200);
  });

  it('passes through with matching Authorization: Bearer <token> header', async () => {
    vi.stubEnv('LLMTUTOR_STUDIO_TOKEN', 'abc123');
    const req = new NextRequest('http://localhost/studio', {
      headers: { authorization: 'Bearer abc123' },
    });
    const res = await Promise.resolve(middleware(req));
    expect(res.status).toBe(200);
  });

  it('passes through with matching ?token=<token> query param', async () => {
    vi.stubEnv('LLMTUTOR_STUDIO_TOKEN', 'abc123');
    const req = new NextRequest('http://localhost/studio?token=abc123');
    const res = await Promise.resolve(middleware(req));
    expect(res.status).toBe(200);
  });

  it('returns 401 with {error: "unauthorized"} when token is wrong', async () => {
    vi.stubEnv('LLMTUTOR_STUDIO_TOKEN', 'abc123');
    const req = new NextRequest('http://localhost/studio', {
      headers: { authorization: 'Bearer wrong-token' },
    });
    const res = await Promise.resolve(middleware(req));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 when token is set but no credentials provided', async () => {
    vi.stubEnv('LLMTUTOR_STUDIO_TOKEN', 'abc123');
    const req = new NextRequest('http://localhost/api/studio/source');
    const res = await Promise.resolve(middleware(req));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'unauthorized' });
  });

  it('prefers header token over query param when both are present and header matches', async () => {
    vi.stubEnv('LLMTUTOR_STUDIO_TOKEN', 'abc123');
    const req = new NextRequest('http://localhost/studio?token=wrong', {
      headers: { authorization: 'Bearer abc123' },
    });
    const res = await Promise.resolve(middleware(req));
    expect(res.status).toBe(200);
  });
});
