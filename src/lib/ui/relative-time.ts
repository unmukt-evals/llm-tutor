/**
 * relative-time.ts — render an epoch-ms timestamp as a short relative phrase.
 *
 * Buckets:
 *   < 60s             → 'just now'
 *   < 60m             → '<n>m ago'
 *   < 24h             → '<n>h ago'
 *   < 30d             → '<n>d ago'
 *   ≥ 30d             → 'over 30d ago'
 *
 * Future timestamps (now < ts) collapse to 'just now' — we don't render
 * negative deltas, and clock skew on a single-writer system is small enough
 * that this is the right default.
 */

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const delta = now - ts;
  if (delta < 0) return 'just now';

  const seconds = Math.floor(delta / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return 'over 30d ago';
}
