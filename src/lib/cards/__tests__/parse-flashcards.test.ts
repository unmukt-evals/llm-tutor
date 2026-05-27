import { describe, it, expect } from 'vitest';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';

// Real deck format (per llm-deep-dive curriculum skill): cards live under a
// "## Flashcard seeds" section as list items using the ` :: ` (front :: back)
// delimiter, tagged with module + last-tested date.
const SAMPLE = `
## Flashcard seeds

- module:B01 last-tested:2026-05-20 What makes an eval "fair"? :: Invariance to nuisance factors.
- module:B01 What is a harness? :: The scaffold around the eval.
- module:M03 last-tested:2026-01-10 Define attention. :: Weighted sum over value vectors.
`.trim();

describe('parseFlashcards', () => {
  it('parses the correct number of cards', () => {
    expect(parseFlashcards(SAMPLE)).toHaveLength(3);
  });

  it('extracts moduleId from the module tag', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].moduleId).toBe('B01');
    expect(cards[1].moduleId).toBe('B01');
    expect(cards[2].moduleId).toBe('M03');
  });

  it('extracts front and back across the :: delimiter', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].front).toBe('What makes an eval "fair"?');
    expect(cards[0].back).toBe('Invariance to nuisance factors.');
    expect(cards[1].front).toBe('What is a harness?');
    expect(cards[1].back).toBe('The scaffold around the eval.');
  });

  it('parses lastTested when the tag is present', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].lastTested).toBe('2026-05-20');
    expect(cards[2].lastTested).toBe('2026-01-10');
  });

  it('sets lastTested to null when the tag is absent', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[1].lastTested).toBeNull();
  });

  it('assigns a stable per-module sequential id', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].id).toBe('B01-c01');
    expect(cards[1].id).toBe('B01-c02');
    expect(cards[2].id).toBe('M03-c01');
  });

  it('parses bare seed lines (no tags) and defaults moduleId to empty', () => {
    const cards = parseFlashcards('- What is X? :: It is Y.');
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('What is X?');
    expect(cards[0].back).toBe('It is Y.');
    expect(cards[0].moduleId).toBe('');
    expect(cards[0].lastTested).toBeNull();
    expect(cards[0].id).toBe('-c01');
  });

  it('tolerates extra whitespace around the delimiter', () => {
    const cards = parseFlashcards('-   module:A01   Front text  ::  Back text  ');
    expect(cards[0].front).toBe('Front text');
    expect(cards[0].back).toBe('Back text');
    expect(cards[0].moduleId).toBe('A01');
  });

  it('skips malformed lines with no :: delimiter', () => {
    const input = `
- module:B01 a valid card :: with a back
- module:B01 this line has no delimiter and is dropped
- this is a heading, not a card
`.trim();
    const cards = parseFlashcards(input);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('a valid card');
  });

  it('skips lines where front or back is empty after splitting', () => {
    expect(parseFlashcards('- module:B01 :: only a back')).toHaveLength(0);
    expect(parseFlashcards('- module:B01 only a front ::')).toHaveLength(0);
  });

  it('ignores non-list lines (headings, prose, blanks)', () => {
    const input = `
## Flashcard seeds

Some prose that is not a card.

- module:B01 Q :: A
`.trim();
    expect(parseFlashcards(input)).toHaveLength(1);
  });

  it('returns an empty array for empty input', () => {
    expect(parseFlashcards('')).toHaveLength(0);
    expect(parseFlashcards('   \n  \n')).toHaveLength(0);
  });

  it('keeps a :: inside the front/back from splitting more than once', () => {
    // Only the FIRST ` :: ` splits front from back; later ones stay in the back.
    const cards = parseFlashcards('- module:B01 Front :: Back :: with colons');
    expect(cards[0].front).toBe('Front');
    expect(cards[0].back).toBe('Back :: with colons');
  });
});
