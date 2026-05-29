import { createHash } from 'node:crypto';

/**
 * Stable, deterministic content hash used to detect file-content changes during
 * indexing. Sha256 of the UTF-8 bytes of the input string. Pure — no IO, no
 * platform-specific behavior, safe to unit-test against literals.
 */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
