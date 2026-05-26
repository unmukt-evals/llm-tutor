# S-MCQ (Adaptive MCQ Diagnostic Engine) + S-SELF (Self-Graded-Reveal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic adaptive MCQ diagnostic engine (stratified selection, performance matrix, inconsistency detection, hardwired rules localizer, remediation loop) plus the self-graded-reveal flow for free-text drills/stress-tests, exposed through a thin React UI wired to the plan-01 `StateStore`.

**Architecture:** All diagnostic logic lives in `src/lib/mcq/` as **pure, deterministic functions over `(matrix, answers, pool)`** — no I/O, no React, no LLM — so they are exhaustively unit-testable. A thin `MCQRepository` reads `mcq/<moduleId>.json`, validates the schema, and returns a typed `MCQPool`. The remediation loop and self-graded-reveal write through the existing `StateStore` (plan-01) via the `/api/state` route. UI components (`McqRunner`, feedback view, dimension-profile card, self-reveal panel) are kept dumb — they call the pure functions and persist results.

**Tech Stack:** TypeScript (strict) · Vitest (unit tests, co-located under `__tests__/`) · Node `fs/promises` (pool loading) · React (thin UI) · types from `src/lib/types.ts` (plan-00 shared model).

**Assumptions (from plan-00 + plan-01, already built):** The Next.js scaffold exists; `src/lib/types.ts` exports every type in plan-00 §2–§6 (`MCQQuestion`, `MCQPool`, `MCQRepository`, `AssessmentSpec`, `MCQAnswer`, `Cell`, `PerformanceMatrix`, `DimensionStatus`, `DimensionProfile`, `Diagnosis`, `ChosenDistractor`, `Difficulty`, `Dimension`, `DepthPass`, `ModuleState`, `Mastery`, `TutorState`, `StateStore`, and the function *signatures* for `selectAssessment`/`updateMatrix`/`detectInconsistency`/`localize`/`profileFromMatrix`/`nextMastery`). `StateStore` (`read`/`write`/`getModule`) and the `/api/state` route exist and work. Vitest is configured (`npm test` / `npx vitest run`).

**Determinism note:** `selectAssessment` MUST be seedable. Plan-00 §3 declares `selectAssessment(pool, state, spec)` with three args. To keep tests deterministic without redefining the shared signature, we add an OPTIONAL 4th parameter `rng?: () => number` (defaults to `Math.random`). This is a backward-compatible extension; see "Shared-model note" in Task 4. All other signatures match plan-00 exactly.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/mcq/repository.ts` | `MCQRepository` impl: load + validate `mcq/<moduleId>.json` → `MCQPool` |
| `src/lib/mcq/matrix.ts` | `updateMatrix`, `accuracyByDimension`, `profileFromMatrix` (pure) |
| `src/lib/mcq/inconsistency.ts` | `detectInconsistency` (pure, build-spec §3.4) |
| `src/lib/mcq/localize.ts` | `localize` + `routeRemediation` (pure, build-spec §3.5/§3.1) |
| `src/lib/mcq/select.ts` | `selectAssessment` stratified selection (pure + seedable, §3.2) |
| `src/lib/mcq/remediation.ts` | `buildRemediationAssessment`, `applyDiagnosisToState`, `clearDiagnosisIfResolved` (§3.6) |
| `src/lib/mcq/grade.ts` | `gradeAnswer` (deterministic MCQ scoring) + `feedbackFor` (§3.7 per-question) |
| `src/lib/mcq/self.ts` | S-SELF pure helpers: `revealFor`, `applySelfMark` (writes `stressTest`) (§5) |
| `src/lib/mcq/index.ts` | barrel re-export of the engine public API |
| `src/lib/mcq/__tests__/fixtures/B99-fixture.json` | hand-authored ≥12-question pool (4 dims × 3 difficulties) for tests |
| `src/lib/mcq/__tests__/fixtures/bad-pools.ts` | invalid pool literals for repository validation tests |
| `src/lib/mcq/__tests__/*.test.ts` | co-located Vitest unit tests |
| `components/McqRunner.tsx` | thin runner: renders a question, captures choice, calls grade + feedback |
| `components/McqFeedback.tsx` | per-question feedback view (correct + explanation + distractor-why) |
| `components/DimensionProfileCard.tsx` | dimension-profile card (solid/fuzzy/weak per dimension) |
| `components/SelfRevealPanel.tsx` | S-SELF: scenario → reasoning → reveal → self-mark |

---

## Task 1: Author the fixture MCQ pool

**Files:**
- Create: `src/lib/mcq/__tests__/fixtures/B99-fixture.json`

- [ ] **Step 1: Write the fixture pool**

A 12-question pool: 4 dimensions × 3 difficulties, exactly one question per (difficulty × dimension) cell. The `topic`/`logic` dimensions are authored so the "exact user scenario" test (Task 6) can drive a clustered failure in `extension`. `distractorMisconception` keys are the wrong-option indices (every index except `correctIndex`).

```json
{
  "moduleId": "B99",
  "questions": [
    { "id": "B99-e-topic",  "moduleId": "B99", "difficulty": "easy",   "dimension": "topic",     "stem": "An eval measures…", "options": ["a capability","a vibe","a brand","a price"], "correctIndex": 0, "distractorMisconception": {"1":"treats eval as subjective","2":"confuses eval with marketing","3":"confuses eval with cost"}, "explanation": "An eval measures a capability under test." },
    { "id": "B99-e-logic",  "moduleId": "B99", "difficulty": "easy",   "dimension": "logic",     "stem": "Why hold the test set fixed?", "options": ["to compare runs","to save money","to look fast","to please users"], "correctIndex": 0, "distractorMisconception": {"1":"confuses rigor with cost","2":"confuses rigor with speed","3":"confuses rigor with UX"}, "explanation": "A fixed set makes runs comparable." },
    { "id": "B99-e-example","moduleId": "B99", "difficulty": "easy",   "dimension": "example",   "stem": "Which is a concrete eval case?", "options": ["a labeled prompt+expected output","a roadmap","a slogan","a budget"], "correctIndex": 0, "distractorMisconception": {"1":"confuses case with plan","2":"confuses case with marketing","3":"confuses case with finance"}, "explanation": "A case is an input with an expected output." },
    { "id": "B99-e-ext",    "moduleId": "B99", "difficulty": "easy",   "dimension": "extension",  "stem": "Evals generalize best to…", "options": ["new but similar tasks","unrelated domains","nothing","only the exact cases"], "correctIndex": 0, "distractorMisconception": {"1":"overclaims transfer","2":"denies transfer","3":"denies any generalization"}, "explanation": "Evals transfer to nearby tasks, not arbitrary ones." },

    { "id": "B99-m-topic",  "moduleId": "B99", "difficulty": "medium", "dimension": "topic",     "stem": "Fairness in an eval means…", "options": ["invariance to nuisance factors","largest test set","newest model","cheapest run"], "correctIndex": 0, "distractorMisconception": {"1":"confuses sample size with construct validity","2":"thinks capability==recency","3":"confuses fairness with cost"}, "explanation": "Fairness = invariance to nuisance factors." },
    { "id": "B99-m-logic",  "moduleId": "B99", "difficulty": "medium", "dimension": "logic",     "stem": "A flaky verifier mainly threatens…", "options": ["score validity","disk usage","UI color","license cost"], "correctIndex": 0, "distractorMisconception": {"1":"confuses validity with storage","2":"confuses validity with UI","3":"confuses validity with cost"}, "explanation": "A flaky verifier corrupts the score's meaning." },
    { "id": "B99-m-example","moduleId": "B99", "difficulty": "medium", "dimension": "example",   "stem": "Which exemplifies contamination?", "options": ["test items leaked into training","a typo in a prompt","a slow GPU","a missing README"], "correctIndex": 0, "distractorMisconception": {"1":"confuses contamination with noise","2":"confuses contamination with latency","3":"confuses contamination with docs"}, "explanation": "Contamination = train/test overlap." },
    { "id": "B99-m-ext",    "moduleId": "B99", "difficulty": "medium", "dimension": "extension",  "stem": "Your eval passes; a new paraphrased prompt fails. This signals…", "options": ["weak generalization to paraphrase","a contaminated set","a fairness win","a cheaper model"], "correctIndex": 0, "distractorMisconception": {"1":"misattributes transfer failure to contamination","2":"calls a failure a win","3":"confuses transfer with cost"}, "explanation": "Paraphrase failure = a transfer/extension gap." },

    { "id": "B99-h-topic",  "moduleId": "B99", "difficulty": "hard",   "dimension": "topic",     "stem": "Construct validity is undermined when…", "options": ["the metric measures the wrong thing","the set is large","the model is new","the run is fast"], "correctIndex": 0, "distractorMisconception": {"1":"confuses validity with size","2":"confuses validity with recency","3":"confuses validity with speed"}, "explanation": "Validity fails when the metric proxies the wrong construct." },
    { "id": "B99-h-logic",  "moduleId": "B99", "difficulty": "hard",   "dimension": "logic",     "stem": "Determinism matters in scoring because…", "options": ["non-determinism confounds comparison","it saves money","it looks professional","users prefer it"], "correctIndex": 0, "distractorMisconception": {"1":"confuses rigor with cost","2":"confuses rigor with optics","3":"confuses rigor with UX"}, "explanation": "Non-deterministic scoring makes runs incomparable." },
    { "id": "B99-h-example","moduleId": "B99", "difficulty": "hard",   "dimension": "example",   "stem": "Which is the best worked example of drift?", "options": ["same eval, scores fall as the world changes","a one-time typo","a slow batch","a license renewal"], "correctIndex": 0, "distractorMisconception": {"1":"confuses drift with a single error","2":"confuses drift with latency","3":"confuses drift with admin"}, "explanation": "Drift = systematic change over time, not a one-off." },
    { "id": "B99-h-ext",    "moduleId": "B99", "difficulty": "hard",   "dimension": "extension",  "stem": "To predict prod behavior from an eval you must…", "options": ["match the eval distribution to prod","grow the test set","use a newer model","run it faster"], "correctIndex": 0, "distractorMisconception": {"1":"confuses transfer with size","2":"confuses transfer with recency","3":"confuses transfer with speed"}, "explanation": "Transfer to prod requires distribution match, not scale." }
  ]
}
```

- [ ] **Step 2: Verify the fixture parses and has the expected shape**

Run: `node -e "const p=require('./src/lib/mcq/__tests__/fixtures/B99-fixture.json'); const cells=new Set(p.questions.map(q=>q.difficulty+'/'+q.dimension)); console.log(p.questions.length, cells.size)"`
Expected: `12 12` (12 questions, 12 distinct difficulty/dimension cells).

- [ ] **Step 3: Commit**

```bash
git add src/lib/mcq/__tests__/fixtures/B99-fixture.json
git commit -m "test(mcq): add 12-question fixture pool (4 dims x 3 difficulties)"
```

---

## Task 2: MCQRepository — load + validate pool

**Files:**
- Create: `src/lib/mcq/repository.ts`
- Create: `src/lib/mcq/__tests__/fixtures/bad-pools.ts`
- Test: `src/lib/mcq/__tests__/repository.test.ts`

- [ ] **Step 1: Write invalid pool literals for validation tests**

`src/lib/mcq/__tests__/fixtures/bad-pools.ts`:

```ts
// Each export is a structurally-broken pool used to assert validation rejects it.
const base = {
  id: 'X-q1', moduleId: 'X', difficulty: 'easy', dimension: 'topic',
  stem: 's', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
  distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' }, explanation: 'e',
};

export const threeOptions = { moduleId: 'X', questions: [{ ...base, options: ['a', 'b', 'c'] }] };
export const correctOutOfRange = { moduleId: 'X', questions: [{ ...base, correctIndex: 4 }] };
export const correctNegative = { moduleId: 'X', questions: [{ ...base, correctIndex: -1 }] };
export const badDifficulty = { moduleId: 'X', questions: [{ ...base, difficulty: 'trivial' }] };
export const badDimension = { moduleId: 'X', questions: [{ ...base, dimension: 'vibes' }] };
// distractor keys must be EXACTLY the wrong-option indices (here correctIndex=0 → keys must be {1,2,3})
export const distractorKeyOnCorrect = { moduleId: 'X', questions: [{ ...base, distractorMisconception: { '0': 'm0', '1': 'm1', '2': 'm2', '3': 'm3' } }] };
export const distractorKeyMissing = { moduleId: 'X', questions: [{ ...base, distractorMisconception: { '1': 'm1', '2': 'm2' } }] };
export const distractorKeyOutOfRange = { moduleId: 'X', questions: [{ ...base, distractorMisconception: { '1': 'm1', '2': 'm2', '5': 'm5' } }] };
export const emptyOptionsArray = { moduleId: 'X', questions: [{ ...base, options: [] }] };
export const notAnArray = { moduleId: 'X', questions: {} };
```

- [ ] **Step 2: Write the failing tests**

`src/lib/mcq/__tests__/repository.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { FileMCQRepository, validatePool } from '../repository';
import * as bad from './fixtures/bad-pools';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

describe('FileMCQRepository.loadPool', () => {
  it('loads a valid pool and returns a typed MCQPool', async () => {
    // fixtures dir is treated as a "curriculum/mcq" dir; file is B99-fixture.json
    const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
    const pool = await repo.loadPool('B99');
    expect(pool).not.toBeNull();
    expect(pool!.moduleId).toBe('B99');
    expect(pool!.questions).toHaveLength(12);
    expect(pool!.questions[0].correctIndex).toBe(0);
  });

  it('returns null when the pool file does not exist', async () => {
    const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
    const pool = await repo.loadPool('NOPE');
    expect(pool).toBeNull();
  });
});

describe('validatePool', () => {
  it('accepts the valid fixture', async () => {
    const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
    const pool = await repo.loadPool('B99');
    expect(() => validatePool(pool)).not.toThrow();
  });

  it.each([
    ['threeOptions', bad.threeOptions, /exactly 4 options/i],
    ['correctOutOfRange', bad.correctOutOfRange, /correctIndex/i],
    ['correctNegative', bad.correctNegative, /correctIndex/i],
    ['badDifficulty', bad.badDifficulty, /difficulty/i],
    ['badDimension', bad.badDimension, /dimension/i],
    ['distractorKeyOnCorrect', bad.distractorKeyOnCorrect, /distractorMisconception/i],
    ['distractorKeyMissing', bad.distractorKeyMissing, /distractorMisconception/i],
    ['distractorKeyOutOfRange', bad.distractorKeyOutOfRange, /distractorMisconception/i],
    ['emptyOptionsArray', bad.emptyOptionsArray, /exactly 4 options/i],
    ['notAnArray', bad.notAnArray, /questions must be an array/i],
  ])('rejects %s', (_name, pool, re) => {
    expect(() => validatePool(pool as unknown)).toThrow(re);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/repository.test.ts`
Expected: FAIL — `Cannot find module '../repository'`.

- [ ] **Step 4: Write minimal implementation**

`src/lib/mcq/repository.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MCQPool, MCQQuestion, MCQRepository, Difficulty, Dimension } from '../types';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/** Throws Error with a human-readable message if the pool is malformed. Returns the typed pool on success. */
export function validatePool(pool: unknown): MCQPool {
  if (!pool || typeof pool !== 'object') throw new Error('pool must be an object');
  const p = pool as Record<string, unknown>;
  if (typeof p.moduleId !== 'string') throw new Error('moduleId must be a string');
  if (!Array.isArray(p.questions)) throw new Error('questions must be an array');

  for (const raw of p.questions as unknown[]) {
    const q = raw as Record<string, unknown>;
    if (typeof q.id !== 'string') throw new Error('question id must be a string');
    if (!DIFFICULTIES.includes(q.difficulty as Difficulty)) {
      throw new Error(`invalid difficulty "${String(q.difficulty)}" in ${String(q.id)}`);
    }
    if (!DIMENSIONS.includes(q.dimension as Dimension)) {
      throw new Error(`invalid dimension "${String(q.dimension)}" in ${String(q.id)}`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`question ${String(q.id)} must have exactly 4 options`);
    }
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) {
      throw new Error(`question ${String(q.id)} has correctIndex out of range (0..3)`);
    }
    const dm = q.distractorMisconception as Record<string, unknown> | undefined;
    if (!dm || typeof dm !== 'object') {
      throw new Error(`question ${String(q.id)} missing distractorMisconception`);
    }
    const expected = [0, 1, 2, 3].filter((i) => i !== q.correctIndex).map(String).sort();
    const actual = Object.keys(dm).sort();
    if (expected.length !== actual.length || expected.some((k, i) => k !== actual[i])) {
      throw new Error(
        `question ${String(q.id)} distractorMisconception keys must be exactly the wrong-option indices [${expected.join(',')}]`,
      );
    }
    if (typeof q.explanation !== 'string') throw new Error(`question ${String(q.id)} missing explanation`);
  }
  return pool as MCQPool;
}

/** Maps a moduleId to its pool filename. Default: "<id>.json" (matches CURRICULUM_DIR/mcq/<id>.json). */
type FileNamer = (moduleId: string) => string;

export class FileMCQRepository implements MCQRepository {
  constructor(
    private readonly mcqDir: string,
    private readonly nameFor: FileNamer = (id) => `${id}.json`,
  ) {}

  async loadPool(moduleId: string): Promise<MCQPool | null> {
    const file = path.join(this.mcqDir, this.nameFor(moduleId));
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    const pool = validatePool(parsed);
    // normalize: ensure each question carries moduleId (schema allows it on the question, but trust the pool)
    pool.questions = pool.questions.map((q): MCQQuestion => ({ ...q, moduleId: pool.moduleId }));
    return pool;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/repository.test.ts`
Expected: PASS (12 cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcq/repository.ts src/lib/mcq/__tests__/repository.test.ts src/lib/mcq/__tests__/fixtures/bad-pools.ts
git commit -m "feat(mcq): MCQRepository with strict pool schema validation"
```

---

## Task 3: Performance matrix — updateMatrix, accuracyByDimension, profileFromMatrix

**Files:**
- Create: `src/lib/mcq/matrix.ts`
- Test: `src/lib/mcq/__tests__/matrix.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/mcq/__tests__/matrix.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { updateMatrix, accuracyByDimension, profileFromMatrix, emptyMatrix } from '../matrix';
import type { MCQQuestion, MCQAnswer, PerformanceMatrix } from '../../types';

function q(id: string, difficulty: MCQQuestion['difficulty'], dimension: MCQQuestion['dimension']): MCQQuestion {
  return { id, moduleId: 'B99', difficulty, dimension, stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0, distractorMisconception: { '1': '', '2': '', '3': '' }, explanation: '' };
}
function ans(qid: string, chosen: number, correct: boolean): MCQAnswer {
  return { questionId: qid, chosenIndex: chosen, correct, at: '2026-05-27T00:00:00Z' };
}

describe('updateMatrix', () => {
  it('increments seen and correct in the right (difficulty,dimension) cell', () => {
    let m: PerformanceMatrix = emptyMatrix();
    m = updateMatrix(m, ans('q1', 0, true), q('q1', 'medium', 'logic'));
    m = updateMatrix(m, ans('q2', 1, false), q('q2', 'medium', 'logic'));
    expect(m.medium.logic).toEqual({ seen: 2, correct: 1 });
  });

  it('does not mutate the input matrix (pure)', () => {
    const m: PerformanceMatrix = emptyMatrix();
    const m2 = updateMatrix(m, ans('q1', 0, true), q('q1', 'easy', 'topic'));
    expect(m.easy.topic).toBeUndefined();
    expect(m2.easy.topic).toEqual({ seen: 1, correct: 1 });
  });
});

describe('accuracyByDimension', () => {
  it('aggregates correct/seen across difficulties per dimension', () => {
    let m: PerformanceMatrix = emptyMatrix();
    m = updateMatrix(m, ans('e', 0, true), q('e', 'easy', 'extension'));
    m = updateMatrix(m, ans('m1', 1, false), q('m1', 'medium', 'extension'));
    m = updateMatrix(m, ans('m2', 1, false), q('m2', 'medium', 'extension'));
    // extension: 1 correct / 3 seen
    expect(accuracyByDimension(m).extension).toBeCloseTo(1 / 3, 5);
  });

  it('reports undefined accuracy as untested → null', () => {
    expect(accuracyByDimension(emptyMatrix()).topic).toBeNull();
  });
});

describe('profileFromMatrix', () => {
  it('classifies solid (>=0.8), fuzzy (0.6..0.8), weak (<0.6), untested (no data)', () => {
    let m: PerformanceMatrix = emptyMatrix();
    // topic: 5/5 = solid
    for (let i = 0; i < 5; i++) m = updateMatrix(m, ans(`t${i}`, 0, true), q(`t${i}`, 'easy', 'topic'));
    // logic: 7/10 = 0.7 fuzzy
    for (let i = 0; i < 10; i++) m = updateMatrix(m, ans(`l${i}`, 0, i < 7), q(`l${i}`, 'medium', 'logic'));
    // extension: 1/4 = 0.25 weak
    for (let i = 0; i < 4; i++) m = updateMatrix(m, ans(`x${i}`, 1, i < 1), q(`x${i}`, 'medium', 'extension'));
    // example: untested
    const p = profileFromMatrix(m);
    expect(p.topic).toBe('solid');
    expect(p.logic).toBe('fuzzy');
    expect(p.extension).toBe('weak');
    expect(p.example).toBe('untested');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/matrix.test.ts`
Expected: FAIL — `Cannot find module '../matrix'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/mcq/matrix.ts`:

```ts
import type {
  MCQAnswer, MCQQuestion, PerformanceMatrix, Cell, Dimension, DimensionStatus, DimensionProfile,
} from '../types';

const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

export function emptyMatrix(): PerformanceMatrix {
  return { easy: {}, medium: {}, hard: {} };
}

/** Pure: returns a new matrix with the answer's (difficulty,dimension) cell incremented. */
export function updateMatrix(m: PerformanceMatrix, a: MCQAnswer, q: MCQQuestion): PerformanceMatrix {
  const prev: Cell = m[q.difficulty][q.dimension] ?? { seen: 0, correct: 0 };
  const cell: Cell = { seen: prev.seen + 1, correct: prev.correct + (a.correct ? 1 : 0) };
  return {
    easy: { ...m.easy },
    medium: { ...m.medium },
    hard: { ...m.hard },
    [q.difficulty]: { ...m[q.difficulty], [q.dimension]: cell },
  };
}

/** Per-dimension accuracy aggregated across all difficulties. null = untested (no seen). */
export function accuracyByDimension(m: PerformanceMatrix): Record<Dimension, number | null> {
  const out = {} as Record<Dimension, number | null>;
  for (const dim of DIMENSIONS) {
    let seen = 0;
    let correct = 0;
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const cell = m[diff][dim];
      if (cell) {
        seen += cell.seen;
        correct += cell.correct;
      }
    }
    out[dim] = seen === 0 ? null : correct / seen;
  }
  return out;
}

export function statusFor(accuracy: number | null): DimensionStatus {
  if (accuracy === null) return 'untested';
  if (accuracy >= 0.8) return 'solid';
  if (accuracy >= 0.6) return 'fuzzy';
  return 'weak';
}

export function profileFromMatrix(m: PerformanceMatrix): DimensionProfile {
  const acc = accuracyByDimension(m);
  return {
    topic: statusFor(acc.topic),
    logic: statusFor(acc.logic),
    example: statusFor(acc.example),
    extension: statusFor(acc.extension),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/matrix.ts src/lib/mcq/__tests__/matrix.test.ts
git commit -m "feat(mcq): performance matrix update + per-dimension profile"
```

---

## Task 4: selectAssessment — stratified, representation-guaranteed selection

**Shared-model note:** plan-00 §3 declares `selectAssessment(pool, state, spec)`. We implement it with an OPTIONAL 4th param `rng: () => number = Math.random` for deterministic tests. This is additive and does not break the shared signature; update `src/lib/types.ts` to append the optional param to the declared function type so callers and tests type-check.

**Files:**
- Create: `src/lib/mcq/select.ts`
- Modify: `src/lib/types.ts` (append optional `rng` param to the `selectAssessment` declaration only)
- Test: `src/lib/mcq/__tests__/select.test.ts`

- [ ] **Step 1: Append the optional rng param to the shared type declaration**

In `src/lib/types.ts`, change the `selectAssessment` declaration:

```ts
// before:
export function selectAssessment(pool: MCQPool, state: ModuleState, spec: AssessmentSpec): MCQQuestion[];
// after:
export function selectAssessment(
  pool: MCQPool, state: ModuleState, spec: AssessmentSpec, rng?: () => number,
): MCQQuestion[];
```

- [ ] **Step 2: Write the failing tests**

`src/lib/mcq/__tests__/select.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { selectAssessment } from '../select';
import { FileMCQRepository } from '../repository';
import { emptyMatrix } from '../matrix';
import type { MCQPool, ModuleState } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function freshState(): ModuleState {
  return {
    mastery: 'blank', masteryHistory: [],
    mcq: { matrix: emptyMatrix(), distractorLog: [], dimensionProfile: { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' } },
    stressTest: {},
  };
}

// deterministic, repeatable PRNG so we can assert across many seeds
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 0xffffffff; };
}

async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const pool = await repo.loadPool('B99');
  if (!pool) throw new Error('fixture missing');
  return pool;
}

describe('selectAssessment guarantees', () => {
  it('returns exactly spec.count questions', async () => {
    const pool = await loadPool();
    const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(1));
    expect(sel).toHaveLength(6);
  });

  it('ALWAYS spans all 3 difficulties and >=3 distinct dimensions (200 seeds)', async () => {
    const pool = await loadPool();
    for (let seed = 1; seed <= 200; seed++) {
      const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(seed));
      const diffs = new Set(sel.map((q) => q.difficulty));
      const dims = new Set(sel.map((q) => q.dimension));
      expect(diffs.has('easy')).toBe(true);
      expect(diffs.has('medium')).toBe(true);
      expect(diffs.has('hard')).toBe(true);
      expect(dims.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('never repeats a question within one assessment', async () => {
    const pool = await loadPool();
    for (let seed = 1; seed <= 50; seed++) {
      const sel = selectAssessment(pool, freshState(), { moduleId: 'B99', count: 6 }, lcg(seed));
      expect(new Set(sel.map((q) => q.id)).size).toBe(sel.length);
    }
  });

  it('excludes recently-correct questions (anti-farm) when pool still satisfies guarantees', async () => {
    const pool = await loadPool();
    const state = freshState();
    // mark the easy-topic question as recently answered correctly
    state.mcq.distractorLog = []; // distractorLog is for wrong picks; recent-correct lives in a separate field
    const recentCorrect = new Set(['B99-e-topic']);
    const sel = selectAssessment(pool, state, { moduleId: 'B99', count: 6, excludeIds: recentCorrect } as never, lcg(3));
    expect(sel.map((q) => q.id)).not.toContain('B99-e-topic');
    // still spans all difficulties
    expect(new Set(sel.map((q) => q.difficulty))).toEqual(new Set(['easy', 'medium', 'hard']));
  });

  it('weights extra slots toward weak/untested dimensions', async () => {
    const pool = await loadPool();
    const state = freshState();
    // make extension look weak so it should be prioritized for the spare slots
    state.mcq.dimensionProfile = { topic: 'solid', logic: 'solid', example: 'solid', extension: 'weak' };
    let extensionHits = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const sel = selectAssessment(pool, state, { moduleId: 'B99', count: 6 }, lcg(seed));
      if (sel.some((q) => q.dimension === 'extension')) extensionHits++;
    }
    // with only 4 extension questions in a 12-pool and weak weighting, it should appear in the vast majority
    expect(extensionHits).toBeGreaterThan(90);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/select.test.ts`
Expected: FAIL — `Cannot find module '../select'`.

- [ ] **Step 4: Write minimal implementation**

`src/lib/mcq/select.ts`:

```ts
import type {
  MCQPool, MCQQuestion, ModuleState, AssessmentSpec, Difficulty, Dimension,
} from '../types';
import { accuracyByDimension } from './matrix';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** AssessmentSpec is extended (additively) with optional anti-farm exclusions. */
type SelectSpec = AssessmentSpec & { excludeIds?: Set<string> };

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Stratified selection (build-spec §3.2):
 *   - guarantees >=1 easy, >=1 medium, >=1 hard
 *   - guarantees >=3 distinct dimensions
 *   - excludes recently-correct ids when guarantees still satisfiable (anti-farm)
 *   - remaining slots weighted toward weak/untested dimensions
 * Deterministic given rng. Defaults to Math.random.
 */
export function selectAssessment(
  pool: MCQPool,
  state: ModuleState,
  spec: AssessmentSpec,
  rng: () => number = Math.random,
): MCQQuestion[] {
  const { count } = spec;
  const exclude = (spec as SelectSpec).excludeIds ?? new Set<string>();

  // candidate pool, anti-farm filtered. If filtering would make guarantees impossible, fall back to full pool.
  const filtered = pool.questions.filter((q) => !exclude.has(q.id));
  const usable = canSatisfyGuarantees(filtered) ? filtered : pool.questions;

  const picked: MCQQuestion[] = [];
  const pickedIds = new Set<string>();
  const take = (q: MCQQuestion | undefined) => {
    if (q && !pickedIds.has(q.id)) { picked.push(q); pickedIds.add(q.id); }
  };

  // 1) one of each difficulty (guarantee A) — random within stratum
  for (const diff of DIFFICULTIES) {
    const stratum = shuffle(usable.filter((q) => q.difficulty === diff && !pickedIds.has(q.id)), rng);
    take(stratum[0]);
  }

  // 2) ensure >=3 distinct dimensions (guarantee B)
  const dimsCovered = () => new Set(picked.map((q) => q.dimension)).size;
  if (dimsCovered() < 3) {
    const byNewDim = shuffle(usable.filter((q) => !pickedIds.has(q.id)), rng)
      .sort((a, b) => Number(hasDim(picked, a.dimension)) - Number(hasDim(picked, b.dimension)));
    for (const q of byNewDim) {
      if (dimsCovered() >= 3 || picked.length >= count) break;
      if (!hasDim(picked, q.dimension)) take(q);
    }
  }

  // 3) fill remaining slots, weighted toward weak/untested dimensions
  const weight = dimensionWeights(state);
  const remaining = shuffle(usable.filter((q) => !pickedIds.has(q.id)), rng)
    .sort((a, b) => weight[b.dimension] - weight[a.dimension]);
  for (const q of remaining) {
    if (picked.length >= count) break;
    take(q);
  }

  return picked.slice(0, count);
}

function hasDim(qs: MCQQuestion[], dim: Dimension): boolean {
  return qs.some((q) => q.dimension === dim);
}

function canSatisfyGuarantees(qs: MCQQuestion[]): boolean {
  const diffs = new Set(qs.map((q) => q.difficulty));
  const dims = new Set(qs.map((q) => q.dimension));
  return DIFFICULTIES.every((d) => diffs.has(d)) && dims.size >= 3;
}

/** Higher weight = more likely to fill a spare slot. weak > untested > fuzzy > solid. */
function dimensionWeights(state: ModuleState): Record<Dimension, number> {
  const acc = accuracyByDimension(state.mcq.matrix);
  const profile = state.mcq.dimensionProfile;
  const dims: Dimension[] = ['topic', 'logic', 'example', 'extension'];
  const out = {} as Record<Dimension, number>;
  for (const dim of dims) {
    const status = profile[dim];
    let base: number;
    if (status === 'weak') base = 4;
    else if (status === 'untested') base = 3;
    else if (status === 'fuzzy') base = 2;
    else base = 1; // solid
    // staleness nudge: dimensions with little data get a small bump
    const a = acc[dim];
    if (a === null) base += 0.5;
    out[dim] = base;
  }
  return out;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/select.test.ts`
Expected: PASS (including the 200-seed difficulty/dimension guarantee).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcq/select.ts src/lib/types.ts src/lib/mcq/__tests__/select.test.ts
git commit -m "feat(mcq): stratified representation-guaranteed selectAssessment (seedable)"
```

---

## Task 5: detectInconsistency — the trigger (build-spec §3.4)

**Files:**
- Create: `src/lib/mcq/inconsistency.ts`
- Test: `src/lib/mcq/__tests__/inconsistency.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/mcq/__tests__/inconsistency.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { updateMatrix, emptyMatrix } from '../matrix';
import { detectInconsistency } from '../inconsistency';
import type { MCQQuestion, MCQAnswer, PerformanceMatrix } from '../../types';

function q(id: string, difficulty: MCQQuestion['difficulty'], dimension: MCQQuestion['dimension']): MCQQuestion {
  return { id, moduleId: 'B99', difficulty, dimension, stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0, distractorMisconception: { '1': '', '2': '', '3': '' }, explanation: '' };
}
const ans = (qid: string, correct: boolean): MCQAnswer => ({ questionId: qid, chosenIndex: correct ? 0 : 1, correct, at: 't' });

function build(rows: Array<[MCQQuestion, boolean]>): PerformanceMatrix {
  let m = emptyMatrix();
  for (const [qq, c] of rows) m = updateMatrix(m, ans(qq.id, c), qq);
  return m;
}

describe('detectInconsistency', () => {
  it('fires on mixed-within-a-band (some medium right, some medium wrong)', () => {
    const m = build([
      [q('m1', 'medium', 'logic'), true],
      [q('m2', 'medium', 'extension'), false],
      [q('m3', 'medium', 'extension'), false],
    ]);
    expect(detectInconsistency(m)).toBe(true);
  });

  it('fires on dimension imbalance (one <60% while >=2 others >80%)', () => {
    const m = build([
      // topic solid
      [q('t1', 'easy', 'topic'), true], [q('t2', 'medium', 'topic'), true], [q('t3', 'hard', 'topic'), true], [q('t4', 'easy', 'topic'), true], [q('t5', 'medium', 'topic'), true],
      // logic solid
      [q('l1', 'easy', 'logic'), true], [q('l2', 'medium', 'logic'), true], [q('l3', 'hard', 'logic'), true], [q('l4', 'easy', 'logic'), true], [q('l5', 'medium', 'logic'), true],
      // extension weak: 0/3
      [q('x1', 'medium', 'extension'), false], [q('x2', 'medium', 'extension'), false], [q('x3', 'hard', 'extension'), false],
    ]);
    expect(detectInconsistency(m)).toBe(true);
  });

  it('does NOT fire on a clean monotone frontier profile (easy✓ medium✓ hard mixed)', () => {
    const m = build([
      [q('e1', 'easy', 'topic'), true], [q('e2', 'easy', 'logic'), true],
      [q('m1', 'medium', 'topic'), true], [q('m2', 'medium', 'logic'), true],
      [q('h1', 'hard', 'topic'), false], [q('h2', 'hard', 'logic'), true], // hard is the frontier, not inconsistent
    ]);
    expect(detectInconsistency(m)).toBe(false);
  });

  it('does NOT fire with too little data (single answer)', () => {
    const m = build([[q('m1', 'medium', 'logic'), false]]);
    expect(detectInconsistency(m)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/inconsistency.test.ts`
Expected: FAIL — `Cannot find module '../inconsistency'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/mcq/inconsistency.ts`:

```ts
import type { PerformanceMatrix, Difficulty, Dimension } from '../types';
import { accuracyByDimension } from './matrix';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/**
 * build-spec §3.4 — fire when EITHER:
 *  (a) mixed-within-a-band: within easy OR medium, the learner has both correct and incorrect answers
 *      (the "medium right then medium wrong" signal). HARD is excluded — hard being mixed is the frontier.
 *  (b) dimension imbalance: one dimension <60% accuracy while >=2 others are >80%.
 * Returns false when there is too little data to judge (no band with >=2 answers, no imbalance).
 */
export function detectInconsistency(m: PerformanceMatrix): boolean {
  // (a) mixed within easy or medium (NOT hard — hard mixed = frontier)
  for (const diff of ['easy', 'medium'] as Difficulty[]) {
    let seen = 0;
    let correct = 0;
    for (const dim of DIMENSIONS) {
      const cell = m[diff][dim];
      if (cell) { seen += cell.seen; correct += cell.correct; }
    }
    if (seen >= 2 && correct > 0 && correct < seen) return true;
  }

  // (b) dimension imbalance
  const acc = accuracyByDimension(m);
  const known = DIMENSIONS.map((d) => acc[d]).filter((a): a is number => a !== null);
  const below60 = known.filter((a) => a < 0.6).length;
  const above80 = known.filter((a) => a > 0.8).length;
  if (below60 >= 1 && above80 >= 2) return true;

  return false;
}

export { DIFFICULTIES, DIMENSIONS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/inconsistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/inconsistency.ts src/lib/mcq/__tests__/inconsistency.test.ts
git commit -m "feat(mcq): inconsistency detector (mixed-band OR dimension imbalance)"
```

---

## Task 6: localize + routeRemediation — the hardwired classifier (build-spec §3.5/§3.1)

**Files:**
- Create: `src/lib/mcq/localize.ts`
- Test: `src/lib/mcq/__tests__/localize.test.ts`

- [ ] **Step 1: Write the failing tests (including the EXACT user scenario)**

`src/lib/mcq/__tests__/localize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { updateMatrix, emptyMatrix } from '../matrix';
import { detectInconsistency } from '../inconsistency';
import { localize, routeRemediation } from '../localize';
import { FileMCQRepository } from '../repository';
import type { MCQQuestion, MCQAnswer, ChosenDistractor, MCQPool, PerformanceMatrix } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const p = await repo.loadPool('B99');
  if (!p) throw new Error('fixture missing');
  return p;
}
const ans = (q: MCQQuestion, chosen: number): MCQAnswer => ({ questionId: q.id, chosenIndex: chosen, correct: chosen === q.correctIndex, at: 't' });

describe('routeRemediation', () => {
  it('maps dimensions to content layers per build-spec §3.1', () => {
    expect(routeRemediation('topic')).toBe('tenYearOld');
    expect(routeRemediation('logic')).toBe('engineer');
    expect(routeRemediation('example')).toBe('lab');
    expect(routeRemediation('extension')).toBe('drill');
  });
});

describe('localize — EXACT user scenario', () => {
  it('easy correct + some-medium-correct + some-medium-wrong clustered in extension → inconsistency → localizes extension → routes to drill', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;

    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];

    // easy: all correct
    for (const id of ['B99-e-topic', 'B99-e-logic', 'B99-e-example', 'B99-e-ext']) {
      m = updateMatrix(m, ans(byId(id), byId(id).correctIndex), byId(id));
    }
    // medium: topic & logic correct
    for (const id of ['B99-m-topic', 'B99-m-logic']) {
      m = updateMatrix(m, ans(byId(id), byId(id).correctIndex), byId(id));
    }
    // medium: extension WRONG, repeatedly choosing distractor option 1
    const ext = byId('B99-m-ext');
    for (let i = 0; i < 2; i++) {
      m = updateMatrix(m, ans(ext, 1), ext);
      log.push({ qid: ext.id, chose: 1, at: 't' });
    }
    // hard extension also wrong, same distractor → recurring misconception
    const hext = byId('B99-h-ext');
    m = updateMatrix(m, ans(hext, 1), hext);
    log.push({ qid: hext.id, chose: 1, at: 't' });

    // 1) the trigger fires
    expect(detectInconsistency(m)).toBe(true);

    // 2) it localizes the failing dimension to extension
    const diag = localize(m, log, pool);
    expect(diag.dimension).toBe('extension');

    // 3) confidence is the accuracy gap (extension ~0, others high) → high
    expect(diag.confidence).toBeGreaterThan(0.6);

    // 4) evidence carries the failing qids and the recurring misconception string
    expect(diag.evidence.qids).toEqual(expect.arrayContaining(['B99-m-ext', 'B99-h-ext']));
    expect(diag.evidence.recurringMisconceptions.length).toBeGreaterThan(0);

    // 5) it routes to the drill layer (extension → drill)
    expect(diag.remediation).toBe('drill');
  });
});

describe('localize — tie-break by recurring misconception', () => {
  it('when two dimensions are equally weak, the one with the more-recurring distractor wins', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let m: PerformanceMatrix = emptyMatrix();
    const log: ChosenDistractor[] = [];
    // logic 0/2 and extension 0/2 → equal accuracy; extension distractor recurs 3x vs logic 1x
    for (const id of ['B99-m-logic', 'B99-h-logic']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-logic', chose: 1, at: 't' });
    for (const id of ['B99-m-ext', 'B99-h-ext']) { m = updateMatrix(m, ans(byId(id), 1), byId(id)); }
    log.push({ qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-m-ext', chose: 1, at: 't' }, { qid: 'B99-h-ext', chose: 1, at: 't' });
    const diag = localize(m, log, pool);
    expect(diag.dimension).toBe('extension');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/localize.test.ts`
Expected: FAIL — `Cannot find module '../localize'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/mcq/localize.ts`:

```ts
import type {
  PerformanceMatrix, ChosenDistractor, MCQPool, Diagnosis, Dimension, DepthPass,
} from '../types';
import { accuracyByDimension } from './matrix';

const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

/** build-spec §3.1 — dimension → content layer routing. */
export function routeRemediation(dim: Dimension): DepthPass | 'lab' | 'drill' {
  switch (dim) {
    case 'topic': return 'tenYearOld';
    case 'logic': return 'engineer';
    case 'example': return 'lab';
    case 'extension': return 'drill';
  }
}

/**
 * build-spec §3.5 — deterministic localizer, NO LLM.
 *  1. worst-accuracy dimension wins.
 *  2. tie-break: the dimension whose chosen distractors' misconception strings recur most.
 *  confidence = accuracy gap between best and worst KNOWN dimension (0..1).
 *  evidence.qids = the failing (incorrect) qids in the chosen dimension; recurringMisconceptions = the distractor strings.
 */
export function localize(m: PerformanceMatrix, log: ChosenDistractor[], pool: MCQPool): Diagnosis {
  const acc = accuracyByDimension(m);
  const known = DIMENSIONS.filter((d) => acc[d] !== null);
  const worstAccuracy = Math.min(...known.map((d) => acc[d] as number));
  const bestAccuracy = Math.max(...known.map((d) => acc[d] as number));

  // candidates = all known dimensions tied at the worst accuracy
  const candidates = known.filter((d) => acc[d] === worstAccuracy);

  // map qid → question for dimension lookup + misconception strings
  const qById = new Map(pool.questions.map((q) => [q.id, q]));

  // count recurring misconception strings per dimension from the distractor log
  const misconceptionCount = (dim: Dimension): { count: number; strings: string[] } => {
    const strings: string[] = [];
    for (const entry of log) {
      const q = qById.get(entry.qid);
      if (!q || q.dimension !== dim) continue;
      const s = q.distractorMisconception[String(entry.chose)];
      if (s) strings.push(s);
    }
    return { count: strings.length, strings };
  };

  // tie-break by recurrence; stable order falls back to DIMENSIONS index
  const chosen = candidates
    .map((d) => ({ d, ...misconceptionCount(d) }))
    .sort((a, b) => b.count - a.count || DIMENSIONS.indexOf(a.d) - DIMENSIONS.indexOf(b.d))[0];

  const dimension = chosen.d;

  // evidence: incorrect qids in this dimension + the distinct misconception strings
  const failingQids = Array.from(new Set(
    log.filter((e) => qById.get(e.qid)?.dimension === dimension).map((e) => e.qid),
  ));
  const recurringMisconceptions = Array.from(new Set(chosen.strings));

  const confidence = Math.max(0, Math.min(1, bestAccuracy - worstAccuracy));

  return {
    dimension,
    confidence,
    evidence: { qids: failingQids, recurringMisconceptions },
    remediation: routeRemediation(dimension),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/localize.test.ts`
Expected: PASS (including the EXACT user scenario test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/localize.ts src/lib/mcq/__tests__/localize.test.ts
git commit -m "feat(mcq): hardwired localizer (worst-dim wins, distractor tie-break, §3.1 routing)"
```

---

## Task 7: gradeAnswer + feedbackFor — deterministic scoring + per-question feedback (§3.7)

**Files:**
- Create: `src/lib/mcq/grade.ts`
- Test: `src/lib/mcq/__tests__/grade.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/mcq/__tests__/grade.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gradeAnswer, feedbackFor } from '../grade';
import type { MCQQuestion } from '../../types';

const q: MCQQuestion = {
  id: 'B99-m-ext', moduleId: 'B99', difficulty: 'medium', dimension: 'extension',
  stem: 'Your eval passes; a paraphrased prompt fails…',
  options: ['weak generalization to paraphrase', 'a contaminated set', 'a fairness win', 'a cheaper model'],
  correctIndex: 0,
  distractorMisconception: { '1': 'misattributes transfer failure to contamination', '2': 'calls a failure a win', '3': 'confuses transfer with cost' },
  explanation: 'Paraphrase failure = a transfer/extension gap.',
};

describe('gradeAnswer', () => {
  it('produces a correct MCQAnswer for the right index', () => {
    const a = gradeAnswer(q, 0, '2026-05-27T00:00:00Z');
    expect(a).toEqual({ questionId: 'B99-m-ext', chosenIndex: 0, correct: true, at: '2026-05-27T00:00:00Z' });
  });
  it('marks a wrong index incorrect', () => {
    expect(gradeAnswer(q, 1, 't').correct).toBe(false);
  });
});

describe('feedbackFor', () => {
  it('on correct: explanation, no distractor-why', () => {
    const fb = feedbackFor(q, 0);
    expect(fb.correct).toBe(true);
    expect(fb.explanation).toMatch(/transfer/);
    expect(fb.distractorWhy).toBeUndefined();
  });
  it('on wrong: includes the explanation AND why the chosen distractor was wrong', () => {
    const fb = feedbackFor(q, 1);
    expect(fb.correct).toBe(false);
    expect(fb.correctIndex).toBe(0);
    expect(fb.distractorWhy).toBe('misattributes transfer failure to contamination');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/grade.test.ts`
Expected: FAIL — `Cannot find module '../grade'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/mcq/grade.ts`:

```ts
import type { MCQQuestion, MCQAnswer } from '../types';

/** Deterministic MCQ scoring — exact-match to correctIndex. NO LLM. */
export function gradeAnswer(q: MCQQuestion, chosenIndex: number, at: string): MCQAnswer {
  return { questionId: q.id, chosenIndex, correct: chosenIndex === q.correctIndex, at };
}

export interface QuestionFeedback {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  /** §3.7 — why the specific chosen distractor was wrong (from distractorMisconception). Absent when correct. */
  distractorWhy?: string;
}

/** build-spec §3.7 per-question feedback. */
export function feedbackFor(q: MCQQuestion, chosenIndex: number): QuestionFeedback {
  const correct = chosenIndex === q.correctIndex;
  return {
    correct,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    distractorWhy: correct ? undefined : q.distractorMisconception[String(chosenIndex)],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/grade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/grade.ts src/lib/mcq/__tests__/grade.test.ts
git commit -m "feat(mcq): deterministic grading + per-question distractor-aware feedback"
```

---

## Task 8: Remediation loop — applyDiagnosis, mini-assessment, clear-on-resolve, mastery gate (§3.6/§7)

**Files:**
- Create: `src/lib/mcq/remediation.ts`
- Test: `src/lib/mcq/__tests__/remediation.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/mcq/__tests__/remediation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { updateMatrix, emptyMatrix } from '../matrix';
import {
  applyDiagnosisToState, buildRemediationAssessment, clearDiagnosisIfResolved, masteryBlockedByWeakDimension,
} from '../remediation';
import { FileMCQRepository } from '../repository';
import type { ModuleState, Diagnosis, MCQPool, MCQAnswer, MCQQuestion } from '../../types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
async function loadPool(): Promise<MCQPool> {
  const repo = new FileMCQRepository(FIXTURE_DIR, (id) => `${id}-fixture.json`);
  const p = await repo.loadPool('B99');
  if (!p) throw new Error('fixture missing');
  return p;
}
function freshState(): ModuleState {
  return {
    mastery: 'fuzzy', masteryHistory: [],
    mcq: { matrix: emptyMatrix(), distractorLog: [], dimensionProfile: { topic: 'solid', logic: 'solid', example: 'solid', extension: 'weak' } },
    stressTest: {},
  };
}
const diag: Diagnosis = {
  dimension: 'extension', confidence: 0.8,
  evidence: { qids: ['B99-m-ext'], recurringMisconceptions: ['misattributes transfer failure to contamination'] },
  remediation: 'drill',
};

describe('applyDiagnosisToState', () => {
  it('records openDiagnosis with openedAt', () => {
    const s = applyDiagnosisToState(freshState(), diag, '2026-05-27T00:00:00Z');
    expect(s.mcq.openDiagnosis?.dimension).toBe('extension');
    expect(s.mcq.openDiagnosis?.openedAt).toBe('2026-05-27T00:00:00Z');
  });
  it('is pure (does not mutate input)', () => {
    const s0 = freshState();
    applyDiagnosisToState(s0, diag, 't');
    expect(s0.mcq.openDiagnosis).toBeUndefined();
  });
});

describe('buildRemediationAssessment', () => {
  it('returns 3 questions all in the weak dimension, spanning difficulties when available', async () => {
    const pool = await loadPool();
    const qs = buildRemediationAssessment(pool, 'extension', 3);
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.dimension === 'extension')).toBe(true);
    expect(new Set(qs.map((q) => q.difficulty)).size).toBe(3); // easy/medium/hard each present
  });
});

describe('masteryBlockedByWeakDimension', () => {
  it('blocks advancement while any dimension is weak', () => {
    expect(masteryBlockedByWeakDimension(freshState())).toBe(true);
  });
  it('does not block when no dimension is weak', () => {
    const s = freshState();
    s.mcq.dimensionProfile = { topic: 'solid', logic: 'solid', example: 'solid', extension: 'solid' };
    expect(masteryBlockedByWeakDimension(s)).toBe(false);
  });
});

describe('clearDiagnosisIfResolved', () => {
  it('clears openDiagnosis once the weak dimension recovers above the bar', async () => {
    const pool = await loadPool();
    const byId = (id: string) => pool.questions.find((q) => q.id === id)!;
    let s = applyDiagnosisToState(freshState(), diag, 't');
    // learner now answers extension correctly across difficulties
    const correct = (q: MCQQuestion): MCQAnswer => ({ questionId: q.id, chosenIndex: q.correctIndex, correct: true, at: 't' });
    for (const id of ['B99-e-ext', 'B99-m-ext', 'B99-h-ext']) {
      s = { ...s, mcq: { ...s.mcq, matrix: updateMatrix(s.mcq.matrix, correct(byId(id)), byId(id)) } };
    }
    s = clearDiagnosisIfResolved(s);
    expect(s.mcq.openDiagnosis).toBeUndefined();
    expect(s.mcq.dimensionProfile.extension).not.toBe('weak');
  });

  it('keeps openDiagnosis while the dimension is still weak', () => {
    let s = applyDiagnosisToState(freshState(), diag, 't');
    s = clearDiagnosisIfResolved(s);
    expect(s.mcq.openDiagnosis?.dimension).toBe('extension');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/remediation.test.ts`
Expected: FAIL — `Cannot find module '../remediation'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/mcq/remediation.ts`:

```ts
import type {
  ModuleState, Diagnosis, MCQPool, MCQQuestion, Dimension, Difficulty,
} from '../types';
import { profileFromMatrix } from './matrix';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** §3.6 — record the open diagnosis on the module state (pure). */
export function applyDiagnosisToState(state: ModuleState, diag: Diagnosis, openedAt: string): ModuleState {
  return {
    ...state,
    mcq: { ...state.mcq, openDiagnosis: { ...diag, openedAt } },
  };
}

/**
 * §3.6 — a fresh dimension-targeted mini-assessment: `count` questions all in `dim`,
 * spanning difficulties (one per difficulty first, then fill).
 */
export function buildRemediationAssessment(pool: MCQPool, dim: Dimension, count = 3): MCQQuestion[] {
  const inDim = pool.questions.filter((q) => q.dimension === dim);
  const picked: MCQQuestion[] = [];
  const ids = new Set<string>();
  for (const diff of DIFFICULTIES) {
    const q = inDim.find((x) => x.difficulty === diff && !ids.has(x.id));
    if (q) { picked.push(q); ids.add(q.id); }
  }
  for (const q of inDim) {
    if (picked.length >= count) break;
    if (!ids.has(q.id)) { picked.push(q); ids.add(q.id); }
  }
  return picked.slice(0, count);
}

/** §7 — mastery cannot advance while any dimension is 'weak'. */
export function masteryBlockedByWeakDimension(state: ModuleState): boolean {
  return Object.values(state.mcq.dimensionProfile).some((s) => s === 'weak');
}

/**
 * §3.6 — recompute the dimension profile from the matrix; clear openDiagnosis
 * if the previously-weak dimension is no longer weak. Pure.
 */
export function clearDiagnosisIfResolved(state: ModuleState): ModuleState {
  const dimensionProfile = profileFromMatrix(state.mcq.matrix);
  const open = state.mcq.openDiagnosis;
  const resolved = open && dimensionProfile[open.dimension] !== 'weak';
  return {
    ...state,
    mcq: {
      ...state.mcq,
      dimensionProfile,
      openDiagnosis: resolved ? undefined : open,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/remediation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/remediation.ts src/lib/mcq/__tests__/remediation.test.ts
git commit -m "feat(mcq): remediation loop (open/clear diagnosis, mini-assessment, weak-dim mastery gate)"
```

---

## Task 9: S-SELF — self-graded-reveal pure helpers (build-spec §5)

**Files:**
- Create: `src/lib/mcq/self.ts`
- Test: `src/lib/mcq/__tests__/self.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/mcq/__tests__/self.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { revealForDrill, revealForStressTest, applyStressSelfMark } from '../self';
import type { Drill, StressTest, ModuleState } from '../../types';
import { emptyMatrix } from '../matrix';

function freshState(): ModuleState {
  return {
    mastery: 'fuzzy', masteryHistory: [],
    mcq: { matrix: emptyMatrix(), distractorLog: [], dimensionProfile: { topic: 'solid', logic: 'solid', example: 'solid', extension: 'solid' } },
    stressTest: {},
  };
}

describe('revealForDrill', () => {
  it('assembles model answer + DC1/DC2 + rubric from the drill and sources', () => {
    const drill: Drill = { scenario: 'Design an eval for X', dc1: 'What nuisance factors must it be invariant to?', dc2: 'How do you detect contamination?' };
    const r = revealForDrill(drill, ['S4: fairness = invariance']);
    expect(r.scenario).toContain('Design an eval');
    expect(r.doubleClicks).toEqual([drill.dc1, drill.dc2]);
    expect(r.rubric.length).toBeGreaterThan(0);
  });
});

describe('revealForStressTest', () => {
  it('assembles the lens question + rubric', () => {
    const st: StressTest = { lens: 'board', question: 'Defend this eval to a skeptical board.' };
    const r = revealForStressTest(st, ['S4']);
    expect(r.lens).toBe('board');
    expect(r.scenario).toContain('board');
  });
});

describe('applyStressSelfMark', () => {
  it('writes the lens verdict to ModuleState.stressTest (pure)', () => {
    const s0 = freshState();
    const s1 = applyStressSelfMark(s0, 'board', 'passed');
    expect(s1.stressTest.board).toBe('passed');
    expect(s0.stressTest.board).toBeUndefined(); // input unchanged
  });
  it('maps not_yet correctly', () => {
    const s = applyStressSelfMark(freshState(), 'researcher', 'not_yet');
    expect(s.stressTest.researcher).toBe('not_yet');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mcq/__tests__/self.test.ts`
Expected: FAIL — `Cannot find module '../self'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/mcq/self.ts`:

```ts
import type { Drill, StressTest, ModuleState } from '../types';

export interface DrillReveal {
  scenario: string;
  doubleClicks: string[];        // DC1/DC2 (filtered of undefined)
  rubric: string[];              // short checklist drawn from sources / double-clicks
}
export interface StressReveal {
  lens: StressTest['lens'];
  scenario: string;
  rubric: string[];
}
export type SelfMark = 'passed' | 'not_yet';

/** §5 — reveal the model answer scaffold for an Application drill. NO LLM. */
export function revealForDrill(drill: Drill, sources: string[]): DrillReveal {
  const doubleClicks = [drill.dc1, drill.dc2].filter((d): d is string => !!d);
  return {
    scenario: drill.scenario,
    doubleClicks,
    rubric: [...doubleClicks.map((d) => `Address: ${d}`), ...sources.map((s) => `Ground in: ${s}`)],
  };
}

/** §5 — reveal scaffold for a Stress-test lens. */
export function revealForStressTest(st: StressTest, sources: string[]): StressReveal {
  return {
    lens: st.lens,
    scenario: `[${st.lens}] ${st.question}`,
    rubric: sources.map((s) => `Ground in: ${s}`),
  };
}

/**
 * §5 — learner self-marks a stress-test lens; write to ModuleState.stressTest (pure).
 * NOTE: the self-grade governs the stressTest field only; the hard-MCQ gate (Task 8) governs →verified.
 */
export function applyStressSelfMark(
  state: ModuleState, lens: StressTest['lens'], mark: SelfMark,
): ModuleState {
  return {
    ...state,
    stressTest: { ...state.stressTest, [lens]: mark },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mcq/__tests__/self.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/self.ts src/lib/mcq/__tests__/self.test.ts
git commit -m "feat(self): self-graded-reveal helpers for drills + stress-tests"
```

---

## Task 10: Engine barrel export

**Files:**
- Create: `src/lib/mcq/index.ts`
- Test: `src/lib/mcq/__tests__/index.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/mcq/__tests__/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as mcq from '../index';

describe('mcq barrel', () => {
  it('re-exports the full engine public API', () => {
    for (const name of [
      'FileMCQRepository', 'validatePool',
      'emptyMatrix', 'updateMatrix', 'accuracyByDimension', 'profileFromMatrix', 'statusFor',
      'detectInconsistency',
      'localize', 'routeRemediation',
      'selectAssessment',
      'gradeAnswer', 'feedbackFor',
      'applyDiagnosisToState', 'buildRemediationAssessment', 'clearDiagnosisIfResolved', 'masteryBlockedByWeakDimension',
      'revealForDrill', 'revealForStressTest', 'applyStressSelfMark',
    ]) {
      expect(typeof (mcq as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mcq/__tests__/index.test.ts`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 3: Write the barrel**

`src/lib/mcq/index.ts`:

```ts
export { FileMCQRepository, validatePool } from './repository';
export { emptyMatrix, updateMatrix, accuracyByDimension, profileFromMatrix, statusFor } from './matrix';
export { detectInconsistency } from './inconsistency';
export { localize, routeRemediation } from './localize';
export { selectAssessment } from './select';
export { gradeAnswer, feedbackFor } from './grade';
export type { QuestionFeedback } from './grade';
export {
  applyDiagnosisToState, buildRemediationAssessment, clearDiagnosisIfResolved, masteryBlockedByWeakDimension,
} from './remediation';
export { revealForDrill, revealForStressTest, applyStressSelfMark } from './self';
export type { DrillReveal, StressReveal, SelfMark } from './self';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mcq/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcq/index.ts src/lib/mcq/__tests__/index.test.ts
git commit -m "feat(mcq): barrel export for the engine public API"
```

---

## Task 11: McqFeedback — per-question feedback view (thin UI)

**Files:**
- Create: `components/McqFeedback.tsx`
- Test: `src/lib/mcq/__tests__/McqFeedback.test.tsx`

> **Note:** UI tests use `@testing-library/react` + `jsdom`. If not already configured by plan-01/02, add `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as devDeps and set `environment: 'jsdom'` in `vitest.config.ts` (or add `// @vitest-environment jsdom` at the top of the test file). The component is a pure render of `feedbackFor` output — no state, no fetch.

- [ ] **Step 1: Write the failing test**

`src/lib/mcq/__tests__/McqFeedback.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McqFeedback } from '../../../../components/McqFeedback';
import type { MCQQuestion } from '../../types';

const q: MCQQuestion = {
  id: 'B99-m-ext', moduleId: 'B99', difficulty: 'medium', dimension: 'extension',
  stem: 'A paraphrased prompt fails…',
  options: ['weak generalization', 'contamination', 'a win', 'cheaper'],
  correctIndex: 0,
  distractorMisconception: { '1': 'misattributes transfer failure to contamination', '2': 'calls a failure a win', '3': 'confuses transfer with cost' },
  explanation: 'Paraphrase failure = a transfer gap.',
};

describe('McqFeedback', () => {
  it('shows correct state + explanation when right', () => {
    render(<McqFeedback question={q} chosenIndex={0} />);
    expect(screen.getByText(/correct/i)).toBeTruthy();
    expect(screen.getByText(/transfer gap/i)).toBeTruthy();
  });
  it('shows the correct option AND why the chosen distractor was wrong', () => {
    render(<McqFeedback question={q} chosenIndex={1} />);
    expect(screen.getByText(/incorrect/i)).toBeTruthy();
    expect(screen.getByText(/weak generalization/i)).toBeTruthy(); // the correct option text
    expect(screen.getByText(/misattributes transfer failure/i)).toBeTruthy(); // distractor-why
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mcq/__tests__/McqFeedback.test.tsx`
Expected: FAIL — cannot find `components/McqFeedback`.

- [ ] **Step 3: Write the component**

`components/McqFeedback.tsx`:

```tsx
import * as React from 'react';
import type { MCQQuestion } from '../src/lib/types';
import { feedbackFor } from '../src/lib/mcq';

export function McqFeedback({ question, chosenIndex }: { question: MCQQuestion; chosenIndex: number }) {
  const fb = feedbackFor(question, chosenIndex);
  return (
    <div data-testid="mcq-feedback">
      <p>{fb.correct ? 'Correct' : 'Incorrect'}</p>
      {!fb.correct && (
        <>
          <p>Correct answer: {question.options[fb.correctIndex]}</p>
          {fb.distractorWhy && <p>Why your choice was wrong: {fb.distractorWhy}</p>}
        </>
      )}
      <p>{fb.explanation}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mcq/__tests__/McqFeedback.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/McqFeedback.tsx src/lib/mcq/__tests__/McqFeedback.test.tsx
git commit -m "feat(ui): per-question MCQ feedback view (distractor-aware)"
```

---

## Task 12: DimensionProfileCard (thin UI)

**Files:**
- Create: `components/DimensionProfileCard.tsx`
- Test: `src/lib/mcq/__tests__/DimensionProfileCard.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/lib/mcq/__tests__/DimensionProfileCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DimensionProfileCard } from '../../../../components/DimensionProfileCard';
import type { DimensionProfile } from '../../types';

const profile: DimensionProfile = { topic: 'solid', logic: 'solid', example: 'fuzzy', extension: 'weak' };

describe('DimensionProfileCard', () => {
  it('renders all four dimensions with their status', () => {
    render(<DimensionProfileCard profile={profile} />);
    expect(screen.getByText(/topic/i)).toBeTruthy();
    expect(screen.getByText(/extension/i)).toBeTruthy();
    // "solid: topic, logic · shaky: extension" style summary
    expect(screen.getByTestId('profile-topic').textContent).toMatch(/solid/i);
    expect(screen.getByTestId('profile-extension').textContent).toMatch(/weak/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mcq/__tests__/DimensionProfileCard.test.tsx`
Expected: FAIL — cannot find `components/DimensionProfileCard`.

- [ ] **Step 3: Write the component**

`components/DimensionProfileCard.tsx`:

```tsx
import * as React from 'react';
import type { DimensionProfile, Dimension } from '../src/lib/types';

const DIMENSIONS: Dimension[] = ['topic', 'logic', 'example', 'extension'];

export function DimensionProfileCard({ profile }: { profile: DimensionProfile }) {
  return (
    <div data-testid="dimension-profile-card">
      <h3>Dimension profile</h3>
      <ul>
        {DIMENSIONS.map((dim) => (
          <li key={dim} data-testid={`profile-${dim}`}>
            {dim}: {profile[dim]}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mcq/__tests__/DimensionProfileCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/DimensionProfileCard.tsx src/lib/mcq/__tests__/DimensionProfileCard.test.tsx
git commit -m "feat(ui): dimension-profile card"
```

---

## Task 13: McqRunner — thin runner wired to StateStore via /api/state

**Files:**
- Create: `components/McqRunner.tsx`
- Test: `src/lib/mcq/__tests__/McqRunner.test.tsx`

> **Note:** `McqRunner` orchestrates the pure engine and persists results. It receives the questions (already selected via `selectAssessment` upstream) plus a `persist` callback so the test can inject a fake instead of hitting `/api/state`. In the app, the page passes a `persist` that PUTs to `/api/state`. This keeps the component dumb and testable.

- [ ] **Step 1: Write the failing test**

`src/lib/mcq/__tests__/McqRunner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McqRunner } from '../../../../components/McqRunner';
import type { MCQQuestion, MCQAnswer } from '../../types';

const questions: MCQQuestion[] = [
  { id: 'q1', moduleId: 'B99', difficulty: 'easy', dimension: 'topic', stem: 'Q1?', options: ['a', 'b', 'c', 'd'], correctIndex: 0, distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' }, explanation: 'e1' },
  { id: 'q2', moduleId: 'B99', difficulty: 'medium', dimension: 'logic', stem: 'Q2?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, distractorMisconception: { '0': 'm0', '2': 'm2', '3': 'm3' }, explanation: 'e2' },
];

describe('McqRunner', () => {
  it('walks through questions, shows feedback per answer, and persists all answers on finish', async () => {
    const onFinish = vi.fn<(answers: MCQAnswer[]) => void>();
    render(<McqRunner questions={questions} onFinish={onFinish} />);

    // Q1 — pick the correct option, then see feedback
    expect(screen.getByText('Q1?')).toBeTruthy();
    fireEvent.click(screen.getByText('a'));            // option 0 = correct
    fireEvent.click(screen.getByText(/submit/i));
    expect(screen.getByText(/^Correct$/)).toBeTruthy();
    fireEvent.click(screen.getByText(/next/i));

    // Q2 — pick a wrong option, see distractor feedback
    expect(screen.getByText('Q2?')).toBeTruthy();
    fireEvent.click(screen.getByText('a'));            // option 0 = wrong (correct is 1)
    fireEvent.click(screen.getByText(/submit/i));
    expect(screen.getByText(/Incorrect/)).toBeTruthy();
    fireEvent.click(screen.getByText(/finish/i));

    expect(onFinish).toHaveBeenCalledTimes(1);
    const answers = onFinish.mock.calls[0][0];
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({ questionId: 'q1', chosenIndex: 0, correct: true });
    expect(answers[1]).toMatchObject({ questionId: 'q2', chosenIndex: 0, correct: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mcq/__tests__/McqRunner.test.tsx`
Expected: FAIL — cannot find `components/McqRunner`.

- [ ] **Step 3: Write the component**

`components/McqRunner.tsx`:

```tsx
import * as React from 'react';
import type { MCQQuestion, MCQAnswer } from '../src/lib/types';
import { gradeAnswer } from '../src/lib/mcq';
import { McqFeedback } from './McqFeedback';

export function McqRunner({
  questions,
  onFinish,
  now = () => new Date().toISOString(),
}: {
  questions: MCQQuestion[];
  onFinish: (answers: MCQAnswer[]) => void;
  now?: () => string;
}) {
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<MCQAnswer[]>([]);
  const [chosen, setChosen] = React.useState<number | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const q = questions[index];
  const isLast = index === questions.length - 1;

  const submit = () => {
    if (chosen === null) return;
    setAnswers((prev) => [...prev, gradeAnswer(q, chosen, now())]);
    setSubmitted(true);
  };

  const advance = () => {
    if (isLast) {
      // answers state already includes the last answer (set in submit)
      onFinish(answers);
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setSubmitted(false);
  };

  return (
    <div data-testid="mcq-runner">
      <p>{q.stem}</p>
      {!submitted ? (
        <>
          <ul>
            {q.options.map((opt, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={chosen === i}
                  onClick={() => setChosen(i)}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={submit} disabled={chosen === null}>Submit</button>
        </>
      ) : (
        <>
          <McqFeedback question={q} chosenIndex={chosen as number} />
          <button type="button" onClick={advance}>{isLast ? 'Finish' : 'Next'}</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mcq/__tests__/McqRunner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/McqRunner.tsx src/lib/mcq/__tests__/McqRunner.test.tsx
git commit -m "feat(ui): McqRunner — thin question runner with persist-on-finish"
```

---

## Task 14: SelfRevealPanel — S-SELF UI (scenario → reasoning → reveal → self-mark)

**Files:**
- Create: `components/SelfRevealPanel.tsx`
- Test: `src/lib/mcq/__tests__/SelfRevealPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/lib/mcq/__tests__/SelfRevealPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelfRevealPanel } from '../../../../components/SelfRevealPanel';

describe('SelfRevealPanel', () => {
  it('hides the model answer until reveal, then lets the learner self-mark', () => {
    const onMark = vi.fn<(mark: 'passed' | 'not_yet') => void>();
    render(
      <SelfRevealPanel
        scenario="Defend this eval to a board."
        doubleClicks={['What would a skeptic attack?']}
        rubric={['Ground in: S4']}
        onMark={onMark}
      />,
    );
    // model answer (double-clicks + rubric) hidden pre-reveal
    expect(screen.queryByText(/What would a skeptic attack/)).toBeNull();
    // learner enters reasoning
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my reasoning' } });
    // reveal
    fireEvent.click(screen.getByText(/reveal/i));
    expect(screen.getByText(/What would a skeptic attack/)).toBeTruthy();
    expect(screen.getByText(/Ground in: S4/)).toBeTruthy();
    // self-mark
    fireEvent.click(screen.getByText(/^pass$/i));
    expect(onMark).toHaveBeenCalledWith('passed');
  });

  it('records not_yet', () => {
    const onMark = vi.fn<(mark: 'passed' | 'not_yet') => void>();
    render(<SelfRevealPanel scenario="s" doubleClicks={[]} rubric={[]} onMark={onMark} />);
    fireEvent.click(screen.getByText(/reveal/i));
    fireEvent.click(screen.getByText(/not yet/i));
    expect(onMark).toHaveBeenCalledWith('not_yet');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mcq/__tests__/SelfRevealPanel.test.tsx`
Expected: FAIL — cannot find `components/SelfRevealPanel`.

- [ ] **Step 3: Write the component**

`components/SelfRevealPanel.tsx`:

```tsx
import * as React from 'react';

export function SelfRevealPanel({
  scenario,
  doubleClicks,
  rubric,
  onMark,
}: {
  scenario: string;
  doubleClicks: string[];
  rubric: string[];
  onMark: (mark: 'passed' | 'not_yet') => void;
}) {
  const [reasoning, setReasoning] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);

  return (
    <div data-testid="self-reveal-panel">
      <p>{scenario}</p>
      <textarea
        aria-label="your reasoning"
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
      />
      {!revealed ? (
        <button type="button" onClick={() => setRevealed(true)}>Reveal model answer</button>
      ) : (
        <div data-testid="reveal-body">
          <h4>Double-clicks</h4>
          <ul>{doubleClicks.map((d, i) => <li key={i}>{d}</li>)}</ul>
          <h4>Rubric</h4>
          <ul>{rubric.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <button type="button" onClick={() => onMark('passed')}>Pass</button>
          <button type="button" onClick={() => onMark('not_yet')}>Not yet</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mcq/__tests__/SelfRevealPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/SelfRevealPanel.tsx src/lib/mcq/__tests__/SelfRevealPanel.test.tsx
git commit -m "feat(ui): SelfRevealPanel — self-graded-reveal for drills + stress-tests"
```

---

## Task 15: Full-suite green + lint gate

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the full MCQ test suite**

Run: `npx vitest run src/lib/mcq`
Expected: PASS — all suites green (repository, matrix, select, inconsistency, localize, grade, remediation, self, index, and the 4 UI suites).

- [ ] **Step 2: Type-check the package**

Run: `npx tsc --noEmit`
Expected: no errors (the optional `rng` param matches the appended `src/lib/types.ts` signature; `excludeIds` is read via the local `SelectSpec` extension).

- [ ] **Step 3: Commit any lint/type fixups**

```bash
git add -A
git commit -m "chore(mcq): full S-MCQ + S-SELF suite green, type-clean" || echo "nothing to commit"
```

---

## Self-Review (run after writing; fixes applied inline)

**Spec coverage map (build-spec §3 / §5 / §7):**
- §3.1 four dimensions ↔ content layers → Task 6 `routeRemediation` (topic→tenYearOld, logic→engineer, example→lab, extension→drill) ✓
- §3.2 stratified selection (≥1 easy/med/hard, ≥3 dims, weight by mastery/stale, anti-farm exclude) → Task 4 `selectAssessment` (200-seed guarantee test) ✓
- §3.3 performance model (matrix + distractor log) → Task 3 `updateMatrix`/`accuracyByDimension`; distractor log carried into Task 6 `localize` ✓
- §3.4 inconsistency detector (mixed-within-band OR dimension imbalance; clean frontier does NOT fire) → Task 5 `detectInconsistency` ✓
- §3.5 localizer (worst-accuracy dim wins, tie-break recurring misconception, confidence = accuracy gap, NO LLM) → Task 6 `localize` ✓
- §3.6 remediation router + re-assess (3-Q dimension-targeted mini-assessment; mastery blocked while weak; open/clear diagnosis) → Task 8 ✓
- §3.7 feedback loop (per-question correct + explanation + distractor-why; per-assessment dimension profile card) → Task 7 `feedbackFor`, Task 11 `McqFeedback`, Task 12 `DimensionProfileCard` ✓
- §5 self-graded-reveal for drills + stress-tests (reveal model answer + DC1/DC2 + rubric, self-mark to stressTest) → Task 9 `revealForDrill`/`revealForStressTest`/`applyStressSelfMark`, Task 14 `SelfRevealPanel` ✓
- §7 hard-MCQ gate governs →verified, NOT the self-grade; mastery cannot advance with a weak dimension → Task 8 `masteryBlockedByWeakDimension` + Task 9 note that self-grade only writes `stressTest`; `nextMastery` (plan-01) consumes both ✓
- EXACT user scenario (easy✓ + some-medium✓ + some-medium✗ clustered in one dim → inconsistency → localize that dim → route to layer) → Task 6 dedicated test ✓
- Pure/deterministic engine, thin UI, fixture ≥12 Qs → Tasks 1–10 pure (no I/O except repository fs read); Tasks 11–14 thin UI; Task 1 fixture ✓

**Placeholder scan:** No TBD/TODO/"add validation"/"handle edge cases"; every code step ships complete code; tests are full, not "write tests for the above." ✓

**Type consistency:** `selectAssessment`/`updateMatrix`/`detectInconsistency`/`localize`/`profileFromMatrix` match plan-00 §3 names and arg order; `emptyMatrix`/`accuracyByDimension`/`statusFor` are new local helpers (not shared types). `Diagnosis`, `DimensionProfile`, `PerformanceMatrix`, `ChosenDistractor`, `MCQAnswer`, `ModuleState.mcq.openDiagnosis` all used as defined in plan-00 §3/§5. The only shared-model change is the additive optional `rng` param on `selectAssessment` (noted in Task 4, edit applied to `src/lib/types.ts`). ✓
