import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { WritableFsLike } from '@/lib/cms/sources/json-store';
import { loadSourcesJson, writeSourcesJson } from '@/lib/cms/sources/json-store';
import { parseSourcesMd } from '@/lib/cms/sources/migrate-from-md';
import { ensureSourcesJson } from '@/lib/cms/sources/ensure-json';

const DIR = '/fake/cms/dir';

// ── In-memory FS stub (same pattern as json-store.test.ts) ──────────────────

function memFs(initial: Record<string, string> = {}): WritableFsLike & {
  files: Record<string, string>;
} {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    readFile: async (p: string) => {
      if (!(p in files)) {
        const err = Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        throw err;
      }
      return files[p];
    },
    stat: async (p: string) => {
      if (!(p in files)) {
        const err = Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
        throw err;
      }
      return { mtimeMs: 0 };
    },
    readdir: async () => [],
    writeFile: async (p: string, content: string) => {
      files[p] = content;
    },
    rename: async (src: string, dst: string) => {
      if (!(src in files)) {
        const err = Object.assign(new Error(`ENOENT rename: ${src}`), { code: 'ENOENT' });
        throw err;
      }
      files[dst] = files[src];
      delete files[src];
    },
    unlink: async (p: string) => {
      delete files[p];
    },
  };
}

// ── Test 1: No JSON, no MD → writes empty doc, returns {migrated: true} ─────

describe('ensureSourcesJson', () => {
  it('writes an empty doc and returns {migrated: true} when neither file exists', async () => {
    const fs = memFs();

    const result = await ensureSourcesJson(DIR, fs);

    expect(result).toEqual({ migrated: true });

    // The JSON file must now exist
    expect(fs.files[join(DIR, '_sources.json')]).toBeTruthy();

    // The doc written must be the empty default
    const loaded = await loadSourcesJson(DIR, fs);
    expect(loaded).toEqual({ version: 1, sources: [] });
  });

  // ── Test 2: No JSON, MD present → migrates, returns {migrated: true} ────────

  it('migrates _sources.md to _sources.json and returns {migrated: true} when MD exists but JSON does not', async () => {
    // A minimal, well-formed _sources.md
    const rawMd = `---
type: source-library
---

# Track B — Primary Source Library

Some intro.

## Cluster 1 — RL post-training

### S1 · Spinning Up in Deep RL
- **URL:** https://spinningup.openai.com
- **What:** An intro to deep RL by OpenAI.
- **Thesis:** RL is the way.
- **Grounds:** B2
`;

    const fs = memFs({ [join(DIR, '_sources.md')]: rawMd });

    const result = await ensureSourcesJson(DIR, fs);

    expect(result).toEqual({ migrated: true });

    // JSON must now exist
    expect(fs.files[join(DIR, '_sources.json')]).toBeTruthy();

    // The MD must NOT have been deleted
    expect(fs.files[join(DIR, '_sources.md')]).toBe(rawMd);

    // Structural equality: the written doc has the same sources as parseSourcesMd
    const loaded = await loadSourcesJson(DIR, fs);
    const expected = parseSourcesMd(rawMd);

    expect(loaded.version).toBe(1);
    expect(loaded.sources).toHaveLength(expected.sources.length);
    expect(loaded.sources[0].id).toBe(expected.sources[0].id);
    expect(loaded.sources[0].title).toBe(expected.sources[0].title);
    expect(loaded.sources[0].url).toBe(expected.sources[0].url);
    expect(loaded.sources[0].cluster).toBe(expected.sources[0].cluster);
    // Both populated (non-deterministic updated_at just needs to be a number)
    expect(typeof loaded.sources[0].updated_at).toBe('number');
    expect(loaded.sources[0].content_hash).toBeTruthy();
  });

  // ── Test 3: JSON present, MD present → no work, returns {migrated: false} ───

  it('returns {migrated: false} and leaves JSON unchanged when _sources.json already exists', async () => {
    const existingDoc = { version: 1 as const, sources: [] };
    const existingDocStr = JSON.stringify(existingDoc, null, 2) + '\n';
    const rawMd = `## Cluster 1\n\n### S99 · Some source\n- **URL:** https://example.com\n`;

    const fs = memFs({
      [join(DIR, '_sources.json')]: existingDocStr,
      [join(DIR, '_sources.md')]: rawMd,
    });

    const result = await ensureSourcesJson(DIR, fs);

    expect(result).toEqual({ migrated: false });

    // JSON must be unchanged (no S99 in it)
    const loaded = await loadSourcesJson(DIR, fs);
    expect(loaded.sources).toHaveLength(0);
  });

  // ── Test 4: Second invocation after success → idempotent ────────────────────

  it('returns {migrated: false} on a second call after a successful migration', async () => {
    const fs = memFs();

    // First call: bootstrap empty
    const first = await ensureSourcesJson(DIR, fs);
    expect(first).toEqual({ migrated: true });

    // Second call: JSON now exists, must be a no-op
    const second = await ensureSourcesJson(DIR, fs);
    expect(second).toEqual({ migrated: false });
  });
});
