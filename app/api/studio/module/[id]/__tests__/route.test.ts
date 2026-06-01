/**
 * route.test.ts — Studio Module GET/PUT API route tests (Phase 5b).
 *
 *   GET /api/studio/module/[id]  → returns {markdown, module}; 404 on miss
 *   PUT /api/studio/module/[id]  → validates + atomic-writes; 400 on bad
 *                                  markdown or url<>parsed-id mismatch
 *
 * Status code contract:
 *   GET 200 hit | 404 miss
 *   PUT 200 ok | 400 bad body | 400 invalid markdown | 400 id mismatch
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetCmsIndexForTests } from '@/lib/cms';
import { GET, PUT } from '../route';

const VALID_MD = (id = 'M99', name = 'Test Module', extra = '') =>
  `---\nmodule_id: ${id}\nname: ${name}\n---\n\n## Why this matters\n\nbecause.${extra}\n\n### Engineer pass\n- x\n`;

function jsonRequest(method: 'GET' | 'PUT', body?: unknown): Request {
  return new Request('http://localhost/api/studio/module/M99', {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function idParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/studio/module/[id]', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-mod-get-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 200 {markdown, module} for an indexed module', async () => {
    const md = VALID_MD('M99', 'Test Module');
    await writeFile(join(dir, 'M99-test-module.md'), md, 'utf8');
    const res = await GET(jsonRequest('GET'), idParams('M99'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.markdown).toBe(md);
    expect(body.module.id).toBe('M99');
    expect(body.module.name).toBe('Test Module');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await GET(jsonRequest('GET'), idParams('ghost'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not found');
  });
});

describe('PUT /api/studio/module/[id]', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-mod-put-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('200 + writes file when markdown is valid', async () => {
    const md = VALID_MD('M99', 'Test Module', ' v2');
    const res = await PUT(jsonRequest('PUT', { markdown: md }), idParams('M99'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe('M99');
    const onDisk = await readFile(join(dir, body.file), 'utf8');
    expect(onDisk).toContain('because. v2');
  });

  it('200 + reindexes so a subsequent GET reflects the write', async () => {
    const md = VALID_MD('M99', 'Test Module');
    await writeFile(join(dir, 'M99-test-module.md'), md, 'utf8');
    // First GET seeds the index.
    await GET(jsonRequest('GET'), idParams('M99'));

    const updated = VALID_MD('M99', 'Test Module', ' v2');
    const putRes = await PUT(jsonRequest('PUT', { markdown: updated }), idParams('M99'));
    expect(putRes.status).toBe(200);

    const getRes = await GET(jsonRequest('GET'), idParams('M99'));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.markdown).toContain('because. v2');
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

  it('400 when body lacks {markdown}', async () => {
    const res = await PUT(jsonRequest('PUT', {}), idParams('M99'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/markdown/);
  });

  it('400 when markdown does not parse as a Module', async () => {
    const res = await PUT(jsonRequest('PUT', { markdown: 'not a module' }), idParams('M99'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('400 when url id does not match parsed module id', async () => {
    const md = VALID_MD('M99', 'Test Module');
    const res = await PUT(jsonRequest('PUT', { markdown: md }), idParams('M88'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mismatch/i);
  });
});
