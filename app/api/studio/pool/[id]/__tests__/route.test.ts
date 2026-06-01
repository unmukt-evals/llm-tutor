/**
 * route.test.ts — Studio Pool GET/PUT API route tests (Phase 5b).
 *
 *   GET /api/studio/pool/[id]  → returns {poolJson, pool}; 404 on miss
 *   PUT /api/studio/pool/[id]  → validates + atomic-writes; 400 on bad JSON or
 *                                moduleId mismatch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetCmsIndexForTests } from '@/lib/cms';
import { GET, PUT } from '../route';

const validPool = (moduleId = 'M99') => ({
  moduleId,
  questions: [
    {
      id: `${moduleId}-q01`,
      moduleId,
      difficulty: 'easy',
      dimension: 'topic',
      stem: 's',
      options: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      distractorMisconception: { '1': 'm', '2': 'm', '3': 'm' },
      explanation: 'e',
    },
  ],
});

function jsonRequest(method: 'GET' | 'PUT', body?: unknown): Request {
  return new Request('http://localhost/api/studio/pool/M99', {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function idParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/studio/pool/[id]', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-pool-get-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 200 {poolJson, pool} for an existing pool', async () => {
    const pool = validPool('M99');
    await writeFile(join(dir, 'mcq', 'M99.json'), JSON.stringify(pool, null, 2) + '\n', 'utf8');
    const res = await GET(jsonRequest('GET'), idParams('M99'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.poolJson).toContain('"moduleId": "M99"');
    expect(body.pool.moduleId).toBe('M99');
    expect(body.pool.questions.length).toBe(1);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await GET(jsonRequest('GET'), idParams('ghost'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not found');
  });
});

describe('PUT /api/studio/pool/[id]', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-pool-put-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('200 + writes file when pool is valid', async () => {
    const body = { poolJson: JSON.stringify(validPool('M99')) };
    const res = await PUT(jsonRequest('PUT', body), idParams('M99'));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.id).toBe('M99');
    const onDisk = JSON.parse(await readFile(join(dir, 'mcq', 'M99.json'), 'utf8'));
    expect(onDisk.moduleId).toBe('M99');
  });

  it('200 + reindexes so a subsequent GET reflects the write', async () => {
    // Seed an initial pool, then mutate via PUT and verify GET returns the new
    // version (which only happens if reindexEntity fired).
    await writeFile(
      join(dir, 'mcq', 'M99.json'),
      JSON.stringify(validPool('M99'), null, 2) + '\n',
      'utf8',
    );
    // Warm the index.
    await GET(jsonRequest('GET'), idParams('M99'));

    const updated = validPool('M99');
    updated.questions[0].stem = 'updated stem';
    const putRes = await PUT(jsonRequest('PUT', { poolJson: JSON.stringify(updated) }), idParams('M99'));
    expect(putRes.status).toBe(200);

    const getRes = await GET(jsonRequest('GET'), idParams('M99'));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.pool.questions[0].stem).toBe('updated stem');
  });

  it('400 when body is not valid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ bad json',
    });
    const res = await PUT(req, idParams('M99'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('400 when body lacks {poolJson}', async () => {
    const res = await PUT(jsonRequest('PUT', {}), idParams('M99'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/poolJson/);
  });

  it('400 when poolJson is invalid JSON', async () => {
    const res = await PUT(jsonRequest('PUT', { poolJson: '{ broken' }), idParams('M99'));
    expect(res.status).toBe(400);
  });

  it('400 when pool is structurally invalid (validatePool fails)', async () => {
    const bad = { moduleId: 'M99', questions: [{ id: 'x', moduleId: 'M99' }] };
    const res = await PUT(jsonRequest('PUT', { poolJson: JSON.stringify(bad) }), idParams('M99'));
    expect(res.status).toBe(400);
  });

  it('400 when url id does not match pool.moduleId', async () => {
    const pool = validPool('M99');
    const res = await PUT(jsonRequest('PUT', { poolJson: JSON.stringify(pool) }), idParams('M88'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mismatch/i);
  });
});
