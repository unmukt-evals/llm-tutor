import { describe, it, expect } from 'vitest';
import { applyRecall, srPatch } from '@/lib/cards/sr-update';
import type { FlashcardState } from '@/lib/types';

const NOW = new Date('2026-05-27T00:00:00.000Z');

function state(intervalDays: 7 | 14 | 30): FlashcardState {
  return { lastTested: '2026-05-20', intervalDays, ease: 'good' };
}

describe('applyRecall', () => {
  it("advances interval 7→14 on 'good'", () => {
    expect(applyRecall(state(7), 'good', NOW).intervalDays).toBe(14);
  });

  it("advances interval 14→30 on 'good'", () => {
    expect(applyRecall(state(14), 'good', NOW).intervalDays).toBe(30);
  });

  it("caps interval at 30 on 'good'", () => {
    expect(applyRecall(state(30), 'good', NOW).intervalDays).toBe(30);
  });

  it("resets interval to 7 on 'again'", () => {
    expect(applyRecall(state(30), 'again', NOW).intervalDays).toBe(7);
  });

  it('stamps lastTested to the provided date (ISO)', () => {
    expect(applyRecall(state(7), 'good', NOW).lastTested).toBe(NOW.toISOString());
  });

  it("sets ease to match the recall", () => {
    expect(applyRecall(state(7), 'good', NOW).ease).toBe('good');
    expect(applyRecall(state(7), 'again', NOW).ease).toBe('again');
  });

  it('does not mutate the input state', () => {
    const input = state(7);
    applyRecall(input, 'good', NOW);
    expect(input).toEqual(state(7));
  });

  it('defaults `now` to the current time when omitted', () => {
    const result = applyRecall(state(7), 'good');
    expect(result.intervalDays).toBe(14);
    expect(typeof result.lastTested).toBe('string');
  });
});

describe('srPatch', () => {
  it('produces a /api/state PATCH descriptor targeting flashcards[id]', () => {
    const patch = srPatch('B01-c01', state(7), 'good', NOW);
    expect(patch.path).toEqual(['flashcards', 'B01-c01']);
    expect(patch.value).toEqual(applyRecall(state(7), 'good', NOW));
  });
});
