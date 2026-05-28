// src/lib/llm/candidate.ts
// PURE guardrails. A candidate is only ever offered/applied if BOTH hold:
//   - the markdown parses as a structurally-complete Module (round-trip contract)
//   - the pool JSON parses + passes validatePool, and pool.moduleId matches
// The existing parseModule is intentionally lossy, so the contract is structural
// completeness, NOT a byte-identical round-trip.

import { parseModule } from '@/lib/ingest/parse-module';
import { validatePool } from '@/lib/mcq/repository';
import type { Module } from '@/lib/types';
import type { Candidate } from '@/lib/llm/types';

/**
 * Parse `markdown` via the production parser and assert the result is a usable
 * Module. Throws a clear error otherwise. Returns the parsed Module on success.
 */
export function assertParsesAsModule(markdown: string): Module {
  let mod: Module;
  try {
    mod = parseModule(markdown);
  } catch (err) {
    throw new Error(`Proposed module markdown did not parse: ${String(err)}`);
  }
  if (!mod.id || mod.id.length === 0) {
    throw new Error('Proposed module is missing module_id / id.');
  }
  if (!mod.name || mod.name.length === 0) {
    throw new Error('Proposed module is missing a name.');
  }
  if (!mod.whyThisMatters || mod.whyThisMatters.trim().length === 0) {
    throw new Error('Proposed module is missing a non-empty "Why this matters" section.');
  }
  const hasPass = Boolean(mod.passes.tenYearOld || mod.passes.engineer || mod.passes.operator);
  if (!hasPass) {
    throw new Error('Proposed module has no depth pass (10-year-old / Engineer / Operator).');
  }
  return mod;
}

/**
 * Validate BOTH files of a candidate. Throws on the first failure. Returns the
 * parsed Module on success. Asserts the module markdown parses as a complete
 * Module, the pool JSON parses + passes validatePool, and the pool's moduleId
 * matches the module's id (the two files describe the same module).
 */
export function validateCandidate(c: Candidate): { module: Module } {
  const mod = assertParsesAsModule(c.markdown);
  let parsedPool: unknown;
  try {
    parsedPool = JSON.parse(c.poolJson);
  } catch {
    throw new Error('Proposed MCQ pool is not valid JSON.');
  }
  const pool = validatePool(parsedPool); // throws with a human-readable message on failure
  if (pool.moduleId !== mod.id) {
    throw new Error(
      `Proposed pool moduleId "${pool.moduleId}" does not match the module id "${mod.id}".`,
    );
  }
  return { module: mod };
}
