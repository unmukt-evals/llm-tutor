// src/lib/source/apply.ts
// Apply a candidate to CURRICULUM_DIR. PURE namers; IMPURE atomic writers that
// RE-VALIDATE (assertParsesAsModule + validatePool) immediately before writing.
// Atomic = write to <path>.tmp then rename over the target (same fs), mirroring
// JsonStateStore.write. NEVER uses sed; this is the only place V-PIPE writes .md.

import { writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Candidate } from '@/lib/llm/types';
import { validateCandidate } from '@/lib/llm/candidate';

/** PURE: kebab-case slug from a module name (alnum runs joined by '-'). */
export function moduleSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** PURE: default module filename "<id>-<slug>.md" for a NEW module. */
export function moduleFileName(id: string, name: string): string {
  const slug = moduleSlug(name);
  return slug ? `${id}-${slug}.md` : `${id}.md`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, 'utf8');
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export interface ApplyResult {
  moduleFile: string; // relative to dir
  poolFile: string; // relative to dir
}

/**
 * Write the candidate's module .md (at `moduleFileName`, relative to `dir`) and
 * its pool at `mcq/<id>.json`. Re-validates FIRST; throws (writing nothing) if
 * the candidate fails the guardrails. The pool is written pretty-printed. The
 * `mcq/` directory is created if missing.
 */
export async function applyCandidate(
  dir: string,
  candidate: Candidate,
  moduleFileName: string,
): Promise<ApplyResult> {
  // Re-validate at the last possible moment (defense in depth).
  validateCandidate(candidate); // throws on malformed markdown or pool

  const moduleAbs = join(dir, moduleFileName);
  const poolRel = join('mcq', `${candidate.moduleId}.json`);
  const poolAbs = join(dir, poolRel);

  // Normalize pool JSON formatting (pretty-printed, trailing newline).
  const poolPretty = `${JSON.stringify(JSON.parse(candidate.poolJson), null, 2)}\n`;

  // Ensure the mcq/ directory exists before writing the pool.
  await mkdir(dirname(poolAbs), { recursive: true });

  await atomicWrite(
    moduleAbs,
    candidate.markdown.endsWith('\n') ? candidate.markdown : `${candidate.markdown}\n`,
  );
  await atomicWrite(poolAbs, poolPretty);

  return { moduleFile: moduleFileName, poolFile: poolRel };
}
