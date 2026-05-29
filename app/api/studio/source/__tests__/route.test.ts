/**
 * route.test.ts — Studio Source CRUD API route tests (Phase 5a Task 3).
 *
 * Tests the Next 15 App Router handlers directly:
 *   POST   /api/studio/source         → app/api/studio/source/route.ts
 *   GET    /api/studio/source/[id]    → app/api/studio/source/[id]/route.ts
 *   PUT    /api/studio/source/[id]    → app/api/studio/source/[id]/route.ts
 *   DELETE /api/studio/source/[id]    → app/api/studio/source/[id]/route.ts
 *
 * Setup: real tmpdir + CURRICULUM_DIR env var + __resetCmsIndexForTests()
 * for a fresh CMS state per test.
 *
 * Status code contract:
 *   POST   201 created | 400 bad body | 409 duplicate-URL | 500 other
 *   GET    200 hit | 404 unknown
 *   PUT    200 ok | 400 bad body | 404 unknown | 500 other
 *   DELETE 200 {ok:true, deleted:true|false} always
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';
import { writeSourcesJson } from '@/lib/cms/sources/json-store';
import { computeSourceHash } from '@/lib/cms/sources/source-hash';
import { getCmsIndex, __resetCmsIndexForTests } from '@/lib/cms/index';

// ── Mock reindexAffected before importing routes ──────────────────────────────
vi.mock('@/lib/cms/reindex', () => ({
  reindexAffected: vi.fn().mockResolvedValue({ ok: true }),
}));

// Import the route handlers after mocks are registered
import { POST } from '../route';
import { GET, PUT, DELETE } from '../[id]/route';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> & { id: string }): Source {
  return {
    kind: 'url',
    title: 'Fixture Source',
    url: `https://example.com/${overrides.id}`,
    content_hash: computeSourceHash({
      kind: 'url',
      title: 'Fixture Source',
      url: `https://example.com/${overrides.id}`,
    }),
    updated_at: 1000000,
    ...overrides,
  };
}

async function seedDoc(dir: string, sources: Source[]): Promise<void> {
  const doc: SourcesDoc = { version: 1, sources };
  await writeSourcesJson(dir, doc);
}

/**
 * Build a POST/PUT Request with a JSON body.
 */
function jsonRequest(body: unknown): Request {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Build params object for [id] route (Next 15 App Router passes Promise<{id}>).
 */
function idParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('POST /api/studio/source', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-route-post-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  // Test 1: POST with valid body → 201
  it('returns 201 with {ok, id, content_hash} and persists the source', async () => {
    await seedDoc(dir, []);

    const req = jsonRequest({ kind: 'doc', title: 'foo' });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^src_[0-9a-f]{8}$/);
    expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // Verify the source is retrievable
    __resetCmsIndexForTests();
    const cms = await getCmsIndex(dir);
    const source = cms.getSourceById(body.id);
    expect(source).toBeDefined();
    expect(source!.title).toBe('foo');
    expect(source!.kind).toBe('doc');
  });

  // Test 2: POST with missing `kind` → 400
  it('returns 400 with "kind and title are required" when kind is missing', async () => {
    const req = jsonRequest({ title: 'foo' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('kind and title are required');
  });

  // Test 3: POST with missing `title` → 400
  it('returns 400 with "kind and title are required" when title is missing', async () => {
    const req = jsonRequest({ kind: 'doc' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('kind and title are required');
  });

  // Test 4: POST with duplicate URL → 409
  it('returns 409 when kind=url and url already exists', async () => {
    const existing = makeSource({ id: 'S1', url: 'https://example.com/collision' });
    await seedDoc(dir, [existing]);

    const req = jsonRequest({
      kind: 'url',
      title: 'Duplicate',
      url: 'https://example.com/collision',
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });

  // Test 5: POST with malformed JSON body → 400
  it('returns 400 with "Invalid JSON body" when body is not valid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json :::',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});

describe('GET /api/studio/source/[id]', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-route-get-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  // Test 6: GET known id → 200 with source
  it('returns 200 with {ok, source} for a known id', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Known Source' });
    await seedDoc(dir, [s1]);

    const req = new Request('http://localhost/api/studio/source/S1');
    const res = await GET(req, idParams('S1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.source).toBeDefined();
    expect(body.source.id).toBe('S1');
    expect(body.source.title).toBe('Known Source');
  });

  // Test 7: GET unknown id → 404
  it('returns 404 with {error: "not found"} for an unknown id', async () => {
    await seedDoc(dir, []);

    const req = new Request('http://localhost/api/studio/source/does-not-exist');
    const res = await GET(req, idParams('does-not-exist'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not found');
  });
});

describe('PUT /api/studio/source/[id]', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-route-put-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  // Test 8: PUT known id → 200, subsequent GET shows new title
  it('returns 200 with {ok, id, content_hash} and updates the source', async () => {
    const s1 = makeSource({ id: 'S1', title: 'Original Title' });
    await seedDoc(dir, [s1]);

    const req = jsonRequest({ title: 'new' });
    const res = await PUT(req, idParams('S1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe('S1');
    expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // Subsequent GET shows the new title
    __resetCmsIndexForTests();
    const getReq = new Request('http://localhost/api/studio/source/S1');
    const getRes = await GET(getReq, idParams('S1'));
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.source.title).toBe('new');
  });

  // Test 9: PUT unknown id → 404
  it('returns 404 for an unknown id', async () => {
    await seedDoc(dir, []);

    const req = jsonRequest({ title: 'something' });
    const res = await PUT(req, idParams('does-not-exist'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  // Test for invalid JSON body
  it('returns 400 with "Invalid JSON body" when body is not valid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ bad json',
    });
    const res = await PUT(req, idParams('S1'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});

describe('DELETE /api/studio/source/[id]', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-route-delete-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  // Test 10: DELETE known id → 200 {deleted:true}, subsequent GET → 404
  it('returns 200 {ok, deleted:true} and removes the source', async () => {
    const s1 = makeSource({ id: 'S1', title: 'To Delete' });
    await seedDoc(dir, [s1]);

    const req = new Request('http://localhost/api/studio/source/S1', { method: 'DELETE' });
    const res = await DELETE(req, idParams('S1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(true);

    // Subsequent GET returns 404
    __resetCmsIndexForTests();
    const getReq = new Request('http://localhost/api/studio/source/S1');
    const getRes = await GET(getReq, idParams('S1'));
    expect(getRes.status).toBe(404);
  });

  // Test 11: DELETE unknown id → 200 {deleted:false} (idempotent)
  it('returns 200 {ok, deleted:false} for an unknown id (idempotent)', async () => {
    await seedDoc(dir, []);

    const req = new Request('http://localhost/api/studio/source/ghost', { method: 'DELETE' });
    const res = await DELETE(req, idParams('ghost'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(false);
  });
});
