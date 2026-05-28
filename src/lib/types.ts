// All shared types for the LLM Tutor. Derived from docs/plans/00-shared-model.md §2–§6,
// reconciled with the AUTHORITATIVE §7 "Plan reconciliations" (2026-05-27 review).
//
// DO NOT redefine these locally in other modules. If a new shared type is needed,
// add it to 00-shared-model.md first, then here.
//
// §7 reconciliations applied (these override the literal §2–§6 text above them):
//   - Module.diagrams is Diagram[] (kind + body), NOT string[].
//   - selectAssessment gains an rng param; AssessmentSpec gains excludeIds.
//   - ModuleState.mcq gains recentCorrect (anti-farm source).
//   - SR helpers isCardDue / nextSrInterval are exported here.
//   - nextMastery gains the drillAdequate boolean.

// ── §2 Curriculum domain types (S-INGEST output) ─────────────────────────────
export type TrackId = 'A' | 'B' | 'C';
export type DepthPass = 'tenYearOld' | 'engineer' | 'operator';

export interface Drill {
  scenario: string;
  dc1?: string;
  dc2?: string;
}
export interface StressTest {
  lens: 'board' | 'researcher' | 'analyst';
  question: string;
}

// §7: Module.diagrams stores the INNER block text only (fences + language tag
// stripped by the parser). DiagramPane infers mermaid-vs-code from `kind`.
export interface Diagram {
  kind: 'mermaid' | 'ascii' | 'code';
  body: string;
}

// ── Visualizations (V-VIZ) ───────────────────────────────────────────────────
// A module may declare REAL visualizations in a "## Visuals" section composed of
// one or more fenced ```viz blocks, each carrying a JSON `Viz`. Coords/values are
// PRECOMPUTED in the markdown — no runtime model. parse-visuals.ts validates the
// per-type `data` shape; components consume the validated payloads below.
export type VizType =
  | 'embedding-scatter'
  | 'vector-table'
  | 'attention-heatmap'
  | 'bar-compare';

export interface Viz {
  type: VizType;
  title?: string;
  data: unknown; // type-specific; validated per-type at parse time
}

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  cluster: string;
}
export interface EmbeddingScatterData {
  points: ScatterPoint[];
  links?: { from: number; to: number }[];
}

export interface VectorTableData {
  dims: string[];
  rows: { token: string; values: number[] }[];
}

export interface AttentionHeatmapData {
  rowLabels: string[];
  colLabels: string[];
  matrix: number[][];
}

export interface BarCompareData {
  bars: { label: string; value: number }[];
  unit?: string;
}

export interface Module {
  id: string; // "B01" (frontmatter module_id) — stable key everywhere
  track: TrackId;
  name: string;
  prerequisites: string[]; // ["M03","M04"] → soft-lock edges
  primarySources: string[]; // ["S4","S5"] → resolved against _sources.md
  whyThisMatters: string; // "## Why this matters" (required; absent → flag)
  anchors: string[]; // "## Anchor scenarios"
  passes: Partial<Record<DepthPass, string>>; // ### 10-year-old / Engineer / Operator
  diagrams: Diagram[]; // §7: fenced mermaid/ascii/code blocks from the engineer pass
  visuals: Viz[]; // V-VIZ: parsed from the "## Visuals" section (```viz JSON blocks)
  labSpec?: string; // "## Lab spec"
  drills: Drill[]; // "## Application drills"
  stressTests: StressTest[]; // "## Stress-test pool"
  flashcardSeeds: string[]; // "## Flashcard seeds"
  sources: string[]; // "## Sources" lines
}

export interface Curriculum {
  tracks: TrackId[];
  modules: Module[]; // ordered
  byId(id: string): Module | undefined;
}

export interface CurriculumRepository {
  load(dir: string): Promise<Curriculum>; // parse all *.md in CURRICULUM_DIR
}

// ── §3 Assessment / diagnostic types (S-MCQ) ─────────────────────────────────
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Dimension = 'topic' | 'logic' | 'example' | 'extension';

export interface MCQQuestion {
  id: string; // "B01-q014"
  moduleId: string;
  difficulty: Difficulty;
  dimension: Dimension;
  stem: string;
  options: string[]; // length 4
  correctIndex: number; // 0..3
  distractorMisconception: Record<string, string>; // optionIndex → misconception (required)
  explanation: string;
  sourceRef?: string; // "S4"
}
export interface MCQPool {
  moduleId: string;
  questions: MCQQuestion[];
}

export interface MCQRepository {
  loadPool(moduleId: string): Promise<MCQPool | null>;
}

// §7: AssessmentSpec gains excludeIds (recently-correct, anti-farm).
export interface AssessmentSpec {
  moduleId: string;
  count: number; // default 6
  excludeIds?: string[]; // §7: recently-correct qids to exclude (anti-farm)
}

// §7 final signature (replaces §3): rng defaults to Math.random so tests are deterministic.
// selection: stratified, representation-guaranteed (build-spec §3.2) — guarantees ≥1 easy,
// ≥1 medium, ≥1 hard and ≥3 distinct dimensions; excludes recently-correct (anti-farm).
export type SelectAssessment = (
  pool: MCQPool,
  state: ModuleState,
  spec: AssessmentSpec,
  rng?: () => number,
) => MCQQuestion[];

export interface MCQAnswer {
  questionId: string;
  chosenIndex: number;
  correct: boolean;
  at: string;
}

export type Cell = { seen: number; correct: number };
export type PerformanceMatrix = Record<Difficulty, Partial<Record<Dimension, Cell>>>;

export type DimensionStatus = 'solid' | 'fuzzy' | 'weak' | 'untested';
export type DimensionProfile = Record<Dimension, DimensionStatus>;
export type ChosenDistractor = { qid: string; chose: number; at: string };

export interface Diagnosis {
  dimension: Dimension; // the localized failing bucket
  confidence: number; // = accuracy gap (0..1), NOT a model score
  evidence: { qids: string[]; recurringMisconceptions: string[] };
  remediation: DepthPass | 'lab' | 'drill'; // routing target (build-spec §3.1)
}

// the engine (all pure functions over matrix + answers — deterministic, testable)
export type UpdateMatrix = (
  m: PerformanceMatrix,
  a: MCQAnswer,
  q: MCQQuestion,
) => PerformanceMatrix;
export type DetectInconsistency = (m: PerformanceMatrix) => boolean; // build-spec §3.4
export type Localize = (
  m: PerformanceMatrix,
  log: ChosenDistractor[],
  pool: MCQPool,
) => Diagnosis; // §3.5
export type ProfileFromMatrix = (m: PerformanceMatrix) => DimensionProfile;

// ── §5 Sidecar state (S-STATE — SINGLE SOURCE OF TRUTH) ──────────────────────
export type Mastery = 'blank' | 'fuzzy' | 'solid' | 'verified';

export interface ModuleState {
  mastery: Mastery;
  masteryHistory: { level: Mastery; at: string; via: string }[];
  mcq: {
    matrix: PerformanceMatrix;
    distractorLog: ChosenDistractor[];
    dimensionProfile: DimensionProfile;
    recentCorrect: { qid: string; at: string }[]; // §7: anti-farm source (prune > N=3 sessions)
    openDiagnosis?: Diagnosis & { openedAt: string };
  };
  stressTest: Partial<Record<StressTest['lens'], 'passed' | 'not_yet' | 'untested'>>;
}

export interface FlashcardState {
  lastTested: string;
  intervalDays: 7 | 14 | 30;
  ease: 'again' | 'good';
}

export interface TutorState {
  version: 1;
  modules: Record<string, ModuleState>; // keyed by Module.id
  flashcards: Record<string, FlashcardState>; // keyed by card id from _flashcards.md
  xp: { total: number; thisWeek: number };
  streak: { count: number; lastActive: string; freezeTokens: number };
  sessionLog: { module: string; at: string; events: string[] }[];
}

export interface StateStore {
  read(): Promise<TutorState>; // creates default if missing
  write(s: TutorState): Promise<void>; // atomic write (temp + rename)
  getModule(id: string): Promise<ModuleState>; // default if absent
}

// ── Mastery transition rule (pure function; build-spec §7) ───────────────────
// §7 final signature (replaces §5): gains the drillAdequate boolean.
//   blank→fuzzy: ≥1 easy AND ≥1 medium correct, and no open diagnosis
//   fuzzy→solid: all 3 passes read + drillAdequate + DimensionProfile has no 'weak'
//   solid→verified: m.mcq.matrix.hard[dim]?.correct >= 1 for EVERY dim
//                   AND all three stressTest lenses === 'passed'
//   any openDiagnosis blocks advancement past 'fuzzy'.
export type NextMastery = (
  prev: Mastery,
  m: ModuleState,
  readPasses: DepthPass[],
  drillAdequate: boolean,
) => Mastery;

// ── Spaced repetition helpers (pure functions; §7 — src/lib/state/sr.ts) ─────
// Card resurfaces when now - lastTested ≥ intervalDays. Correct recall advances
// interval 7→14→30 (caps at 30) and holds mastery; a miss resets to 7.
export type IsCardDue = (card: FlashcardState, now: Date) => boolean;
export type NextSrInterval = (
  card: FlashcardState,
  recall: 'again' | 'good',
) => FlashcardState;
