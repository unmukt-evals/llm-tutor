import { describe, it, expect, vi } from 'vitest';
import type { Source } from '@/lib/types';
import type { SourcesDoc } from '@/lib/cms/types';
import type { WritableFsLike } from '@/lib/cms/sources/json-store';
import { loadSourcesJson, writeSourcesJson } from '@/lib/cms/sources/json-store';

// ── Minimal fixture helpers ────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> & { id: string }): Source {
  return {
    kind: 'url',
    title: 'Test source',
    content_hash: 'aabbccdd',
    updated_at: 1000000,
    ...overrides,
  };
}

/** Build an in-memory FsLike backed by a plain Record. */
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
        throw new Error(`ENOENT rename: ${src}`);
      }
      files[dst] = files[src];
      delete files[src];
    },
    unlink: async (p: string) => {
      delete files[p];
    },
  };
}

// ── Test 1: loadSourcesJson on missing file → returns empty default ────────

describe('loadSourcesJson', () => {
  it('returns {version:1, sources:[]} when the file is absent', async () => {
    const fs = memFs();
    const result = await loadSourcesJson('/fake/dir', fs);
    expect(result).toEqual({ version: 1, sources: [] });
  });

  // ── Test 2: loadSourcesJson on valid file → returns parsed SourcesDoc ─────

  it('parses a valid _sources.json and returns the SourcesDoc', async () => {
    const s = makeSource({ id: 'S1', title: 'Hello' });
    const doc: SourcesDoc = { version: 1, sources: [s] };
    const fs = memFs({ '/fake/dir/_sources.json': JSON.stringify(doc, null, 2) + '\n' });
    const result = await loadSourcesJson('/fake/dir', fs);
    expect(result.version).toBe(1);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].id).toBe('S1');
    expect(result.sources[0].title).toBe('Hello');
  });

  // ── Test 3: loadSourcesJson on malformed JSON → throws with file path ─────

  it('throws an error containing the file path on malformed JSON', async () => {
    const fs = memFs({ '/fake/dir/_sources.json': 'not json{{' });
    await expect(loadSourcesJson('/fake/dir', fs)).rejects.toThrow(
      '/fake/dir/_sources.json',
    );
  });
});

// ── Test 4: writeSourcesJson then loadSourcesJson round-trip → deep-equal ──

describe('writeSourcesJson / loadSourcesJson round-trip', () => {
  it('writes and reads back a doc deep-equal to the original', async () => {
    const fs = memFs();
    const s1 = makeSource({ id: 'S1', title: 'First', content_hash: 'aaa', updated_at: 1 });
    const s2 = makeSource({ id: 'S2', title: 'Second', url: 'https://example.com', content_hash: 'bbb', updated_at: 2 });
    const doc: SourcesDoc = { version: 1, sources: [s1, s2] };

    await writeSourcesJson('/fake/dir', doc, fs);
    const loaded = await loadSourcesJson('/fake/dir', fs);

    expect(loaded.version).toBe(1);
    expect(loaded.sources).toHaveLength(2);
    expect(loaded.sources[0].id).toBe('S1');
    expect(loaded.sources[1].id).toBe('S2');
    expect(loaded.sources[1].url).toBe('https://example.com');
  });

  // ── Full-field round-trip: all Source fields preserved end-to-end ──────────
  it('preserves all Source fields (including arrays + optional scalars) through write → load', async () => {
    const fs = memFs();
    const full: Source = {
      id: 'S-full',
      kind: 'transcript',
      title: 'Full field test',
      url: 'https://example.com/full',
      author: 'Jane Doe',
      cluster: 'Cluster 3 — evaluation',
      summary: 'A summary line.',
      thesis: 'The thesis block.',
      mechanism: 'The mechanism that matters.',
      quotes: ['Quote one.', 'Quote two.'],
      grounds: ['B1', 'C3'],
      raw_text: 'Raw transcript body here.',
      fetched_at: 1700000000000,
      content_hash: '0123456789abcdef'.repeat(4),
      updated_at: 1700000001000,
    };
    const doc: SourcesDoc = { version: 1, sources: [full] };

    await writeSourcesJson('/fake/dir', doc, fs);
    const loaded = await loadSourcesJson('/fake/dir', fs);

    expect(loaded.sources).toHaveLength(1);
    expect(loaded.sources[0]).toEqual(full);
  });
});

// ── Test 5: writeSourcesJson with duplicate ids → throws ─────────────────

describe('writeSourcesJson validation', () => {
  it('throws "duplicate source id" when two sources share an id', async () => {
    const fs = memFs();
    const s1 = makeSource({ id: 'S1' });
    const s2 = makeSource({ id: 'S1', title: 'Also S1' });
    const doc: SourcesDoc = { version: 1, sources: [s1, s2] };

    await expect(writeSourcesJson('/fake/dir', doc, fs)).rejects.toThrow(
      'duplicate source id S1',
    );
    // Must not have written anything
    expect(fs.files['/fake/dir/_sources.json']).toBeUndefined();
  });

  it('throws when a source has an empty id', async () => {
    const fs = memFs();
    const s = makeSource({ id: '' });
    const doc: SourcesDoc = { version: 1, sources: [s] };

    await expect(writeSourcesJson('/fake/dir', doc, fs)).rejects.toThrow();
    expect(fs.files['/fake/dir/_sources.json']).toBeUndefined();
  });

  // ── Test 6: fills content_hash + updated_at when missing ──────────────────

  it('fills content_hash and updated_at when they are missing from a source', async () => {
    const fs = memFs();
    // Build a partial source missing required computed fields
    const partial = {
      id: 'S3',
      kind: 'url' as const,
      title: 'Partial source',
      url: 'https://example.com/partial',
      // intentionally omitting content_hash and updated_at
    } as unknown as Source;
    const doc: SourcesDoc = { version: 1, sources: [partial] };

    // Should not throw — should fill in the missing fields
    await writeSourcesJson('/fake/dir', doc, fs);
    const loaded = await loadSourcesJson('/fake/dir', fs);

    expect(loaded.sources[0].content_hash).toBeTruthy();
    expect(loaded.sources[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.sources[0].updated_at).toBeGreaterThan(0);
  });

  it('leaves content_hash and updated_at alone when both are already present', async () => {
    const fs = memFs();
    const s = makeSource({ id: 'S4', content_hash: 'deadbeef'.repeat(8), updated_at: 999 });
    const doc: SourcesDoc = { version: 1, sources: [s] };

    await writeSourcesJson('/fake/dir', doc, fs);
    const loaded = await loadSourcesJson('/fake/dir', fs);

    expect(loaded.sources[0].content_hash).toBe('deadbeef'.repeat(8));
    expect(loaded.sources[0].updated_at).toBe(999);
  });

  // ── Regression: updated_at: 0 (Unix epoch) must not be treated as missing ─
  it('preserves updated_at:0 (Unix epoch) unchanged when content_hash is also present', async () => {
    const fs = memFs();
    const s = makeSource({ id: 'S5', content_hash: 'cafebabe'.repeat(8), updated_at: 0 });
    const doc: SourcesDoc = { version: 1, sources: [s] };

    await writeSourcesJson('/fake/dir', doc, fs);
    const loaded = await loadSourcesJson('/fake/dir', fs);

    expect(loaded.sources[0].content_hash).toBe('cafebabe'.repeat(8));
    // updated_at must remain exactly 0, not be bumped to Date.now()
    expect(loaded.sources[0].updated_at).toBe(0);
  });
});

// ── Test 7: atomic write — rename failure does not leave partial file ──────

describe('writeSourcesJson atomicity', () => {
  it('does not leave a partial _sources.json when rename throws', async () => {
    const fs = memFs();
    const renameError = new Error('rename EXDEV: cross-device link');
    // Override rename to throw
    const failingFs: WritableFsLike = {
      ...fs,
      rename: async (_src: string, _dst: string) => {
        throw renameError;
      },
    };

    const s = makeSource({ id: 'S1', content_hash: 'abc', updated_at: 1 });
    const doc: SourcesDoc = { version: 1, sources: [s] };

    await expect(writeSourcesJson('/fake/dir', doc, failingFs)).rejects.toThrow(renameError.message);

    // The real target must not have been created
    expect(fs.files['/fake/dir/_sources.json']).toBeUndefined();
    // The temp file should be cleaned up (unlink was called)
    const hasTmp = Object.keys(fs.files).some((k) => k.endsWith('.tmp'));
    expect(hasTmp).toBe(false);
  });

  it('writes the temp file then renames — target file is stable on disk', async () => {
    const writtenPaths: string[] = [];
    const renamedFrom: string[] = [];
    const fs2 = memFs();
    const trackingFs: WritableFsLike = {
      ...fs2,
      writeFile: async (p: string, content: string) => {
        writtenPaths.push(p);
        fs2.files[p] = content;
      },
      rename: async (src: string, dst: string) => {
        renamedFrom.push(src);
        fs2.files[dst] = fs2.files[src];
        delete fs2.files[src];
      },
    };

    const s = makeSource({ id: 'S1', content_hash: 'abc', updated_at: 1 });
    const doc: SourcesDoc = { version: 1, sources: [s] };

    await writeSourcesJson('/fake/dir', doc, trackingFs);

    // writeFile was called on a .tmp path, rename was called
    expect(writtenPaths.some((p) => p.includes('.tmp'))).toBe(true);
    expect(renamedFrom.some((p) => p.includes('.tmp'))).toBe(true);

    // Final file exists and is valid JSON
    const raw = fs2.files['/fake/dir/_sources.json'];
    expect(raw).toBeTruthy();
    const parsed: SourcesDoc = JSON.parse(raw);
    expect(parsed.sources[0].id).toBe('S1');
  });
});

// ── Key order stability: serialized JSON has deterministic key order ─────

describe('on-disk JSON key order stability', () => {
  it('produces the same bytes regardless of in-memory Source key insertion order', async () => {
    const fs1 = memFs();
    const fs2 = memFs();

    // Create the same logical Source but in two different in-memory key orders
    const s_normal: Source = makeSource({
      id: 'S1',
      kind: 'url',
      title: 'Stability test',
      url: 'https://example.com',
      content_hash: 'fixedhash',
      updated_at: 12345,
    });

    // Construct with keys in reverse order
    const s_reversed = {} as Source;
    Object.assign(s_reversed, {
      updated_at: 12345,
      content_hash: 'fixedhash',
      url: 'https://example.com',
      title: 'Stability test',
      kind: 'url' as const,
      id: 'S1',
    });

    await writeSourcesJson('/fake/dir', { version: 1, sources: [s_normal] }, fs1);
    await writeSourcesJson('/fake/dir', { version: 1, sources: [s_reversed] }, fs2);

    expect(fs1.files['/fake/dir/_sources.json']).toBe(
      fs2.files['/fake/dir/_sources.json'],
    );
  });
});
