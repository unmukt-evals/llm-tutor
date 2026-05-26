# 00 — Shared Data Model (the type contract)

> **Authoritative for all plans.** Every implementation plan (01–05) MUST use the types defined here and MUST NOT redefine shared types locally. If a plan needs a new shared type, add it here first (note it in the plan) rather than inventing a local one. This is what keeps the subsystems consistent.

**Stack:** Next.js (App Router) + TypeScript (strict) · `gray-matter` + `remark`/`unified` (parse) · `react-flow` (map) · `mermaid` + `shiki` (render) · JSON sidecar via Node `fs` (MVP; SQLite is a later swap behind `StateStore`). **No LLM in MVP.** Vitest for unit tests, Playwright optional later.

**Config:** `CURRICULUM_DIR` (env var) → absolute path to the curriculum folder (defaults to the Obsidian `LLM-Curriculum` folder). Markdown there is **read-only** to the app.

---

## 1. Repo layout (conventions all plans follow)

```
~/llm-tutor/
  app/                      # Next.js App Router (routes, server components)
    page.tsx                # the journey map (home)
    module/[id]/page.tsx    # the reader
    api/state/route.ts      # read/write sidecar
  components/               # React components (Map, Reader, DepthToggle, McqRunner, …)
  src/lib/
    types.ts                # ← all interfaces from §2–§6 below
    ingest/                 # S-INGEST: markdown → Curriculum
    state/                  # S-STATE: sidecar read/write, mastery, SR
    mcq/                    # S-MCQ: selection, matrix, localizer, remediation
  src/lib/__tests__/        # Vitest unit tests (co-located mirrors)
  docs/                     # spec, product plan, plans
  curriculum -> $CURRICULUM_DIR  # not in repo; pointed via env
```

Curriculum folder layout the app reads:
```
$CURRICULUM_DIR/
  B01-eval-harnesses.md … B07-interpretability.md   # module notes (read-only)
  M00-…  M12-…                                       # Track A (read-only)
  _sources.md _flashcards.md _curriculum.md          # read-only
  mcq/B01.json … (per-module MCQ pools, §4)           # read-only content
  _llmtutor-state.json                                # ← app + skill SOURCE OF TRUTH (read/write)
```

---

## 2. Curriculum domain types (S-INGEST output)

```ts
export type TrackId = 'A' | 'B' | 'C';
export type DepthPass = 'tenYearOld' | 'engineer' | 'operator';

export interface Drill { scenario: string; dc1?: string; dc2?: string; }           // from "## Application drills"
export interface StressTest { lens: 'board' | 'researcher' | 'analyst'; question: string; }

export interface Module {
  id: string;                       // "B01"  (frontmatter module_id) — stable key everywhere
  track: TrackId;
  name: string;
  prerequisites: string[];          // ["M03","M04"] → soft-lock edges
  primarySources: string[];         // ["S4","S5"] → resolved against _sources.md
  whyThisMatters: string;           // "## Why this matters" (required; absent → flag)
  anchors: string[];                // "## Anchor scenarios"
  passes: Partial<Record<DepthPass, string>>;  // ### 10-year-old / Engineer / Operator (markdown body)
  diagrams: string[];               // fenced mermaid/ascii blocks pulled from the engineer pass
  labSpec?: string;                 // "## Lab spec"
  drills: Drill[];                  // "## Application drills"
  stressTests: StressTest[];        // "## Stress-test pool"
  flashcardSeeds: string[];         // "## Flashcard seeds"
  sources: string[];                // "## Sources" lines
}

export interface Curriculum {
  tracks: TrackId[];
  modules: Module[];                // ordered
  byId(id: string): Module | undefined;
}

export interface CurriculumRepository {                 // S-INGEST public API
  load(dir: string): Promise<Curriculum>;               // parse all *.md in CURRICULUM_DIR
}
```

Parser contract: split each note on the exact headings in build-spec §2.2. `tenYearOld` ← `### 10-year-old pass`, `engineer` ← `### Engineer pass` (DEFAULT), `operator` ← `### Operator pass`. A missing required heading does not throw — it sets the field undefined and the reader surfaces a visible warning.

---

## 3. Assessment / diagnostic types (S-MCQ)

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Dimension  = 'topic' | 'logic' | 'example' | 'extension';   // the 4 diagnostic buckets

export interface MCQQuestion {
  id: string;                       // "B01-q014"
  moduleId: string;
  difficulty: Difficulty;
  dimension: Dimension;
  stem: string;
  options: string[];                // length 4
  correctIndex: number;             // 0..3
  distractorMisconception: Record<string, string>;  // optionIndex → misconception it reveals (required)
  explanation: string;
  sourceRef?: string;               // "S4"
}
export interface MCQPool { moduleId: string; questions: MCQQuestion[]; }

export interface MCQRepository { loadPool(moduleId: string): Promise<MCQPool | null>; }

// selection: stratified, representation-guaranteed (build-spec §3.2)
export interface AssessmentSpec { moduleId: string; count: number; }        // default count 6
export function selectAssessment(pool: MCQPool, state: ModuleState, spec: AssessmentSpec): MCQQuestion[];
//   guarantees ≥1 easy, ≥1 medium, ≥1 hard and ≥3 distinct dimensions; excludes recently-correct (anti-farm)

// answering
export interface MCQAnswer { questionId: string; chosenIndex: number; correct: boolean; at: string; }

// performance model (lives in sidecar, §5)
export type Cell = { seen: number; correct: number };
export type PerformanceMatrix = Record<Difficulty, Partial<Record<Dimension, Cell>>>;

// the diagnosis (hardwired classifier output — NO LLM)
export type DimensionStatus = 'solid' | 'fuzzy' | 'weak' | 'untested';
export type DimensionProfile = Record<Dimension, DimensionStatus>;
export interface Diagnosis {
  dimension: Dimension;             // the localized failing bucket
  confidence: number;              // = accuracy gap (0..1), NOT a model score
  evidence: { qids: string[]; recurringMisconceptions: string[] };
  remediation: DepthPass | 'lab' | 'drill';   // routing target (build-spec §3.1)
}

// the engine (all pure functions over matrix + answers — deterministic, testable)
export function updateMatrix(m: PerformanceMatrix, a: MCQAnswer, q: MCQQuestion): PerformanceMatrix;
export function detectInconsistency(m: PerformanceMatrix): boolean;          // build-spec §3.4
export function localize(m: PerformanceMatrix, log: ChosenDistractor[], pool: MCQPool): Diagnosis; // §3.5
export function profileFromMatrix(m: PerformanceMatrix): DimensionProfile;
export type ChosenDistractor = { qid: string; chose: number; at: string };
```

Remediation routing (build-spec §3.1): `topic→tenYearOld`, `logic→engineer`, `example→lab`, `extension→drill`.

---

## 4. MCQ pool file format (`mcq/<moduleId>.json`)
Matches `MCQPool` / `MCQQuestion` exactly. Authored by hand (or LLM-assisted in v1) and human-curated. Pool ≥12 per module (4 dims × 3 difficulties), target ≥24. `distractorMisconception` keys are the wrong-option indices.

---

## 5. Sidecar state (S-STATE — SINGLE SOURCE OF TRUTH)
File: `$CURRICULUM_DIR/_llmtutor-state.json`. Both the app and the `llm-deep-dive` skill read/write ONLY this for mastery/SR/XP.

```ts
export type Mastery = 'blank' | 'fuzzy' | 'solid' | 'verified';

export interface ModuleState {
  mastery: Mastery;
  masteryHistory: { level: Mastery; at: string; via: string }[];
  mcq: {
    matrix: PerformanceMatrix;
    distractorLog: ChosenDistractor[];
    dimensionProfile: DimensionProfile;
    openDiagnosis?: Diagnosis & { openedAt: string };
  };
  stressTest: Partial<Record<'board' | 'researcher' | 'analyst', 'passed' | 'not_yet' | 'untested'>>;
}
export interface FlashcardState { lastTested: string; intervalDays: 7 | 14 | 30; ease: 'again' | 'good' }
export interface TutorState {
  version: 1;
  modules: Record<string, ModuleState>;           // keyed by Module.id
  flashcards: Record<string, FlashcardState>;      // keyed by card id from _flashcards.md
  xp: { total: number; thisWeek: number };
  streak: { count: number; lastActive: string; freezeTokens: number };
  sessionLog: { module: string; at: string; events: string[] }[];
}

export interface StateStore {                      // S-STATE public API (swap JSON↔SQLite behind this)
  read(): Promise<TutorState>;                     // creates default if missing
  write(s: TutorState): Promise<void>;             // atomic write (temp + rename)
  getModule(id: string): Promise<ModuleState>;     // default if absent
}
```

### Mastery transition rules (pure functions; build-spec §7)
```ts
// blank→fuzzy: ≥1 easy AND ≥1 medium correct, and no open diagnosis
// fuzzy→solid: all 3 passes read + a drill self-marked adequate + DimensionProfile has no 'weak'
// solid→verified: hard-difficulty MCQs correct in ALL 4 dimensions + 3-lens stress test self-marked passed
// decay (dimension-scoped): missed SR card OR re-opened diagnosis → affected dimension drops; recompute mastery
export function nextMastery(prev: Mastery, m: ModuleState, readPasses: DepthPass[]): Mastery;
```

### Spaced repetition (MVP rule)
Card resurfaces when `now - lastTested ≥ intervalDays`. Correct recall on a due card advances interval 7→14→30 (caps at 30) and holds mastery; a miss resets interval to 7 and applies dimension-scoped decay.

---

## 6. XP / streak (the thin visible skin — never gates content)
Reading a pass +5 (capped per module); all 3 passes +15; MCQ assessment with a graded-adequate result +25; each stress-test lens passed +40; SR-due card recalled +10 (not-due card +0); promotion to `verified` +200. Streak extends on a day with ≥1 *graded* activity (MCQ / stress-test / SR review), not pure reading; 1 freeze token/week.

---

## 7. Plan reconciliations (AUTHORITATIVE — added after the 2026-05-27 plan review)

These resolve seams the four plans flagged. They override any earlier under-specification above. All plans use these.

**Factory exports (concrete, not just interfaces):**
- `getCurriculumRepository(): CurriculumRepository` exported from `src/lib/ingest/index.ts`.
- `getStateStore(curriculumDir: string): StateStore` exported from `src/lib/state/index.ts` (the dir tells it where `_llmtutor-state.json` lives).
- `getMcqRepository(curriculumDir: string): MCQRepository` exported from `src/lib/mcq/index.ts`.

**`Module.diagrams`:** stores the **inner** block text only — triple-backtick fences and the language tag are stripped by the parser. `DiagramPane` decides mermaid-vs-code by a parsed `kind` it infers, so store `{ kind: 'mermaid' | 'ascii' | 'code'; body: string }[]` instead of `string[]`. Update §2 `Module.diagrams` to `Diagram[]` with `interface Diagram { kind: 'mermaid'|'ascii'|'code'; body: string }`.

**`selectAssessment` final signature** (replaces §3): `selectAssessment(pool: MCQPool, state: ModuleState, spec: AssessmentSpec, rng?: () => number): MCQQuestion[]` — `rng` defaults to `Math.random` and exists so tests are deterministic. `AssessmentSpec` gains `excludeIds?: string[]` (recently-correct, anti-farm).

**Anti-farm source:** `ModuleState.mcq` gains `recentCorrect: { qid: string; at: string }[]` (append on a correct answer; the caller passes their qids as `excludeIds`; prune entries older than N=3 sessions). Without it, anti-farm is a no-op.

**SR helper signatures** (in `src/lib/state/sr.ts`): `isCardDue(card: FlashcardState, now: Date): boolean` and `nextSrInterval(card: FlashcardState, recall: 'again' | 'good'): FlashcardState`.

**`nextMastery` final signature** (replaces §5): `nextMastery(prev: Mastery, m: ModuleState, readPasses: DepthPass[], drillAdequate: boolean): Mastery`. `verified` requires `m.mcq.matrix.hard[dim]?.correct >= 1` for **every** `dim` AND all three `stressTest` lenses `=== 'passed'`; `solid` requires no `'weak'` in `dimensionProfile` and `drillAdequate`; any `openDiagnosis` blocks advancement past `fuzzy`.

**`/api/state` HTTP contract** (how client components reach the StateStore):
- `GET /api/state` → `TutorState`.
- `PATCH /api/state` body `{ path: string[]; value: unknown }` → deep-sets that key path, server does the atomic write, returns the updated `TutorState`.

**Sidecar key ownership (one file, two writers — app + `llm-deep-dive` skill):**
- **Skill writes:** `modules[id].mastery`, `.masteryHistory`, `.stressTest`, and `sessionLog`.
- **App owns:** `modules[id].mcq`, `flashcards`, `xp`, `streak`.
- Both do **read-modify-write**, preserve unknown keys, and write atomically (temp + rename). The app is the schema owner.
