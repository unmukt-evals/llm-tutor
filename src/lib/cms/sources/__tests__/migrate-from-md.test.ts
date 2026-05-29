/**
 * migrate-from-md.test.ts — Unit tests for parseSourcesMd (Phase 4 Task 4).
 *
 * Tests parse the excerpt fixture which contains 4 sources across 3 clusters:
 *   - S2  (Cluster 1) — 2 quotes, 2-entry grounds
 *   - S4  (Cluster 2) — 1 quote, 2-entry grounds, multi-line mechanism
 *   - S5  (Cluster 2) — no quotes, 2-entry grounds (no URL asterisk footnote)
 *   - S9a (Cluster 5) — sub-letter id, 3 quotes, 1-entry grounds
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSourcesMd } from '../migrate-from-md';

const FIXTURE_PATH = join(__dirname, 'fixtures/_sources.excerpt.md');
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, 'utf8');

// Fixed clock value so updated_at is deterministic across test runs.
const NOW_MS = 1_717_000_000_000;

// ── Test 1: Fixture round-trip (IDs in fixture order) ─────────────────────────

describe('parseSourcesMd', () => {
  it('1. fixture round-trip — returns exact IDs in fixture order', () => {
    const doc = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });

    expect(doc.version).toBe(1);
    expect(doc.sources).toHaveLength(4);

    const ids = doc.sources.map((s) => s.id);
    expect(ids).toEqual(['S2', 'S4', 'S5', 'S9a']);
  });

  // ── Test 2: Field extraction ──────────────────────────────────────────────

  it('2. S2 — cluster, title, url, summary, thesis, mechanism, quotes[], grounds[]', () => {
    const doc = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });
    const s2 = doc.sources.find((s) => s.id === 'S2');
    expect(s2).toBeDefined();

    expect(s2!.cluster).toBe('Cluster 1 — RL post-training (how the model got its behavior)');
    expect(s2!.title).toBe('Why GRPO is important and how it works — Oxen.ai (Arxiv Dives)');
    expect(s2!.url).toBe('https://ghost.oxen.ai/why-grpo-is-important-and-how-it-works/');
    expect(s2!.summary).toBe(
      "Practitioner walkthrough aimed at GPU-poor fine-tuners; the author trained a 1B Llama-3.2 into a reasoner on 16GB VRAM.",
    );
    expect(s2!.thesis).toContain('Dropping the value model roughly halves the compute');

    // mechanism is present
    expect(s2!.mechanism).toBeTruthy();
    expect(s2!.mechanism).toContain('R1 pipeline alternates SFT and GRPO');

    // 2 quotes
    expect(s2!.quotes).toHaveLength(2);
    expect(s2!.quotes![0]).toContain('pamplemousse');
    expect(s2!.quotes![1]).toContain('regexes and string matching');

    // grounds: 2 entries, trimmed
    expect(s2!.grounds).toHaveLength(2);
    expect(s2!.grounds![0]).toBe('B2 (primary)');
    expect(s2!.grounds![1]).toBe('B3 (reward hacking link)');
  });

  it('2b. S4 — cluster, title, url, summary, thesis, mechanism, quote, grounds', () => {
    const doc = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });
    const s4 = doc.sources.find((s) => s.id === 'S4');
    expect(s4).toBeDefined();

    expect(s4!.cluster).toBe("Cluster 2 — RL environments & reward design (the world the model trains/eval's in)");
    expect(s4!.title).toBe('Is your RL environment fair to your agent? — Adit Jain, Collinear AI');
    // URL value includes the JS-gated annotation — parser takes the first token / whole value
    expect(s4!.url).toContain('https://blog.collinear.ai/p/is-your-rl-environment-fair-to-your');

    // 1 explicit Quote: bullet
    expect(s4!.quotes).toHaveLength(1);
    expect(s4!.quotes![0]).toContain('Verifiers are rarely audited');

    // grounds: 2 entries
    expect(s4!.grounds).toHaveLength(2);
    expect(s4!.grounds![0]).toBe('B1 (fairness lens — primary)');
    expect(s4!.grounds![1]).toBe('B3 (reward design — primary)');
  });

  it('2c. S9a — sub-letter id, cluster, title, url, 3 quotes, 1 grounds entry', () => {
    const doc = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });
    const s9a = doc.sources.find((s) => s.id === 'S9a');
    expect(s9a).toBeDefined();

    expect(s9a!.id).toBe('S9a');
    expect(s9a!.cluster).toBe('Cluster 5 — Mechanistic interpretability (looking inside the model)');
    expect(s9a!.title).toBe(
      'Scaling Monosemanticity — Anthropic / Transformer Circuits (Templeton, Conerly, et al.; Olah)',
    );
    expect(s9a!.url).toContain('transformer-circuits.pub/2024/scaling-monosemanticity');

    expect(s9a!.quotes).toHaveLength(3);
    expect(s9a!.quotes![0]).toContain('linear representation hypothesis');
    expect(s9a!.quotes![1]).toContain('knowing about lies');
    expect(s9a!.quotes![2]).toContain("test set for safety");

    expect(s9a!.grounds).toHaveLength(1);
    expect(s9a!.grounds![0]).toBe('B7 (primary)');
  });

  // ── Test 3: Missing optional bullets parse cleanly ────────────────────────

  it('3. source with no Quote and no Grounds parses without throwing', () => {
    const raw = `
## Cluster X — Test cluster

### SX · Test Source Title
- **URL:** https://example.com
- **What:** A simple summary.
- **Thesis:** A thesis.
`;
    const doc = parseSourcesMd(raw, { now: NOW_MS });
    expect(doc.sources).toHaveLength(1);
    const s = doc.sources[0];
    expect(s.id).toBe('SX');
    expect(s.title).toBe('Test Source Title');
    // quotes absent or empty array — must not be an error
    expect(s.quotes === undefined || (Array.isArray(s.quotes) && s.quotes.length === 0)).toBe(true);
    // grounds absent or empty array
    expect(s.grounds === undefined || (Array.isArray(s.grounds) && s.grounds.length === 0)).toBe(
      true,
    );
  });

  // ── Test 4: content_hash + updated_at populated; kind inferred ────────────

  it('4. every source has content_hash + updated_at; kind inferred from url presence', () => {
    const doc = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });
    for (const s of doc.sources) {
      expect(typeof s.content_hash).toBe('string');
      expect(s.content_hash.length).toBeGreaterThan(0);
      expect(s.updated_at).toBe(NOW_MS);
      // All fixture sources have URLs → kind should be 'url'
      expect(s.kind).toBe('url');
    }
  });

  it('4b. source without URL → kind is "doc"', () => {
    const raw = `
## Cluster X — No-url cluster

### SA · A Doc Source
- **What:** A summary without URL.
- **Thesis:** A thesis.
`;
    const doc = parseSourcesMd(raw, { now: NOW_MS });
    expect(doc.sources[0].kind).toBe('doc');
  });

  // ── Test 5: Determinism ───────────────────────────────────────────────────

  it('5. determinism — parsing the same input twice returns deep-equal docs', () => {
    const doc1 = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });
    const doc2 = parseSourcesMd(FIXTURE_RAW, { now: NOW_MS });
    expect(doc1).toEqual(doc2);
  });

  // ── Robustness: heading with no middle dot ────────────────────────────────

  it('heading with no · separator still parses (title = whole heading minus id)', () => {
    const raw = `
## Cluster X — Some cluster

### SY Title Without Dot
- **URL:** https://example.com/test
- **What:** Summary here.
`;
    const doc = parseSourcesMd(raw, { now: NOW_MS });
    expect(doc.sources).toHaveLength(1);
    const s = doc.sources[0];
    expect(s.id).toBe('SY');
    expect(s.title).toBeTruthy();
    expect(s.title).toContain('Title Without Dot');
  });

  // ── Robustness: bullet value with markdown emphasis ───────────────────────

  it('bullet value with markdown emphasis parses without error', () => {
    const raw = `
## Cluster X — Test cluster

### SZ · Bold Value Source
- **URL:** https://example.com
- **What:** This has **bold** and _italic_ text.
- **Thesis:** The **key insight** is important.
`;
    const doc = parseSourcesMd(raw, { now: NOW_MS });
    expect(doc.sources[0].summary).toContain('**bold**');
    expect(doc.sources[0].thesis).toContain('**key insight**');
  });

  // ── Robustness: comma in non-Grounds bullet ───────────────────────────────

  it('comma in a non-Grounds bullet is NOT split', () => {
    const raw = `
## Cluster X — Test cluster

### SW · Comma Source
- **URL:** https://example.com
- **What:** First thing, second thing, third thing.
- **Grounds:** B1, B2
`;
    const doc = parseSourcesMd(raw, { now: NOW_MS });
    const s = doc.sources[0];
    // What: must NOT be split on commas
    expect(s.summary).toBe('First thing, second thing, third thing.');
    // Grounds: must be split on commas
    expect(s.grounds).toHaveLength(2);
    expect(s.grounds![0]).toBe('B1');
    expect(s.grounds![1]).toBe('B2');
  });

  // ── Self-review: empty strings filtered from quotes / grounds ────────────

  it('empty / whitespace-only entries are filtered from quotes and grounds', () => {
    const raw = `
## Cluster X — Test cluster

### SV · Filter Source
- **URL:** https://example.com
- **Quote:**
- **Quote:** Real quote here.
- **Grounds:** B1,  , B2
`;
    const doc = parseSourcesMd(raw, { now: NOW_MS });
    const s = doc.sources[0];
    // Empty Quote: bullet should be filtered
    const quotes = s.quotes ?? [];
    expect(quotes.every((q) => q.trim() !== '')).toBe(true);
    // Grounds: whitespace-only entry should be filtered
    const grounds = s.grounds ?? [];
    expect(grounds.every((g) => g.trim() !== '')).toBe(true);
    expect(grounds).toContain('B1');
    expect(grounds).toContain('B2');
  });
});
