// src/lib/studio/__tests__/write-cards.test.ts
// Phase 5c — Studio cards writer. Atomic temp+rename to `_flashcards.md`.
// Validates with parseFlashcards: empty bodies are allowed (empty deck), but
// a body that has list items yet parses to ZERO cards is rejected (signals
// total corruption — every line malformed).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCards } from '@/lib/studio/write-cards';
import { parseFlashcards } from '@/lib/cards/parse-flashcards';

const GOOD = [
  '# Flashcards',
  '',
  '- module:B01 What makes an eval "fair"? :: Invariance to nuisance factors.',
  '- module:B01 last-tested:2026-05-20 What is a harness? :: The scaffold around the eval.',
  '',
].join('\n');

describe('writeCards', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llmtutor-write-cards-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes _flashcards.md when none exists', async () => {
    const result = await writeCards(dir, GOOD);
    expect(result.file).toBe('_flashcards.md');
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    expect(onDisk).toContain('What makes an eval');
    expect(onDisk.endsWith('\n')).toBe(true);
  });

  it('overwrites an existing _flashcards.md in place', async () => {
    await writeFile(join(dir, '_flashcards.md'), '- module:B01 old :: card.\n', 'utf8');
    const updated = '- module:B01 new :: card.\n';
    await writeCards(dir, updated);
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    expect(onDisk).toContain('new :: card.');
    expect(onDisk).not.toContain('old :: card.');
  });

  it('round-trips: re-reading and re-parsing yields the same cards', async () => {
    await writeCards(dir, GOOD);
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    const cards = parseFlashcards(onDisk);
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toContain('fair');
    expect(cards[1].lastTested).toBe('2026-05-20');
  });

  it('accepts an empty body (empty deck)', async () => {
    await writeCards(dir, '');
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    expect(onDisk).toBe('\n');
  });

  it('rejects markdown that has list items but parses to zero cards', async () => {
    // List items with no delimiter — corrupted deck.
    const bad = '- this has no delimiter\n- nor does this\n';
    await expect(writeCards(dir, bad)).rejects.toThrow(/no cards/i);
    // Nothing on disk.
    await expect(stat(join(dir, '_flashcards.md'))).rejects.toBeTruthy();
  });

  it('is atomic: a validation failure leaves no .tmp file behind', async () => {
    const original = GOOD;
    await writeFile(join(dir, '_flashcards.md'), original, 'utf8');
    await expect(writeCards(dir, '- bad line no delimiter\n')).rejects.toThrow();
    const entries = await readdir(dir);
    expect(entries.every((f) => !f.endsWith('.tmp'))).toBe(true);
    // Original file untouched.
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    expect(onDisk).toBe(original);
  });

  it('normalizes content to end with a single trailing newline', async () => {
    const noTrail = GOOD.replace(/\n$/, '');
    await writeCards(dir, noTrail);
    const onDisk = await readFile(join(dir, '_flashcards.md'), 'utf8');
    expect(onDisk.endsWith('\n')).toBe(true);
    expect(onDisk.endsWith('\n\n')).toBe(false);
  });
});
