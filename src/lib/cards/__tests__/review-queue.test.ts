import { describe, it, expect } from 'vitest';
import {
  initialQueueState,
  revealBack,
  advanceQueue,
} from '@/lib/cards/review-queue';

describe('initialQueueState', () => {
  it('starts at the first card showing the front when the deck is non-empty', () => {
    expect(initialQueueState(3)).toEqual({ index: 0, phase: 'front' });
  });

  it('is immediately done for an empty deck', () => {
    expect(initialQueueState(0)).toEqual({ index: 0, phase: 'done' });
  });
});

describe('revealBack', () => {
  it('flips the current card from front to back without changing index', () => {
    expect(revealBack({ index: 1, phase: 'front' })).toEqual({
      index: 1,
      phase: 'back',
    });
  });

  it('is a no-op once the deck is done', () => {
    const done = { index: 2, phase: 'done' as const };
    expect(revealBack(done)).toEqual(done);
  });
});

describe('advanceQueue', () => {
  it('moves to the next card front-first when more remain', () => {
    expect(advanceQueue({ index: 0, phase: 'back' }, 3)).toEqual({
      index: 1,
      phase: 'front',
    });
  });

  it('marks the deck done after grading the last card', () => {
    expect(advanceQueue({ index: 2, phase: 'back' }, 3)).toEqual({
      index: 2,
      phase: 'done',
    });
  });

  it('handles a single-card deck (done after the only card)', () => {
    expect(advanceQueue({ index: 0, phase: 'back' }, 1)).toEqual({
      index: 0,
      phase: 'done',
    });
  });
});
