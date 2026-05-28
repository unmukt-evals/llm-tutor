#!/usr/bin/env node
// scripts/generate-pools.mjs
//
// Batch-generates MCQ pools for every curriculum module that doesn't yet
// have one. Skips modules whose <CURRICULUM_DIR>/mcq/<id>.json already
// exists, so the script is idempotent on re-run.
//
// Pipeline per module:
//   1. tsx scripts/pool-bridge.ts parse  <module.md>  → engineer/operator pass
//   2. Call Anthropic /v1/messages via the SAME OAuth recipe used by
//      src/lib/llm/client.ts (Keychain → Bearer; identity-line system prompt;
//      anthropic-beta: oauth-2025-04-20; model claude-sonnet-4-6).
//   3. Extract a single ```json fence (or fall back to a bare JSON object).
//   4. Write candidate to a tempfile and run tsx scripts/pool-bridge.ts
//      validate <tempfile>. On OK → atomic rename into the mcq dir. On
//      failure → log + skip; do NOT ship a broken pool.
//
// Sequential with a 500ms inter-call delay, on purpose: we are sharing the
// founder's OAuth token, not a billing-rate-limited API key.
//
// Usage:
//   node scripts/generate-pools.mjs              # generate all missing pools
//   node scripts/generate-pools.mjs M09          # generate ONE pool (overwrites)
//   node scripts/generate-pools.mjs M09 M10 ...  # generate a specific list

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, writeFile, rename, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// ── Paths ────────────────────────────────────────────────────────────────────

const REPO = '/Users/unmukt/llm-tutor';
const CURRICULUM_DIR =
  '/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum';
const MCQ_DIR = path.join(CURRICULUM_DIR, 'mcq');
const BRIDGE = path.join(REPO, 'scripts', 'pool-bridge.ts');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');

// Modules that already have gold pools (the references) — never regenerate.
const REFERENCE_POOLS = new Set(['B01', 'B02']);

// Full target list, in order. We compute "missing" by reading the mcq dir, but
// keep this list explicit so we can tell if a curriculum file is missing.
const TARGET_MODULES = [
  // Track A
  { id: 'M00', file: 'M00-baseline.md' },
  { id: 'M0.5', file: 'M0.5-forward-pass.md' },
  { id: 'M01', file: 'M01-tokenization.md' },
  { id: 'M02', file: 'M02-embeddings.md' },
  { id: 'M03', file: 'M03-attention.md' },
  { id: 'M04', file: 'M04-transformer-block.md' },
  { id: 'M05', file: 'M05-pretraining.md' },
  { id: 'M06', file: 'M06-post-training.md' },
  { id: 'M07', file: 'M07-sampling.md' },
  { id: 'M08', file: 'M08-inference.md' },
  { id: 'M09', file: 'M09-kv-cache.md' },
  { id: 'M10', file: 'M10-gpu-memory.md' },
  { id: 'M11', file: 'M11-long-context.md' },
  { id: 'M12', file: 'M12-agent-memory.md' },
  // Track B (B01/B02 already done)
  { id: 'B03', file: 'B03-rl-environments-reward-design.md' },
  { id: 'B04', file: 'B04-rl-training-infra-async.md' },
  { id: 'B05', file: 'B05-agent-architecture-fsm.md' },
  { id: 'B06', file: 'B06-simulation-infrastructure.md' },
  { id: 'B07', file: 'B07-interpretability.md' },
];

// ── OAuth recipe (mirrors src/lib/llm/client.ts) ────────────────────────────

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const CLAUDE_CODE_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude.";

async function readKeychainCredential() {
  const { stdout } = await execFileAsync('security', [
    'find-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-w',
  ]);
  return stdout.trim();
}

function parseCredential(raw) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error('Could not parse Claude OAuth credential JSON.');
  }
  const oauth = obj?.claudeAiOauth;
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
    throw new Error('Claude OAuth credential missing claudeAiOauth.accessToken.');
  }
  const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : 0;
  if (expiresAt !== 0 && Date.now() >= expiresAt) {
    throw new Error('Claude OAuth token expired — run any Claude Code command to refresh.');
  }
  return oauth.accessToken;
}

async function callClaudeOnce({ system, userPrompt, maxTokens = 8192 }) {
  const raw = await readKeychainCredential();
  const accessToken = parseCredential(raw);

  const fullSystem =
    system && system.length > 0
      ? `${CLAUDE_CODE_IDENTITY}\n\n${system}`
      : CLAUDE_CODE_IDENTITY;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system: fullSystem,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Anthropic ${res.status} ${res.statusText} ${detail}`.trim());
    err.status = res.status;
    err.retryAfter = Number(res.headers.get('retry-after')) || null;
    throw err;
  }
  const json = await res.json();
  if (json.error?.message) throw new Error(`Anthropic error: ${json.error.message}`);
  const text = (json.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('Anthropic returned an empty response.');
  return text;
}

async function callClaude(opts) {
  // Retry with exponential backoff on transient 429/5xx. Up to 5 tries; total
  // worst-case ~ 2+4+8+16+32 = 62s before giving up (plus any Retry-After).
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await callClaudeOnce(opts);
    } catch (e) {
      const transient =
        e.status === 429 || (typeof e.status === 'number' && e.status >= 500 && e.status < 600);
      if (!transient || attempt >= 6) throw e;
      attempt += 1;
      // Bigger floors — the OAuth token is shared with the Claude Code session.
      // 30s, 60s, 120s, 240s, 300s, 300s
      const baseBackoffs = [30000, 60000, 120000, 240000, 300000, 300000];
      const baseBackoff = baseBackoffs[attempt - 1];
      const wait = e.retryAfter ? Math.max(e.retryAfter * 1000, baseBackoff) : baseBackoff;
      process.stdout.write(`\n        [retry ${attempt}/4 after ${Math.round(wait / 1000)}s — status ${e.status}] `);
      await sleep(wait);
    }
  }
}

// ── Prompt construction ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You generate MCQ pools for an LLM-engineering tutor app. Your output is a single JSON object matching the MCQPool schema described below. You output JSON ONLY, wrapped in a single \`\`\`json fence. No prose before or after.

## MCQPool schema (strict)

\`\`\`ts
type Difficulty = 'easy' | 'medium' | 'hard';
type Dimension  = 'topic' | 'logic' | 'example' | 'extension';

interface MCQQuestion {
  id: string;                                    // "<MODULE>-q01", "<MODULE>-q02", ...
  moduleId: string;                              // must equal the pool's moduleId
  difficulty: Difficulty;
  dimension: Dimension;
  stem: string;                                  // the question text
  options: string[];                             // EXACTLY 4 entries (strings)
  correctIndex: number;                          // integer 0..3
  distractorMisconception: Record<string,string>;// MUST have a key for EACH wrong index
                                                  // (the wrong-option indices as strings,
                                                  //  e.g. {"0": "...", "2": "...", "3": "..."}
                                                  //  if correctIndex is 1)
  explanation: string;                           // non-empty
  sourceRef?: string;                            // e.g. "S4", "engineer-pass", "operator-pass"
}

interface MCQPool {
  moduleId: string;
  questions: MCQQuestion[];
}
\`\`\`

## Hard rules

1. **moduleId** in the pool and in every question MUST equal the supplied module id EXACTLY.
2. At least **12 questions**. Cover the full 3 × 4 grid: each combination of difficulty ∈ {easy, medium, hard} × dimension ∈ {topic, logic, example, extension} appears AT LEAST ONCE. Extra questions allowed but keep total ≤ 16.
3. EXACTLY 4 options per question. \`correctIndex\` is an integer 0..3.
4. **VARY \`correctIndex\` across questions.** Do NOT make the answer always option 0 (or always any single index). A healthy spread across {0,1,2,3} is required; questions should look like real tests, not a key-pattern.
5. \`distractorMisconception\` is REQUIRED. Its keys MUST be EXACTLY the wrong-option indices (as strings — JSON object keys). No key for the correct index. No key outside 0..3. Every wrong index gets a non-empty misconception string explaining *why a learner would pick this wrong answer* (the actual mental model that produces it).
6. \`explanation\` is non-empty and grounds the correct answer in the module's engineer/operator pass or named sources.
7. \`sourceRef\` is required-in-spirit: use the module's source tags (e.g. "S3", "S4") when the question is grounded in a named source; otherwise use "engineer-pass" or "operator-pass".

## Quality bar (read carefully)

- **Dimensions must be meaningful, not cosmetic:**
  - \`topic\`     = does the learner know the *concept / definition / what-it-is*?
  - \`logic\`     = does the learner know *why it works / the mechanism / the chain of reasoning*?
  - \`example\`   = can the learner *recognize or work a concrete instance* (numbers, named systems, code, a real failure mode)?
  - \`extension\` = can the learner *transfer the idea to a new scenario* (a different system, a new constraint, a TrustEvals customer situation)?

- **Distractors encode realistic misconceptions.** A wrong option must be something a smart-but-imperfect learner would actually pick because of a specific mental model. The \`distractorMisconception\` text names that mental model in one sentence. Do NOT use obviously-wrong throwaways ("the model runs on a banana") — those teach nothing.

- **Ground in the supplied module material.** Do not invent facts. Pull stems and explanations from the engineer pass + operator pass + named sources. If the module references S3/S4/S5 etc., use those tags in \`sourceRef\`.

- **Voice.** Direct, declarative, no buzzwords, no "safely", no marketing voice. Write like a clean exam, not a sales deck.

- **Anchor in TrustEvals context where the module does.** Track B modules (B01-B07) are explicitly TrustEvals-positioning-bearing — extension questions should pull the learner into the customer/positioning scenario the module sets up.

## Output

A single \`\`\`json fence containing one MCQPool object. NOTHING ELSE.`;

function buildUserPrompt(module) {
  const sourcesBlock =
    module.sources.length > 0
      ? `\n\n## Module sources block (verbatim)\n\n${module.sources.map((s) => `- ${s}`).join('\n')}`
      : '';
  const anchorsBlock =
    module.anchors.length > 0
      ? `\n\n## Anchor scenarios\n\n${module.anchors.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
      : '';
  const operatorBlock = module.operatorPass
    ? `\n\n## Operator pass (TrustEvals decisions this changes)\n\n${module.operatorPass}`
    : '';
  const why = module.whyThisMatters
    ? `\n\n## Why this matters\n\n${module.whyThisMatters}`
    : '';

  return `Generate the MCQ pool for module **${module.id}** ("${module.name}", track ${module.track}).

Pool \`moduleId\` MUST be \`"${module.id}"\`. Every question's \`moduleId\` MUST also be \`"${module.id}"\`. Question ids use the format \`"${module.id}-q01"\`, \`"${module.id}-q02"\`, ...

Ground EVERY question in the material below. Prefer source tags from "Module sources block" for \`sourceRef\`; if a question is grounded in the engineer or operator pass without a named source, use \`"engineer-pass"\` or \`"operator-pass"\`.

VARY \`correctIndex\` — the answer must not always sit at the same index. Spread across {0,1,2,3}.${why}${anchorsBlock}

## Engineer pass (substantive material)

${module.engineerPass || '(empty — fall back to the why-this-matters and anchors above; this module is sparse but a pool is still required.)'}${operatorBlock}${sourcesBlock}

Now produce the pool. JSON-fenced output only.`;
}

// ── Response parsing ────────────────────────────────────────────────────────

function extractJsonFromResponse(text) {
  const fenceMatch = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fenceMatch) return fenceMatch[1].trim();
  // Tolerate a bare JSON object as fallback.
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1).trim();
  }
  throw new Error('Could not locate a JSON block in the response.');
}

// ── tsx bridge helpers ──────────────────────────────────────────────────────

async function bridgeParse(moduleMdPath) {
  const { stdout } = await execFileAsync(TSX, [BRIDGE, 'parse', moduleMdPath], {
    cwd: REPO,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function bridgeValidate(poolJsonPath) {
  try {
    await execFileAsync(TSX, [BRIDGE, 'validate', poolJsonPath], {
      cwd: REPO,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true };
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr) : err.message;
    return { ok: false, reason: stderr.trim() };
  }
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureMcqDir() {
  await mkdir(MCQ_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateOne(target) {
  const modulePath = path.join(CURRICULUM_DIR, target.file);
  if (!(await fileExists(modulePath))) {
    return { id: target.id, status: 'skip', reason: `module .md not found: ${target.file}` };
  }

  let parsed;
  try {
    parsed = await bridgeParse(modulePath);
  } catch (e) {
    return { id: target.id, status: 'fail', reason: `parseModule failed: ${e.message}` };
  }

  // Sanity: the parsed module_id should match the target id we expect.
  if (parsed.id !== target.id) {
    return {
      id: target.id,
      status: 'fail',
      reason: `frontmatter module_id "${parsed.id}" != expected "${target.id}"`,
    };
  }

  const userPrompt = buildUserPrompt(parsed);

  let responseText;
  try {
    responseText = await callClaude({
      system: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 16000,
    });
  } catch (e) {
    return { id: target.id, status: 'fail', reason: `Anthropic call failed: ${e.message}` };
  }

  let jsonText;
  try {
    jsonText = extractJsonFromResponse(responseText);
  } catch (e) {
    return {
      id: target.id,
      status: 'fail',
      reason: `${e.message}\n--- raw response head ---\n${responseText.slice(0, 400)}`,
    };
  }

  // Pre-parse to a JS object to catch JSON syntax errors before validation.
  let poolObj;
  try {
    poolObj = JSON.parse(jsonText);
  } catch (e) {
    return {
      id: target.id,
      status: 'fail',
      reason: `JSON.parse failed: ${e.message}\n--- json head ---\n${jsonText.slice(0, 400)}`,
    };
  }

  // Write to a tempfile, validate via the TS bridge, then atomic-rename if OK.
  const tmpPath = path.join(
    os.tmpdir(),
    `mcq-${target.id.replace(/[^A-Za-z0-9._-]/g, '_')}-${process.pid}-${Date.now()}.json`,
  );
  await writeFile(tmpPath, JSON.stringify(poolObj, null, 2) + '\n', 'utf8');

  const verdict = await bridgeValidate(tmpPath);
  if (!verdict.ok) {
    return {
      id: target.id,
      status: 'fail',
      reason: `validatePool rejected: ${verdict.reason}\n(temp pool kept at ${tmpPath})`,
    };
  }

  // Atomic rename into the curriculum mcq dir.
  const finalPath = path.join(MCQ_DIR, `${target.id}.json`);
  await rename(tmpPath, finalPath);
  const n = Array.isArray(poolObj.questions) ? poolObj.questions.length : 0;
  return { id: target.id, status: 'ok', count: n, finalPath };
}

async function main() {
  await ensureMcqDir();

  // Build the work list. CLI args override (specific modules to regenerate);
  // otherwise: every target whose <id>.json is missing.
  const cliIds = process.argv.slice(2);
  let work;
  if (cliIds.length > 0) {
    work = TARGET_MODULES.filter((t) => cliIds.includes(t.id));
    if (work.length !== cliIds.length) {
      const known = new Set(TARGET_MODULES.map((t) => t.id));
      const unknown = cliIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        console.error(`unknown module ids: ${unknown.join(', ')}`);
        process.exit(2);
      }
    }
  } else {
    const existing = new Set(
      (await readdir(MCQ_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')),
    );
    work = TARGET_MODULES.filter((t) => !REFERENCE_POOLS.has(t.id) && !existing.has(t.id));
  }

  if (work.length === 0) {
    console.log('All target pools already exist. Nothing to do.');
    return;
  }

  console.log(`Generating ${work.length} pool(s): ${work.map((w) => w.id).join(', ')}`);
  console.log(`Writing into: ${MCQ_DIR}\n`);

  const results = [];
  for (let i = 0; i < work.length; i++) {
    const t = work[i];
    process.stdout.write(`[${i + 1}/${work.length}] ${t.id} ... `);
    const r = await generateOne(t);
    results.push(r);
    if (r.status === 'ok') {
      console.log(`OK (${r.count} questions)`);
    } else if (r.status === 'skip') {
      console.log(`SKIP — ${r.reason}`);
    } else {
      console.log(`FAIL`);
      console.log(`        ${r.reason.split('\n').join('\n        ')}`);
    }
    if (i < work.length - 1) await sleep(3000);
  }

  // Summary
  const ok = results.filter((r) => r.status === 'ok');
  const fail = results.filter((r) => r.status === 'fail');
  const skip = results.filter((r) => r.status === 'skip');

  console.log('\n────── Summary ──────');
  console.log(`OK    : ${ok.length}/${results.length}`);
  if (ok.length > 0) {
    for (const r of ok) console.log(`   ✓ ${r.id}  (${r.count}q)`);
  }
  if (skip.length > 0) {
    console.log(`SKIP  : ${skip.length}`);
    for (const r of skip) console.log(`   - ${r.id}  ${r.reason}`);
  }
  if (fail.length > 0) {
    console.log(`FAIL  : ${fail.length}`);
    for (const r of fail) console.log(`   ✗ ${r.id}  ${r.reason.split('\n')[0]}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
