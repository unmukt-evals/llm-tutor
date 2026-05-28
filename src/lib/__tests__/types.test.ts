import { describe, it, expect } from 'vitest';
import type {
  TrackId,
  DepthPass,
  Drill,
  StressTest,
  Diagram,
  Viz,
  Module,
  Curriculum,
  CurriculumRepository,
  Difficulty,
  Dimension,
  MCQQuestion,
  MCQPool,
  MCQRepository,
  AssessmentSpec,
  MCQAnswer,
  Cell,
  PerformanceMatrix,
  DimensionStatus,
  DimensionProfile,
  Diagnosis,
  ChosenDistractor,
  Mastery,
  ModuleState,
  FlashcardState,
  TutorState,
  StateStore,
  SelectAssessment,
  UpdateMatrix,
  DetectInconsistency,
  Localize,
  ProfileFromMatrix,
  NextMastery,
  IsCardDue,
  NextSrInterval,
} from '@/lib/types';

describe('shared types', () => {
  it('Module has the contract shape with diagrams as Diagram[] (§7)', () => {
    const diagram: Diagram = { kind: 'mermaid', body: 'graph TD; A-->B' };
    const m: Module = {
      id: 'B01',
      track: 'B',
      name: 'Eval harnesses',
      prerequisites: ['M03'],
      primarySources: ['S4'],
      whyThisMatters: 'because',
      anchors: ['a scenario'],
      passes: { engineer: 'body' },
      diagrams: [diagram],
      visuals: [],
      drills: [{ scenario: 's' }],
      stressTests: [{ lens: 'board', question: 'q' }],
      flashcardSeeds: ['seed'],
      sources: ['S4 — title'],
    };
    expect(m.id).toBe('B01');
    expect(m.passes.engineer).toBe('body');
    // §7: diagrams are Diagram objects with a kind + body, NOT plain strings
    expect(m.diagrams[0].kind).toBe('mermaid');
    expect(m.diagrams[0].body).toBe('graph TD; A-->B');
  });

  it('Diagram kind admits mermaid | ascii | code (§7)', () => {
    const kinds: Diagram['kind'][] = ['mermaid', 'ascii', 'code'];
    expect(kinds).toHaveLength(3);
  });

  it('TutorState nests ModuleState with the mcq matrix + recentCorrect (§7)', () => {
    const cell: Cell = { seen: 1, correct: 1 };
    const matrix: PerformanceMatrix = {
      easy: {},
      medium: { logic: cell },
      hard: {},
    };
    const profile: DimensionProfile = {
      topic: 'untested',
      logic: 'solid',
      example: 'untested',
      extension: 'untested',
    };
    const ms: ModuleState = {
      mastery: 'fuzzy',
      masteryHistory: [{ level: 'fuzzy', at: 'now', via: 'mcq' }],
      mcq: {
        matrix,
        distractorLog: [{ qid: 'B01-q1', chose: 2, at: 'now' }],
        dimensionProfile: profile,
        recentCorrect: [{ qid: 'B01-q1', at: 'now' }],
      },
      stressTest: { board: 'untested' },
    };
    const state: TutorState = {
      version: 1,
      modules: { B01: ms },
      flashcards: { 'B01-c01': { lastTested: 'now', intervalDays: 7, ease: 'good' } },
      xp: { total: 0, thisWeek: 0 },
      streak: { count: 0, lastActive: 'now', freezeTokens: 1 },
      sessionLog: [],
    };
    expect(state.modules.B01.mcq.matrix.medium.logic?.correct).toBe(1);
    // §7: anti-farm source lives on mcq.recentCorrect
    expect(state.modules.B01.mcq.recentCorrect[0].qid).toBe('B01-q1');
  });

  it('AssessmentSpec carries optional excludeIds (§7 anti-farm)', () => {
    const spec: AssessmentSpec = { moduleId: 'B01', count: 6, excludeIds: ['B01-q1'] };
    const specNoExclude: AssessmentSpec = { moduleId: 'B01', count: 6 };
    expect(spec.excludeIds).toEqual(['B01-q1']);
    expect(specNoExclude.excludeIds).toBeUndefined();
  });

  it('engine + transition function signatures are exported with §7 shapes', () => {
    // These are ambient function SIGNATURES (declared in the shared contract,
    // implemented in later plans) — they carry no runtime value, so they are
    // imported with `import type` and asserted at the type level only. The
    // `Expect<Equal<...>>` helpers below fail `tsc --noEmit` if a signature
    // drifts from the §7 final shapes; the runtime body just proves the test ran.
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
      ? true
      : false;
    type Expect<T extends true> = T;

    type _SelectOK = Expect<
      Equal<
        SelectAssessment,
        (
          pool: MCQPool,
          state: ModuleState,
          spec: AssessmentSpec,
          rng?: () => number,
        ) => MCQQuestion[]
      >
    >;
    type _UpdateOK = Expect<
      Equal<UpdateMatrix, (m: PerformanceMatrix, a: MCQAnswer, q: MCQQuestion) => PerformanceMatrix>
    >;
    type _DetectOK = Expect<Equal<DetectInconsistency, (m: PerformanceMatrix) => boolean>>;
    type _LocalizeOK = Expect<
      Equal<Localize, (m: PerformanceMatrix, log: ChosenDistractor[], pool: MCQPool) => Diagnosis>
    >;
    type _ProfileOK = Expect<
      Equal<ProfileFromMatrix, (m: PerformanceMatrix) => DimensionProfile>
    >;
    // §7 final signature: gains the drillAdequate boolean
    type _NextOK = Expect<
      Equal<
        NextMastery,
        (prev: Mastery, m: ModuleState, readPasses: DepthPass[], drillAdequate: boolean) => Mastery
      >
    >;
    type _DueOK = Expect<Equal<IsCardDue, (card: FlashcardState, now: Date) => boolean>>;
    type _SrOK = Expect<
      Equal<NextSrInterval, (card: FlashcardState, recall: 'again' | 'good') => FlashcardState>
    >;

    // Force the type aliases to be "used" so tsc keeps them in scope.
    const proof: [
      _SelectOK,
      _UpdateOK,
      _DetectOK,
      _LocalizeOK,
      _ProfileOK,
      _NextOK,
      _DueOK,
      _SrOK,
    ] = [true, true, true, true, true, true, true, true];
    expect(proof.every((p) => p === true)).toBe(true);
  });

  it('repository + store interfaces are usable as the declared shapes', () => {
    const repo: CurriculumRepository = {
      async load(_dir: string): Promise<Curriculum> {
        return { tracks: [], modules: [], byId: () => undefined };
      },
    };
    const mcqRepo: MCQRepository = {
      async loadPool(_moduleId: string): Promise<MCQPool | null> {
        return null;
      },
    };
    const store: StateStore = {
      async read(): Promise<TutorState> {
        return {
          version: 1,
          modules: {},
          flashcards: {},
          xp: { total: 0, thisWeek: 0 },
          streak: { count: 0, lastActive: '', freezeTokens: 1 },
          sessionLog: [],
        };
      },
      async write(_s: TutorState): Promise<void> {},
      async getModule(_id: string): Promise<ModuleState> {
        return {
          mastery: 'blank',
          masteryHistory: [],
          mcq: {
            matrix: { easy: {}, medium: {}, hard: {} },
            distractorLog: [],
            dimensionProfile: {
              topic: 'untested',
              logic: 'untested',
              example: 'untested',
              extension: 'untested',
            },
            recentCorrect: [],
          },
          stressTest: {},
        };
      },
    };
    expect(typeof repo.load).toBe('function');
    expect(typeof mcqRepo.loadPool).toBe('function');
    expect(typeof store.read).toBe('function');
  });

  it('scalar union types resolve to their documented members', () => {
    const track: TrackId = 'A';
    const pass: DepthPass = 'engineer';
    const diff: Difficulty = 'hard';
    const dim: Dimension = 'logic';
    const status: DimensionStatus = 'solid';
    const mastery: Mastery = 'verified';
    const drill: Drill = { scenario: 's', dc1: 'a', dc2: 'b' };
    const st: StressTest = { lens: 'analyst', question: 'q' };
    expect([track, pass, diff, dim, status, mastery]).toEqual([
      'A',
      'engineer',
      'hard',
      'logic',
      'solid',
      'verified',
    ]);
    expect(drill.scenario).toBe('s');
    expect(st.lens).toBe('analyst');
  });
});

describe('Viz + Module.visuals types', () => {
  it('constructs a Module with a typed visuals array', () => {
    const viz: Viz = {
      type: 'embedding-scatter',
      title: 'demo',
      data: { points: [{ label: 'a', x: 0, y: 0, cluster: 'c' }] },
    };
    const mod: Pick<Module, 'visuals'> = { visuals: [viz] };
    expect(mod.visuals[0].type).toBe('embedding-scatter');
  });
});
