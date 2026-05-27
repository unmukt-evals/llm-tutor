import type { Drill, StressTest, ModuleState } from '../types';

export interface DrillReveal {
  scenario: string;
  doubleClicks: string[]; // DC1/DC2 (filtered of undefined)
  rubric: string[]; // short checklist drawn from sources / double-clicks
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
    rubric: [
      ...doubleClicks.map((d) => `Address: ${d}`),
      ...sources.map((s) => `Ground in: ${s}`),
    ],
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
  state: ModuleState,
  lens: StressTest['lens'],
  mark: SelfMark,
): ModuleState {
  return {
    ...state,
    stressTest: { ...state.stressTest, [lens]: mark },
  };
}
