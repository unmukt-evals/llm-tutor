import { describe, it, expect } from 'vitest';
import { dueCards, countDueCards } from '@/lib/cards/due-cards';
import type { Flashcard } from '@/lib/cards/parse-flashcards';
import type { FlashcardState } from '@/lib/types';

const NOW = new Date('2026-05-27T00:00:00.000Z');

function card(id: string, lastTested: string | null): Flashcard {
  return { id, moduleId: 'B01', lastTested, front: `Q-${id}`, back: `A-${id}` };
}

function state(lastTested: string, intervalDays: 7 | 14 | 30): FlashcardState {
  return { lastTested, intervalDays, ease: 'good' };
}

describe('dueCards', () => {
  it('returns cards whose state interval has elapsed (boundary inclusive)', () => {
    // c01: tested 2026-05-20, interval 7 → due exactly on 2026-05-27.
    const cards = [card('c01', '2026-05-20'), card('c02', '2026-05-20'), card('c03', '2026-05-25')];
    const stateMap: Record<string, FlashcardState> = {
      c01: state('2026-05-20', 7), // 7 elapsed >= 7 → due
      c02: state('2026-05-20', 14), // 7 elapsed < 14 → not due
      c03: state('2026-05-25', 7), // 2 elapsed < 7 → not due
    };
    const due = dueCards(cards, stateMap, NOW);
    expect(due.map((d) => d.card.id)).toEqual(['c01']);
  });

  it('treats a card with NO state entry as due (never reviewed)', () => {
    const cards = [card('c01', null)];
    const due = dueCards(cards, {}, NOW);
    expect(due).toHaveLength(1);
    expect(due[0].card.id).toBe('c01');
  });

  it('treats a card with no state entry as due even if the deck line has a lastTested tag', () => {
    // No FlashcardState entry means it has never been reviewed in-app → due,
    // regardless of an authoring-time last-tested tag in the deck file.
    const cards = [card('c01', '2026-05-26')];
    const due = dueCards(cards, {}, NOW);
    expect(due).toHaveLength(1);
  });

  it('returns an empty array when nothing is due', () => {
    const cards = [card('c01', '2026-05-26')];
    const stateMap = { c01: state('2026-05-26', 7) }; // 1 elapsed < 7
    expect(dueCards(cards, stateMap, NOW)).toHaveLength(0);
  });

  it('attaches the current FlashcardState to each due card', () => {
    const cards = [card('c01', '2026-05-20')];
    const stateMap = { c01: state('2026-05-20', 7) };
    const due = dueCards(cards, stateMap, NOW);
    expect(due[0].state.intervalDays).toBe(7);
    expect(due[0].state.lastTested).toBe('2026-05-20');
  });

  it('synthesizes a default state for due cards that lack an entry', () => {
    const cards = [card('c01', null)];
    const due = dueCards(cards, {}, NOW);
    expect(due[0].state).toEqual({ lastTested: '', intervalDays: 7, ease: 'good' });
  });

  it('defaults `now` to the current date when omitted', () => {
    const cards = [card('c01', null)];
    expect(dueCards(cards, {})).toHaveLength(1);
  });
});

describe('countDueCards', () => {
  it('counts without allocating the DueCard list shape', () => {
    const cards = [card('c01', '2026-05-20'), card('c02', null), card('c03', '2026-05-26')];
    const stateMap: Record<string, FlashcardState> = {
      c01: state('2026-05-20', 7), // due
      c03: state('2026-05-26', 7), // not due
    };
    expect(countDueCards(cards, stateMap, NOW)).toBe(2); // c01 + c02 (no entry)
  });

  it('returns 0 for an empty deck', () => {
    expect(countDueCards([], {}, NOW)).toBe(0);
  });
});
