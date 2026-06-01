/**
 * route.test.ts — Studio Cards GET/PUT API route tests (Phase 5c).
 *
 *   GET /api/studio/cards  → returns {markdown, parsedCount}; markdown is ""
 *                            and count 0 when no `_flashcards.md` exists.
 *   PUT /api/studio/cards  → validates + atomic-writes + reindexes; 400 on
 *                            bad body or markdown that fails validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetCmsIndexForTests } from '@/lib/cms';
import { GET, PUT } from '../route';

const GOOD_DECK = [
  '- module:B01 What makes an eval "fair"? :: Invariance to nuisance factors.',
  '- module:B01 last-tested:2026-05-20 What is a harness? :: The scaffold around the eval.',
  '',
].join('\n');

function jsonRequest(method: 'GET' | 'PUT', body?: unknown): Request {
  return new Request('http://localhost/api/studio/cards', {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/studio/cards', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-cards-get-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 200 with empty markdown when _flashcards.md is missing', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.markdown).toBe('');
    expect(body.parsedCount).toBe(0);
  });

  it('returns 200 {markdown, parsedCount} when the deck exists', async () => {
    await writeFile(join(dir, '_flashcards.md'), GOOD_DECK, 'utf8');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.markdown).toBe(GOOD_DECK);
    expect(body.parsedCount).toBe(2);
  });
});

describe('PUT /api/studio/cards', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-cards-put-'));
    process.env.CURRICULUM_DIR = dir;
    __resetCmsIndexForTests();
    await mkdir(join(dir, 'mcq'), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.CURRICULUM_DIR;
    __resetCmsIndexForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it('200 + persists + reports parsed count', async () => {
    const res = await PUT(jsonRequest('PUT', { markdown: GOOD_DECK }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    expect(onDisk).toContain('What is a harness?');
  });

  it('200 + reindexes so a subsequent GET reflects the write', async () => {
    const r1 = await PUT(jsonRequest('PUT', { markdown: GOOD_DECK }));
    expect(r1.status).toBe(200);
    const r2 = await GET();
    expect(r2.status).toBe(200);
    const body = await r2.json();
    expect(body.markdown).toBe(GOOD_DECK);
    expect(body.parsedCount).toBe(2);
  });

  it('400 when body is not valid JSON', async () => {
    const req = new Request('http://localhost', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ bad json',
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('400 when body lacks {markdown}', async () => {
    const res = await PUT(jsonRequest('PUT', {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/markdown/);
  });

  it('400 when markdown has list items but parses to zero cards', async () => {
    const bad = '- bad line with no delimiter\n- ditto\n';
    const res = await PUT(jsonRequest('PUT', { markdown: bad }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
