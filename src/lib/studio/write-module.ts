// src/lib/studio/write-module.ts
// Phase 5b — Studio's module-only atomic writer. Counterpart to
// src/lib/source/apply.ts (which is DUAL-file: module .md + mcq/<id>.json).
// Studio edits each artifact independently, so the writer is single-file.
//
// Contract:
//   1. Re-validate the markdown with assertParsesAsModule. Throw on failure
//      (nothing touches disk).
//   2. Url id MUST equal parsed mod.id. Throw on mismatch (defense-in-depth
//      against the api route segment being decoupled from the markdown body).
//   3. Resolve the existing on-disk file name (matches lazyRefresh's resolver):
//        prefer `<id>-<slug>.md`; fall back to `<id>.md`; otherwise treat as
//        new and use moduleFileName(id, name).
//   4. Atomic write — `<file>.tmp` then `rename` over the target. Same fs.
//
// This intentionally does NOT call reindexEntity — the API route does, after
// the file is on disk.

import { writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertSafePathComponent, moduleFileName } from '@/lib/source/apply';
import { assertParsesAsModule } from '@/lib/llm/candidate';

export interface WriteModuleResult {
  /** Relative filename inside `dir`, e.g. `M99-test-module.md`. */
  file: string;
}

/**
 * Resolve the on-disk filename for `id`. Returns null if no existing file
 * matches. Resolver matches lazyRefresh (`<id>-<slug>.md` OR `<id>.md`),
 * never anything inside `mcq/` or other subdirs.
 */
async function resolveExistingModuleFile(dir: string, id: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const hit = entries.find(
    (f) =>
      f.endsWith('.md') &&
      !f.startsWith('_') &&
      (f === `${id}.md` || f.startsWith(`${id}-`)),
  );
  return hit ?? null;
}

/**
 * Atomically write `markdown` for module `id` inside `dir`. Re-validates the
 * markdown body, asserts the parsed id matches the url id, then writes via
 * `<file>.tmp` + rename. Returns the relative filename written.
 */
export async function writeModule(
  dir: string,
  id: string,
  markdown: string,
): Promise<WriteModuleResult> {
  // Defense-in-depth: refuse path-traversing url ids before any path math.
  assertSafePathComponent(id, 'id');

  // Re-validate at the last possible moment — throws with a clear message
  // on bad markdown. Nothing has touched disk yet.
  const mod = assertParsesAsModule(markdown);

  if (mod.id !== id) {
    throw new Error(
      `module id mismatch: url id "${id}" does not match parsed module_id "${mod.id}"`,
    );
  }

  // Resolve existing filename OR build a fresh `<id>-<slug>.md`.
  const existing = await resolveExistingModuleFile(dir, id);
  const file = existing ?? moduleFileName(id, mod.name);
  assertSafePathComponent(file, 'resolvedFile');

  const abs = join(dir, file);
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

  return { file };
}
