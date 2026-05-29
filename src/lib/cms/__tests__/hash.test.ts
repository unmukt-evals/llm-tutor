import { describe, it, expect } from 'vitest';
import { computeContentHash } from '@/lib/cms/hash';

describe('computeContentHash', () => {
  it('is deterministic — same input always yields the same hash', () => {
    expect(computeContentHash('hello world')).toBe(computeContentHash('hello world'));
  });

  it('is a 64-char hex string (sha256)', () => {
    const h = computeContentHash('whatever');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches a known fixed-input digest (sanity-check)', () => {
    // sha256("llm-tutor"). Captured once; locks the algorithm + encoding.
    expect(computeContentHash('llm-tutor')).toBe(
      '2b4e7689a6eeefe21dc946fea2dffc9755f8801cef5172d96aad07dedcfd9991',
    );
  });

  it('is sensitive to whitespace', () => {
    expect(computeContentHash('a b')).not.toBe(computeContentHash('a  b'));
    expect(computeContentHash('a\n')).not.toBe(computeContentHash('a'));
    expect(computeContentHash('a')).not.toBe(computeContentHash('a '));
  });

  it('distinguishes different content', () => {
    expect(computeContentHash('a')).not.toBe(computeContentHash('b'));
  });

  it('treats the empty string as a valid input (not an error)', () => {
    expect(computeContentHash('')).toMatch(/^[0-9a-f]{64}$/);
  });
});
