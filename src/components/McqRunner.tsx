// src/components/McqRunner.tsx
// Thin MCQ assessment runner (plan-03 Task 13).
//
// A dumb React shell over the tested pure engine. It owns NO diagnostic logic:
//   - selectAssessment (select.ts)  → the stratified question set
//   - gradeAnswer / feedbackFor      → per-question scoring + feedback view
//   - foldAnswer (runner.ts)         → folds each graded answer into the mcq slice
//   - finalizeAssessment (runner.ts) → end-of-set inconsistency → localize → diagnosis
//   - mcqPatch + patchState          → persist the updated mcq slice to /api/state
//   - DimensionProfileCard           → end-of-set per-dimension profile
// Flow: select → answer → feedback → fold → (advance) → end-of-set diagnose → persist.
'use client';

import { useMemo, useState } from 'react';
import type { MCQPool, MCQQuestion, ModuleState } from '@/lib/types';
import {
  selectAssessment,
  gradeAnswer,
  foldAnswer,
  finalizeAssessment,
  mcqPatch,
  routeRemediation,
  type McqState,
} from '@/lib/mcq';
import { patchState } from '@/lib/api-client';
import { McqFeedback } from '@/components/McqFeedback';
import { DimensionProfileCard } from '@/components/DimensionProfileCard';

interface McqRunnerProps {
  moduleId: string;
  pool: MCQPool;
  /** Current persisted module state — seeds the matrix / anti-farm / profile. */
  state: ModuleState;
  /** Questions per assessment. Defaults to the build-spec count of 6. */
  count?: number;
  /** Injectable clock — keeps the component deterministic in tests. */
  now?: () => string;
}

type Phase = 'answering' | 'feedback' | 'done';

export function McqRunner({
  moduleId,
  pool,
  state,
  count = 6,
  now = () => new Date().toISOString(),
}: McqRunnerProps) {
  // Select once on mount — re-selecting on every render would reshuffle.
  const questions = useMemo<MCQQuestion[]>(
    () => selectAssessment(pool, state, { moduleId, count }),
    [pool, state, moduleId, count],
  );

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('answering');
  const [mcq, setMcq] = useState<McqState>(state.mcq);
  const [finalMcq, setFinalMcq] = useState<McqState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = questions[index];
  const isLast = index === questions.length - 1;

  // No pool questions matched the spec — surface, don't crash.
  if (!q && phase !== 'done') {
    return (
      <div data-testid="mcq-runner" className="text-sm text-slate-500 py-8 text-center">
        No assessment questions available for this module yet.
      </div>
    );
  }

  function submit() {
    if (chosen === null) return;
    const answer = gradeAnswer(q, chosen, now());
    setMcq((prev) => foldAnswer(prev, q, answer));
    setPhase('feedback');
  }

  async function advance() {
    if (!isLast) {
      setIndex((i) => i + 1);
      setChosen(null);
      setPhase('answering');
      return;
    }
    // End of set: resolve diagnosis from the accumulated matrix, then persist.
    const resolved = finalizeAssessment(mcq, pool, now());
    setFinalMcq(resolved);
    setPhase('done');
    setSaving(true);
    setError(null);
    try {
      const patch = mcqPatch(moduleId, resolved);
      await patchState(patch.path, patch.value);
    } catch (e) {
      // Stay usable — the results are still shown; only the save failed.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'done' && finalMcq) {
    const diag = finalMcq.openDiagnosis;
    return (
      <div data-testid="mcq-runner" className="max-w-xl mx-auto py-8 space-y-6">
        <h2 className="text-xl font-semibold text-slate-800">Assessment complete</h2>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            Couldn&apos;t save your results: {error}
          </p>
        )}
        {saving && <p className="text-sm text-slate-400">Saving…</p>}

        {diag ? (
          <div
            data-testid="mcq-diagnosis"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm"
            role="status"
          >
            <p className="font-semibold text-amber-800">
              Inconsistency detected in <span className="capitalize">{diag.dimension}</span>
            </p>
            <p className="mt-1 text-amber-700">
              Routed to the{' '}
              <span className="font-medium">{routeRemediation(diag.dimension)}</span> layer for
              remediation (confidence {Math.round(diag.confidence * 100)}%).
            </p>
            {diag.evidence.recurringMisconceptions.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-amber-700">
                {diag.evidence.recurringMisconceptions.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            No inconsistency detected — your answers were coherent across difficulties.
          </p>
        )}

        <DimensionProfileCard profile={finalMcq.dimensionProfile} />
      </div>
    );
  }

  return (
    <div data-testid="mcq-runner" className="max-w-xl mx-auto py-8 space-y-6">
      <p className="text-xs text-slate-400 text-right">
        Question {index + 1} / {questions.length}
      </p>

      <p className="text-lg text-slate-800">{q.stem}</p>

      {phase === 'answering' ? (
        <>
          <ul className="space-y-2">
            {q.options.map((opt, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={chosen === i}
                  onClick={() => setChosen(i)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    chosen === i
                      ? 'border-slate-800 bg-slate-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={submit}
            disabled={chosen === null}
            className="w-full py-3 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            Submit
          </button>
        </>
      ) : (
        <>
          <McqFeedback question={q} chosenIndex={chosen as number} />
          <button
            type="button"
            onClick={advance}
            className="w-full py-3 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </>
      )}
    </div>
  );
}
