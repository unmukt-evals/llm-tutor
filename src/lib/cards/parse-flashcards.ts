// src/lib/cards/parse-flashcards.ts
// Parses the `_flashcards.md` deck into typed Flashcard objects.
//
// Pure: the caller passes the raw file string (keeps this testable, no IO here).
//
// Deck format (per the llm-deep-dive curriculum skill): cards are markdown list
// items using the ` :: ` (front :: back) delimiter, optionally prefixed with tag
// tokens for the source module and the last-tested date, e.g.
//
//   - module:B01 last-tested:2026-05-20 What makes an eval "fair"? :: Invariance to nuisance factors.
//   - module:B01 What is a harness? :: The scaffold around the eval.
//
// The Module parser's `flashcardSeeds` intentionally KEEP the ` :: ` delimiter;
// this parser is the consumer that splits it.

export interface Flashcard {
  id: string; // stable per-module sequential id, e.g. "B01-c01"
  moduleId: string; // "" if no module tag present
  lastTested: string | null; // ISO date (YYYY-MM-DD) or null if never tested
  front: string;
  back: string;
}

const LIST_MARKER = /^\s*[-*]\s+/;
const MODULE_TAG = /(?:^|\s)module:(\S+)/;
const LAST_TESTED_TAG = /(?:^|\s)last-tested:(\S+)/;
const DELIMITER = ' :: ';

/**
 * Parse the raw `_flashcards.md` content into structured cards.
 * - Splits each list item on the FIRST ` :: ` into front / back.
 * - Reads optional `module:<id>` and `last-tested:<date>` tag tokens from the
 *   text preceding the front.
 * - Skips malformed lines: non-list lines, lines with no delimiter, and lines
 *   where either side is empty after splitting.
 * - Assigns a stable `<moduleId>-cNN` id, sequential per module in file order.
 */
export function parseFlashcards(raw: string): Flashcard[] {
  const cards: Flashcard[] = [];
  const perModuleCount: Record<string, number> = {};

  for (const rawLine of raw.split('\n')) {
    if (!LIST_MARKER.test(rawLine)) continue;

    const line = rawLine.replace(LIST_MARKER, '');
    const delimIndex = line.indexOf(DELIMITER);
    if (delimIndex === -1) continue;

    const lead = line.slice(0, delimIndex);
    const back = line.slice(delimIndex + DELIMITER.length).trim();

    // Strip the tag tokens out of the lead text to recover the front.
    const moduleMatch = MODULE_TAG.exec(lead);
    const lastTestedMatch = LAST_TESTED_TAG.exec(lead);
    const moduleId = moduleMatch ? moduleMatch[1] : '';
    const lastTested = lastTestedMatch ? lastTestedMatch[1] : null;

    const front = lead
      .replace(MODULE_TAG, '')
      .replace(LAST_TESTED_TAG, '')
      .trim();

    if (front.length === 0 || back.length === 0) continue;

    const seq = (perModuleCount[moduleId] ?? 0) + 1;
    perModuleCount[moduleId] = seq;
    const id = `${moduleId}-c${String(seq).padStart(2, '0')}`;

    cards.push({ id, moduleId, lastTested, front, back });
  }

  return cards;
}
