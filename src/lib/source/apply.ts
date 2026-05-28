// src/lib/source/apply.ts
// Apply a candidate to CURRICULUM_DIR. PURE namers; IMPURE atomic writers that
// RE-VALIDATE (assertParsesAsModule + validatePool) immediately before writing.
// Atomic = write to <path>.tmp then rename over the target (same fs), mirroring
// JsonStateStore.write. NEVER uses sed; this is the only place V-PIPE writes .md.

import { writeFile, rename, unlink, mkdir, readFile } from 'node:fs/promises';
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

/** Guard: throw if a path component contains `/`, `\`, or `..`. */
function assertSafePathComponent(value: string, label: string): void {
  if (value.includes('/') || value.includes('\\') || value.split(/[\\/]/).includes('..')) {
    throw new Error(`unsafe module path: ${label} contains path separators or '..'`);
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
 *
 * Two-phase write: both files are written to temps first; if either temp write
 * fails nothing real is touched. After both temps exist they are renamed into
 * place. If the second rename (pool) fails the module file is restored to its
 * prior state (or removed if it didn't exist) and all temps are cleaned up.
 */
export async function applyCandidate(
  dir: string,
  candidate: Candidate,
  moduleFileName: string,
): Promise<ApplyResult> {
  // Guard caller-supplied path components before any path construction.
  assertSafePathComponent(moduleFileName, 'moduleFileName');
  assertSafePathComponent(candidate.moduleId, 'candidate.moduleId');

  // Re-validate at the last possible moment (defense in depth).
  validateCandidate(candidate); // throws on malformed markdown or pool

  const moduleAbs = join(dir, moduleFileName);
  const poolRel = join('mcq', `${candidate.moduleId}.json`);
  const poolAbs = join(dir, poolRel);

  const moduleTmp = `${moduleAbs}.tmp`;
  const poolTmp = `${poolAbs}.tmp`;

  // Normalize content.
  const moduleContent = candidate.markdown.endsWith('\n')
    ? candidate.markdown
    : `${candidate.markdown}\n`;
  const poolPretty = `${JSON.stringify(JSON.parse(candidate.poolJson), null, 2)}\n`;

  // Ensure the mcq/ directory exists before writing the pool temp.
  await mkdir(dirname(poolAbs), { recursive: true });

  // --- Phase 1: write both temps (no real files touched yet) ---
  let moduleTmpWritten = false;
  let poolTmpWritten = false;
  try {
    await writeFile(moduleTmp, moduleContent, 'utf8');
    moduleTmpWritten = true;
    await writeFile(poolTmp, poolPretty, 'utf8');
    poolTmpWritten = true;
  } catch (err) {
    if (moduleTmpWritten) await unlink(moduleTmp).catch(() => {});
    if (poolTmpWritten) await unlink(poolTmp).catch(() => {});
    throw err;
  }

  // --- Phase 2: rename temps into place ---
  // Capture prior state of moduleAbs so we can restore on failure.
  let priorModuleContent: string | null = null;
  try {
    priorModuleContent = await readFile(moduleAbs, 'utf8');
  } catch {
    priorModuleContent = null; // file didn't exist
  }

  // Rename module temp first.
  await rename(moduleTmp, moduleAbs);

  // Rename pool temp second — if this fails, restore module to prior state.
  try {
    await rename(poolTmp, poolAbs);
  } catch (err) {
    // Restore module file.
    try {
      if (priorModuleContent !== null) {
        await writeFile(moduleAbs, priorModuleContent, 'utf8');
      } else {
        await unlink(moduleAbs).catch(() => {});
      }
    } catch {
      // Best-effort restore; swallow secondary error.
    }
    // Clean up any leftover temps.
    await unlink(moduleTmp).catch(() => {});
    await unlink(poolTmp).catch(() => {});
    throw err;
  }

  return { moduleFile: moduleFileName, poolFile: poolRel };
}
