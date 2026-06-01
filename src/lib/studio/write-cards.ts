// src/lib/studio/write-cards.ts
// Phase 5c — Studio's atomic writer for the `_flashcards.md` deck.
// Counterpart to write-module / write-pool: single-file, no reindex inside.
//
// Contract:
//   1. Validate body with parseFlashcards. Empty bodies are accepted (an empty
//      deck is valid). Bodies that have list items yet parse to ZERO cards
//      are rejected — every line is malformed, almost certainly corruption.
//   2. Atomic write — `_flashcards.md.tmp` then `rename` over `_flashcards.md`.
//
// This intentionally does NOT call reindexEntity — the API route does, after
// the file is on disk.

import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';

export interface WriteCardsResult {
  /** Relative filename inside `dir` — always `_flashcards.md`. */
  file: string;
}

const FLASHCARDS_FILE = '_flashcards.md';
const LIST_MARKER = /^\s*[-*]\s+/;

function hasListItems(raw: string): boolean {
  for (const line of raw.split('\n')) {
    if (LIST_MARKER.test(line)) return true;
  }
  return false;
}

/**
 * Atomically write the flashcards deck to `_flashcards.md` inside `dir`.
 * Re-validates the body, then writes via `<file>.tmp` + rename.
 */
export async function writeCards(
  dir: string,
  markdown: string,
): Promise<WriteCardsResult> {
  // Validate body. parseFlashcards never throws — it silently skips bad lines.
  // Our writer-level guard: if the input has list items but produces zero
  // cards, every line is malformed — refuse the write.
  const cards = parseFlashcards(markdown);
  if (cards.length === 0 && hasListItems(markdown)) {
    throw new Error(
      'flashcards markdown has list items but parses to no cards (every line malformed)',
    );
  }

  const abs = join(dir, FLASHCARDS_FILE);
  const tmp = `${abs}.tmp`;
  const content = markdown.endsWith('\n') ? markdown : `${markdown}\n`;

  let tmpWritten = false;
  try {
    await writeFile(tmp, content, 'utf8');
    tmpWritten = true;
    await rename(tmp, abs);
  } catch (err) {
    if (tmpWritten) await unlink(tmp).catch(() => {});
    throw err;
  }

  return { file: FLASHCARDS_FILE };
}
