#!/usr/bin/env node
// seed-sidecar.mjs — One-time (idempotent) seed migration from module
// frontmatter `baseline_state.current_level` (and the _progress.md baseline
// tables, which mirror the same values) into the sidecar _llmtutor-state.json.
//
// The sidecar shape is `TutorState` (docs/plans/00-shared-model.md §5). The
// pure mapping / merge logic lives in ./seed-core.mjs and is unit-tested via
// Vitest (src/lib/seed/__tests__/seed-core.test.ts) against the app's own
// defaultModuleState() / defaultTutorState() so the shapes can never drift.
//
// Usage:
//   node scripts/seed-sidecar.mjs [--curriculum-dir PATH] [--dry-run]
//   CURRICULUM_DIR=/path node scripts/seed-sidecar.mjs --dry-run
//
// Defaults:
//   --curriculum-dir  $CURRICULUM_DIR
//                     || ~/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum
//   --dry-run         false (pass the flag to print JSON without writing)
//
// Idempotent / non-destructive: if the sidecar already exists, a module whose
// mastery is already non-`blank` is PRESERVED (earned progress is never
// regressed). Every entry is logged as seeded / preserved / carried.

import { readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import {
  mergeModules,
  buildSeededTutorState,
  moduleFromFrontmatter,
} from './seed-core.mjs';

const SIDECAR_FILENAME = '_llmtutor-state.json';
const DEFAULT_CURRICULUM_DIR =
  process.env.CURRICULUM_DIR ||
  join(
    homedir(),
    'Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum',
  );

function parseArgs(argv) {
  let curriculumDir = DEFAULT_CURRICULUM_DIR;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--curriculum-dir') curriculumDir = argv[++i];
    else if (a.startsWith('--curriculum-dir=')) curriculumDir = a.slice('--curriculum-dir='.length);
    else if (a === '-h' || a === '--help') {
      console.log(
        'Usage: node scripts/seed-sidecar.mjs [--curriculum-dir PATH] [--dry-run]',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return { curriculumDir, dryRun };
}

/** Atomic JSON write: temp file → rename. */
async function atomicWriteJson(path, data) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

async function main() {
  const { curriculumDir, dryRun } = parseArgs(process.argv.slice(2));

  if (!existsSync(curriculumDir)) {
    console.error(`ERROR: CURRICULUM_DIR not found: ${curriculumDir}`);
    process.exit(1);
  }

  const sidecarPath = join(curriculumDir, SIDECAR_FILENAME);
  const nowIso = new Date().toISOString();

  // 1. Load existing sidecar if present (idempotency: preserve non-blank).
  let existingState = null;
  if (existsSync(sidecarPath)) {
    try {
      existingState = JSON.parse(await readFile(sidecarPath, 'utf8'));
      console.log(
        `Found existing sidecar at ${sidecarPath} — will preserve non-blank mastery.`,
      );
    } catch (err) {
      console.error(`ERROR: existing sidecar is malformed JSON: ${err.message}`);
      process.exit(1);
    }
  }
  const existingModules =
    existingState && typeof existingState.modules === 'object' && existingState.modules !== null
      ? existingState.modules
      : {};

  // 2. Scan every top-level *.md, pull (module_id, current_level).
  const entries = await readdir(curriculumDir);
  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
  const seededLevels = {};
  const fileFor = {};
  for (const file of mdFiles) {
    let text;
    try {
      text = await readFile(join(curriculumDir, file), 'utf8');
    } catch {
      continue;
    }
    const fm = matter(text).data;
    const parsed = moduleFromFrontmatter(fm);
    if (parsed === null) continue;
    seededLevels[parsed.moduleId] = parsed.level;
    fileFor[parsed.moduleId] = file;
    console.log(
      `  Found: ${parsed.moduleId.padEnd(6)} current_level → mastery=${JSON.stringify(parsed.level).padEnd(11)} (${file})`,
    );
  }

  if (Object.keys(seededLevels).length === 0) {
    console.error(
      'ERROR: no module_id frontmatter found in any .md file. Check --curriculum-dir.',
    );
    process.exit(1);
  }

  // 3. Idempotent merge.
  const { modules, actions } = mergeModules(existingModules, seededLevels, nowIso);
  for (const { id, action, mastery } of actions) {
    const label =
      action === 'preserved'
        ? `  Preserve: ${id.padEnd(6)} mastery=${JSON.stringify(mastery)} (skipping seed=${JSON.stringify(seededLevels[id])})`
        : action === 'carried'
          ? `  Carry forward orphaned: ${id} (mastery=${JSON.stringify(mastery)})`
          : `  Seed: ${id.padEnd(6)} mastery=${JSON.stringify(mastery)}`;
    console.log(label);
  }

  // 4. Build final state, preserving any unknown top-level keys from existing.
  let finalState;
  if (existingState) {
    finalState = { ...existingState, modules, version: 1 };
  } else {
    finalState = buildSeededTutorState(modules);
  }

  // 5. Output.
  const jsonStr = JSON.stringify(finalState, null, 2) + '\n';
  if (dryRun) {
    console.log('\n--- DRY RUN — sidecar JSON that would be written (not written) ---');
    console.log(jsonStr);
    return;
  }

  await atomicWriteJson(sidecarPath, finalState);
  console.log(`\nWrote sidecar: ${sidecarPath}`);
  console.log(`  Modules in sidecar: ${Object.keys(modules).length}`);
}

// Only run when invoked directly (so a test could import without side effects).
if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
