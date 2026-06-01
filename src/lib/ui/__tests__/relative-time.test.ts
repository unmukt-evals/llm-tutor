import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '@/lib/ui/relative-time';

describe('formatRelativeTime', () => {
  const NOW = 1_700_000_000_000;

  it('returns "just now" for deltas under 60 seconds', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 59_999, NOW)).toBe('just now');
  });

  it('renders minutes between 1m and 59m', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1m ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59m ago');
  });

  it('renders hours between 1h and 23h', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1h ago');
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3h ago');
    expect(formatRelativeTime(NOW - 23 * 60 * 60_000, NOW)).toBe('23h ago');
  });

  it('renders days between 1d and 29d', () => {
    expect(formatRelativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('1d ago');
    expect(formatRelativeTime(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe('7d ago');
    expect(formatRelativeTime(NOW - 29 * 24 * 60 * 60_000, NOW)).toBe('29d ago');
  });

  it('collapses anything older than 30d to "over 30d ago"', () => {
    expect(formatRelativeTime(NOW - 30 * 24 * 60 * 60_000, NOW)).toBe('over 30d ago');
    expect(formatRelativeTime(NOW - 365 * 24 * 60 * 60_000, NOW)).toBe('over 30d ago');
  });

  it('treats future timestamps as "just now"', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('just now');
  });
});
