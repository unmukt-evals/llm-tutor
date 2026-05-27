import { describe, it, expect } from 'vitest';
import { isCardDue, nextSrInterval } from '@/lib/state/sr';
import type { FlashcardState } from '@/lib/types';

const DAY = 24 * 60 * 60 * 1000;

function card(intervalDays: 7 | 14 | 30, lastTested: string): FlashcardState {
  return { lastTested, intervalDays, ease: 'good' };
}

describe('isCardDue', () => {
  it('is due when elapsed ≥ intervalDays', () => {
    const last = new Date('2026-05-01T00:00:00.000Z');
    const now = new Date(last.getTime() + 7 * DAY); // exactly 7 days
    expect(isCardDue(card(7, last.toISOString()), now)).toBe(true);
  });

  it('is not due when elapsed < intervalDays', () => {
    const last = new Date('2026-05-01T00:00:00.000Z');
    const now = new Date(last.getTime() + 6 * DAY);
    expect(isCardDue(card(7, last.toISOString()), now)).toBe(false);
  });

  it('is due when overdue (elapsed > intervalDays)', () => {
    const last = new Date('2026-05-01T00:00:00.000Z');
    const now = new Date(last.getTime() + 40 * DAY);
    expect(isCardDue(card(30, last.toISOString()), now)).toBe(true);
  });

  it('is due when lastTested is empty (never tested)', () => {
    expect(isCardDue(card(7, ''), new Date('2026-05-01T00:00:00.000Z'))).toBe(true);
  });

  it('is due when lastTested is an invalid date string', () => {
    expect(isCardDue(card(7, 'not-a-date'), new Date('2026-05-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('nextSrInterval', () => {
  const now = new Date('2026-05-10T00:00:00.000Z');

  it('advances 7 → 14 on correct recall', () => {
    const next = nextSrInterval(card(7, '2026-05-01T00:00:00.000Z'), 'good', now);
    expect(next.intervalDays).toBe(14);
    expect(next.ease).toBe('good');
    expect(next.lastTested).toBe(now.toISOString());
  });

  it('advances 14 → 30 on correct recall', () => {
    expect(nextSrInterval(card(14, '2026-05-01T00:00:00.000Z'), 'good', now).intervalDays).toBe(30);
  });

  it('caps at 30 on correct recall', () => {
    expect(nextSrInterval(card(30, '2026-05-01T00:00:00.000Z'), 'good', now).intervalDays).toBe(30);
  });

  it('resets to 7 on a miss and records ease again', () => {
    const next = nextSrInterval(card(30, '2026-05-01T00:00:00.000Z'), 'again', now);
    expect(next.intervalDays).toBe(7);
    expect(next.ease).toBe('again');
    expect(next.lastTested).toBe(now.toISOString());
  });

  it('does not mutate the input card (pure)', () => {
    const input = card(7, '2026-05-01T00:00:00.000Z');
    nextSrInterval(input, 'good', now);
    expect(input).toEqual({ lastTested: '2026-05-01T00:00:00.000Z', intervalDays: 7, ease: 'good' });
  });

  it('defaults now to the current time when omitted', () => {
    const before = Date.now();
    const next = nextSrInterval(card(7, '2026-05-01T00:00:00.000Z'), 'good');
    const stamped = new Date(next.lastTested).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });
});
