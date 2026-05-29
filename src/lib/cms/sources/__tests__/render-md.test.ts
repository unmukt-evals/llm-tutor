/**
 * render-md.test.ts — Unit tests for renderSourcesMd (Phase 4 Task 3).
 *
 * All tests pass opts.now = new Date('2026-05-29T00:00:00Z') for stable
 * `verified:` frontmatter values.
 */

import { describe, it, expect } from 'vitest';
import { renderSourcesMd } from '../render-md';
// Import standing-intro constants so the full-string fixture stays DRY and
// is not accidentally broken by a change to the constants themselves.
import { STANDING_INTRO, JS_GATED_HINT } from '../render-md';
import type { SourcesDoc } from '@/lib/cms/types';
import type { Source } from '@/lib/types';

const NOW = new Date('2026-05-29T00:00:00Z');

// Minimal valid Source factory — only the required fields.
function makeSource(overrides: Partial<Source> & Pick<Source, 'id' | 'title' | 'kind'>): Source {
  return {
    content_hash: 'abc123',
    updated_at: 0,
    ...overrides,
  };
}

// ── Test 1: Empty doc ────────────────────────────────────────────────────────

describe('renderSourcesMd', () => {
  it('1. empty doc → frontmatter + heading + intro only', () => {
    const doc: SourcesDoc = { version: 1, sources: [] };
    const result = renderSourcesMd(doc, { now: NOW });

    // Must start with frontmatter
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('type: source-library');
    expect(result).toContain('verified: 2026-05-29');

    // Must contain top heading
    expect(result).toContain('# Track B — Primary Source Library');

    // Must contain the standing intro paragraphs
    expect(result).toContain('These nine sources were recommended to Unmukt');
    expect(result).toContain('Two of the nine');

    // Must NOT contain any cluster headings or source headings
    expect(result).not.toMatch(/^## Cluster/m);
    expect(result).not.toMatch(/^### /m);

    // Must end with exactly one trailing newline
    expect(result.endsWith('\n')).toBe(true);
    expect(result.endsWith('\n\n')).toBe(false);
  });

  // ── Test 2: Single source renders expected block ─────────────────────────

  it('2. single-source doc → renders full expected block', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({
          id: 'S1',
          kind: 'url',
          title: 'GRPO, rigorously — Cameron R. Wolfe',
          cluster: 'Cluster 1 — RL post-training (how the model got its behavior)',
          url: 'https://cameronrwolfe.substack.com/p/grpo',
          summary: 'Deep technical essay with PyTorch pseudocode.',
          thesis: 'GRPO is a simplification of PPO.',
          mechanism: 'No critic needed.',
          quotes: ['First quote.', 'Second quote.'],
          grounds: ['B2'],
        }),
      ],
    };
    const result = renderSourcesMd(doc, { now: NOW });

    // Cluster heading
    expect(result).toContain(
      '## Cluster 1 — RL post-training (how the model got its behavior)',
    );

    // Source heading
    expect(result).toContain('### S1 · GRPO, rigorously — Cameron R. Wolfe');

    // Bullets in order
    const urlIdx = result.indexOf('- **URL:** https://cameronrwolfe.substack.com/p/grpo');
    const whatIdx = result.indexOf('- **What:** Deep technical essay with PyTorch pseudocode.');
    const thesisIdx = result.indexOf('- **Thesis:** GRPO is a simplification of PPO.');
    const mechIdx = result.indexOf('- **Mechanism that matters:** No critic needed.');
    const quote1Idx = result.indexOf('- **Quote:** First quote.');
    const quote2Idx = result.indexOf('- **Quote:** Second quote.');
    const groundsIdx = result.indexOf('- **Grounds:** B2');

    expect(urlIdx).toBeGreaterThan(0);
    expect(whatIdx).toBeGreaterThan(urlIdx);
    expect(thesisIdx).toBeGreaterThan(whatIdx);
    expect(mechIdx).toBeGreaterThan(thesisIdx);
    expect(quote1Idx).toBeGreaterThan(mechIdx);
    expect(quote2Idx).toBeGreaterThan(quote1Idx);
    expect(groundsIdx).toBeGreaterThan(quote2Idx);

    // Ends with trailing newline
    expect(result.endsWith('\n')).toBe(true);
  });

  // ── Test 3: Two clusters in first-encounter order ────────────────────────

  it('3. two clusters appear in first-encounter order from doc.sources[]', () => {
    // Input order: [clusterA, clusterB, clusterA, clusterB]
    // Expected output order: clusterA section (two sources), clusterB section (two sources)
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({ id: 'S1', kind: 'url', title: 'Alpha-1', cluster: 'Cluster Alpha' }),
        makeSource({ id: 'S2', kind: 'url', title: 'Beta-1', cluster: 'Cluster Beta' }),
        makeSource({ id: 'S3', kind: 'url', title: 'Alpha-2', cluster: 'Cluster Alpha' }),
        makeSource({ id: 'S4', kind: 'url', title: 'Beta-2', cluster: 'Cluster Beta' }),
      ],
    };
    const result = renderSourcesMd(doc, { now: NOW });

    const alphaHeadingIdx = result.indexOf('## Cluster Alpha');
    const betaHeadingIdx = result.indexOf('## Cluster Beta');

    // Alpha heading must appear before Beta heading
    expect(alphaHeadingIdx).toBeGreaterThan(0);
    expect(betaHeadingIdx).toBeGreaterThan(alphaHeadingIdx);

    // Both cluster headings appear exactly once
    expect(result.split('## Cluster Alpha').length - 1).toBe(1);
    expect(result.split('## Cluster Beta').length - 1).toBe(1);

    // S1 and S3 (alpha) appear before S2 and S4 (beta) in the output
    const s1Idx = result.indexOf('### S1 ·');
    const s2Idx = result.indexOf('### S2 ·');
    const s3Idx = result.indexOf('### S3 ·');
    const s4Idx = result.indexOf('### S4 ·');

    expect(s1Idx).toBeGreaterThan(alphaHeadingIdx);
    expect(s3Idx).toBeGreaterThan(s1Idx);
    expect(s2Idx).toBeGreaterThan(betaHeadingIdx);
    expect(s4Idx).toBeGreaterThan(s2Idx);

    // s3 (last in alpha section) appears before s2 (first in beta section)
    expect(s3Idx).toBeLessThan(s2Idx);
  });

  // ── Test 4: Idempotency ───────────────────────────────────────────────────

  it('4. idempotency — same input + same now → byte-identical output', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({
          id: 'S1',
          kind: 'url',
          title: 'Some Source',
          cluster: 'Cluster 1',
          url: 'https://example.com',
          summary: 'A summary.',
          quotes: ['A quote.'],
          grounds: ['B1', 'B2'],
        }),
        makeSource({
          id: 'S2',
          kind: 'doc',
          title: 'Another Source',
          cluster: 'Cluster 2',
        }),
      ],
    };

    const result1 = renderSourcesMd(doc, { now: NOW });
    const result2 = renderSourcesMd(doc, { now: NOW });

    expect(result1).toBe(result2);
  });

  // ── Test 5: Stability against in-memory key order ────────────────────────

  it('5. stability — Source built with different key insertion order renders identically', () => {
    // Build two Source objects with identical field values but different key order
    const sourceNormal = makeSource({
      id: 'S1',
      kind: 'url',
      title: 'Test Source',
      cluster: 'Cluster 1',
      url: 'https://example.com',
      summary: 'Summary text.',
      thesis: 'Thesis text.',
      mechanism: 'Mechanism text.',
      quotes: ['Quote one.'],
      grounds: ['B1'],
    });

    // Build same Source but assign keys in a different order to produce
    // a different V8 property enumeration order
    const sourceReordered: Source = {
      grounds: ['B1'],
      quotes: ['Quote one.'],
      mechanism: 'Mechanism text.',
      thesis: 'Thesis text.',
      summary: 'Summary text.',
      url: 'https://example.com',
      cluster: 'Cluster 1',
      title: 'Test Source',
      kind: 'url',
      id: 'S1',
      content_hash: 'abc123',
      updated_at: 0,
    };

    const doc1: SourcesDoc = { version: 1, sources: [sourceNormal] };
    const doc2: SourcesDoc = { version: 1, sources: [sourceReordered] };

    const result1 = renderSourcesMd(doc1, { now: NOW });
    const result2 = renderSourcesMd(doc2, { now: NOW });

    expect(result1).toBe(result2);
  });

  // ── Additional: optional fields are omitted when absent ──────────────────

  it('optional fields absent → bullets omitted', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({
          id: 'S1',
          kind: 'doc',
          title: 'Minimal Source',
          cluster: 'Cluster 1',
          // No url, summary, thesis, mechanism, quotes, grounds
        }),
      ],
    };
    const result = renderSourcesMd(doc, { now: NOW });

    expect(result).toContain('### S1 · Minimal Source');
    expect(result).not.toContain('**URL:**');
    expect(result).not.toContain('**What:**');
    expect(result).not.toContain('**Thesis:**');
    expect(result).not.toContain('**Mechanism that matters:**');
    expect(result).not.toContain('**Quote:**');
    expect(result).not.toContain('**Grounds:**');
  });

  // ── Additional: sources without cluster → Unfiled group ──────────────────

  it('sources without cluster → Unfiled group at the end', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({ id: 'S1', kind: 'url', title: 'Clustered', cluster: 'Cluster 1' }),
        makeSource({ id: 'S2', kind: 'url', title: 'No Cluster' }), // no cluster
      ],
    };
    const result = renderSourcesMd(doc, { now: NOW });

    const clusteredIdx = result.indexOf('## Cluster 1');
    const unfiledIdx = result.indexOf('## Unfiled');

    expect(clusteredIdx).toBeGreaterThan(0);
    expect(unfiledIdx).toBeGreaterThan(clusteredIdx);
    expect(result).toContain('### S2 · No Cluster');
  });

  // ── Additional: multiple grounds joined with comma-space ─────────────────

  it('grounds array is comma-joined', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({
          id: 'S1',
          kind: 'url',
          title: 'Multi-grounds',
          cluster: 'C1',
          grounds: ['B1', 'B2', 'B3'],
        }),
      ],
    };
    const result = renderSourcesMd(doc, { now: NOW });
    expect(result).toContain('- **Grounds:** B1, B2, B3');
  });

  // ── Full-string fixture: single source in one cluster ────────────────────
  //
  // Locks the exact rendered output (spacing fidelity) so future whitespace
  // regressions are caught immediately. The expected string reflects the
  // canonical live-file structure: heading immediately followed by bullets
  // (no blank line between ### and first bullet), ONE blank line after the
  // bullet block as the inter-source separator.

  it('full-string fixture — single source, single cluster', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({
          id: 'S1',
          kind: 'url',
          title: 'GRPO, rigorously — Cameron R. Wolfe',
          cluster: 'Cluster 1 — RL post-training (how the model got its behavior)',
          url: 'https://cameronrwolfe.substack.com/p/grpo',
          summary: 'Deep technical essay…',
          thesis: 'GRPO is a simplification of PPO…',
          quotes: ['quote one', 'quote two'],
          grounds: ['B2'],
        }),
      ],
    };

    const expected =
      `---\n` +
      `type: source-library\n` +
      `verified: 2026-05-29\n` +
      `---\n` +
      `\n` +
      `# Track B — Primary Source Library\n` +
      `\n` +
      STANDING_INTRO + `\n` +
      `\n` +
      JS_GATED_HINT + `\n` +
      `\n` +
      `---\n` +
      `\n` +
      `## Cluster 1 — RL post-training (how the model got its behavior)\n` +
      `\n` +
      `### S1 · GRPO, rigorously — Cameron R. Wolfe\n` +
      `- **URL:** https://cameronrwolfe.substack.com/p/grpo\n` +
      `- **What:** Deep technical essay…\n` +
      `- **Thesis:** GRPO is a simplification of PPO…\n` +
      `- **Quote:** quote one\n` +
      `- **Quote:** quote two\n` +
      `- **Grounds:** B2\n`;

    expect(renderSourcesMd(doc, { now: NOW })).toBe(expected);
  });

  // ── Empty / whitespace-only quotes and grounds are filtered ──────────────

  it('empty/whitespace-only quotes and grounds are filtered out', () => {
    const doc: SourcesDoc = {
      version: 1,
      sources: [
        makeSource({
          id: 'S1',
          kind: 'url',
          title: 'Filtered Source',
          cluster: 'Cluster 1',
          quotes: ['', 'real quote', '   '],
          grounds: ['', 'B1', '  '],
        }),
      ],
    };
    const result = renderSourcesMd(doc, { now: NOW });

    // Only the non-empty quote and ground should appear
    expect(result).toContain('- **Quote:** real quote');
    expect(result).toContain('- **Grounds:** B1');

    // Empty/whitespace entries must not produce bullets
    // (check there's no "Quote: " with trailing space/nothing)
    const lines = result.split('\n');
    const quoteBullets = lines.filter((l) => l.startsWith('- **Quote:**'));
    const groundsBullets = lines.filter((l) => l.startsWith('- **Grounds:**'));
    expect(quoteBullets).toHaveLength(1);
    expect(groundsBullets).toHaveLength(1);
  });
});
