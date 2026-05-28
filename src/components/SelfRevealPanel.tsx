// src/components/SelfRevealPanel.tsx
// S-SELF self-graded-reveal panel (plan-03 Task 14).
//
// A dumb React shell over the tested pure helpers in @/lib/mcq/self:
//   - revealForDrill / revealForStressTest → build the model-answer scaffold
//     (scenario + double-clicks + rubric) from the drill/stress-test + sources
//   - applyStressSelfMark + stressTestPatch → fold a stress-test verdict into
//     ModuleState and shape the /api/state PATCH
//   - patchState (api-client)              → persist the stressTest slice
//
// Honesty gate: the learner types their reasoning BEFORE the model answer is
// revealed. The reveal body (double-clicks + rubric) stays hidden until the
// learner clicks "Reveal model answer". Self-marks are made against the shown
// rubric — the panel never auto-passes.
//
// Two modes:
//   - mode 'stressTest' → "Passed" / "Not yet" persist to
//     modules/<moduleId>/stressTest via applyStressSelfMark + stressTestPatch.
//   - mode 'drill'      → a lighter "Got it" / "Revisit" acknowledgement that
//     does NOT persist (drills don't write to stressTest; see plan §5 / §7).
'use client';

import { useState, useMemo } from 'react';
import type { Drill, StressTest, ModuleState } from '@/lib/types';
import {
  revealForDrill,
  revealForStressTest,
  applyStressSelfMark,
  stressTestPatch,
  type SelfMark,
} from '@/lib/mcq/self';
import { patchState } from '@/lib/api-client';
import { announceState } from '@/lib/ui/juice-events';

type DrillProps = {
  mode: 'drill';
  drill: Drill;
  /** Source atom IDs the learner should ground their answer in (rubric input). */
  sources?: string[];
  /** Optional acknowledgement callback ("got it" = true, "revisit" = false). */
  onAcknowledge?: (gotIt: boolean) => void;
};

type StressTestProps = {
  mode: 'stressTest';
  stressTest: StressTest;
  moduleId: string;
  /** Current persisted module state — seeds the stressTest slice. */
  state: ModuleState;
  sources?: string[];
  /** Notified after a self-mark folds into state (before/independent of persist). */
  onMark?: (mark: SelfMark, nextState: ModuleState) => void;
};

type SelfRevealPanelProps = DrillProps | StressTestProps;

export function SelfRevealPanel(props: SelfRevealPanelProps) {
  const [reasoning, setReasoning] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [marked, setMarked] = useState<SelfMark | boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = props.sources ?? [];
  // Normalise both reveal shapes to { scenario, doubleClicks, rubric }.
  // StressReveal has no double-clicks → empty list.
  const reveal = useMemo(() => {
    if (props.mode === 'drill') {
      const r = revealForDrill(props.drill, sources);
      return { scenario: r.scenario, doubleClicks: r.doubleClicks, rubric: r.rubric };
    } else {
      const r = revealForStressTest(props.stressTest, sources);
      return { scenario: r.scenario, doubleClicks: [] as string[], rubric: r.rubric };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, props.mode === 'drill' ? props.drill : props.stressTest, sources.join('\0')]);

  async function markStressTest(mark: SelfMark) {
    if (props.mode !== 'stressTest') return;
    if (marked !== null || saving) return;
    const next = applyStressSelfMark(props.state, props.stressTest.lens, mark);
    setMarked(mark);
    props.onMark?.(mark, next);
    setSaving(true);
    setError(null);
    try {
      const patch = stressTestPatch(props.moduleId, next);
      const persisted = await patchState(patch.path, patch.value);
      // Fire the juice layer off the persisted state (pure detectors gate it).
      announceState(persisted);
    } catch (e) {
      // Stay usable — the verdict is recorded locally; only the save failed.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function acknowledgeDrill(gotIt: boolean) {
    if (props.mode !== 'drill') return;
    setMarked(gotIt);
    props.onAcknowledge?.(gotIt);
  }

  return (
    <div
      data-testid="self-reveal-panel"
      className="max-w-xl mx-auto py-8 space-y-6"
    >
      <p className="text-lg text-slate-800">{reveal.scenario}</p>

      {/* Honesty gate: reasoning entered BEFORE the model answer is revealed. */}
      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-600">Your reasoning</span>
        <textarea
          aria-label="your reasoning"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          rows={6}
          placeholder="Work through it here before you reveal the model answer…"
          className="w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-800 focus:border-slate-800 focus:outline-none"
        />
      </label>

      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="w-full py-3 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors"
        >
          Reveal model answer
        </button>
      ) : (
        <div data-testid="reveal-body" className="space-y-5">
          {reveal.doubleClicks.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Double-clicks
              </h4>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                {reveal.doubleClicks.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Rubric — mark yourself against this
            </h4>
            {reveal.rubric.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                {reveal.rubric.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">
                No rubric items — judge against the scenario and double-clicks above.
              </p>
            )}
          </section>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              Couldn&apos;t save your verdict: {error}
            </p>
          )}
          {saving && <p className="text-sm text-slate-400">Saving…</p>}

          {props.mode === 'stressTest' ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => markStressTest('passed')}
                disabled={saving || marked !== null}
                aria-pressed={marked === 'passed'}
                className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                  marked === 'passed'
                    ? 'bg-green-600 text-white'
                    : 'border border-green-600 text-green-700 hover:bg-green-50'
                }`}
              >
                Pass
              </button>
              <button
                type="button"
                onClick={() => markStressTest('not_yet')}
                disabled={saving || marked !== null}
                aria-pressed={marked === 'not_yet'}
                className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                  marked === 'not_yet'
                    ? 'bg-amber-600 text-white'
                    : 'border border-amber-600 text-amber-700 hover:bg-amber-50'
                }`}
              >
                Not yet
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => acknowledgeDrill(true)}
                aria-pressed={marked === true}
                className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                  marked === true
                    ? 'bg-green-600 text-white'
                    : 'border border-green-600 text-green-700 hover:bg-green-50'
                }`}
              >
                Got it
              </button>
              <button
                type="button"
                onClick={() => acknowledgeDrill(false)}
                aria-pressed={marked === false}
                className={`flex-1 py-3 rounded-lg font-medium transition-colors ${
                  marked === false
                    ? 'bg-amber-600 text-white'
                    : 'border border-amber-600 text-amber-700 hover:bg-amber-50'
                }`}
              >
                Revisit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
