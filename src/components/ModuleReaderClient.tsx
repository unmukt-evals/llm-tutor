// src/components/ModuleReaderClient.tsx
// Client wrapper for the module reader's interactive surface (plan-02 Task 9).
//
// Owns the selected DepthPass (default = DEFAULT_DEPTH = engineer), renders the
// DepthToggle with a per-pass `availability` map so absent depths are visibly
// marked, and shows the selected pass body via the already-tested resolvePass
// helper. When a depth isn't authored it surfaces a clear "not authored yet"
// state — NO LLM generation in the MVP. The module's diagrams render via
// DiagramPane below the body.
'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import DepthToggle from '@/components/DepthToggle';
import DiagramPane from '@/components/DiagramPane';
import VizBlock from '@/components/viz/VizBlock';
import { SelfRevealPanel } from '@/components/SelfRevealPanel';
import {
  DEFAULT_DEPTH,
  DEPTH_OPTIONS,
  resolvePass,
} from '@/lib/reader/select-pass';
import type { DepthPass, Module, ModuleState } from '@/lib/types';

interface ModuleReaderClientProps {
  module: Module;
  state: ModuleState;
}

export default function ModuleReaderClient({ module, state }: ModuleReaderClientProps) {
  const [depth, setDepth] = useState<DepthPass>(DEFAULT_DEPTH);

  // Which passes are authored — drives DepthToggle's dimming + the body state.
  const availability: Partial<Record<DepthPass, boolean>> = Object.fromEntries(
    DEPTH_OPTIONS.map(({ key }) => [key, resolvePass(module, key).authored]),
  );

  const resolved = resolvePass(module, depth);

  return (
    <section className="space-y-4">
      <DepthToggle current={depth} onChange={setDepth} availability={availability} />

      {resolved.authored && resolved.content ? (
        <article className="prose prose-slate max-w-none">
          <ReactMarkdown>{resolved.content}</ReactMarkdown>
        </article>
      ) : (
        <div className="rounded border border-dashed border-slate-300 p-4 text-sm italic text-slate-500">
          This depth isn&rsquo;t authored yet &mdash; no LLM generation in the MVP.
          Try another depth.
        </div>
      )}

      {/* Diagrams from the module's engineer pass. Returns null when empty. */}
      <DiagramPane diagrams={module.diagrams} />

      {/* Real interactive visualizations declared in the module's "## Visuals"
          section (V-VIZ). Rendered after the pass body / diagrams; does not
          affect DiagramPane. Empty visuals → nothing rendered. */}
      {module.visuals.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Visualizations
          </h3>
          {module.visuals.map((viz, i) => (
            <VizBlock key={`viz-${i}`} viz={viz} />
          ))}
        </section>
      )}

      {/* Practice / self-assess — drills (acknowledge-only) + stress-test pool
          (each lens persists its verdict to ModuleState.stressTest). */}
      {(module.drills.length > 0 || module.stressTests.length > 0) && (
        <section className="space-y-6 border-t border-slate-200 pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Practice / self-assess
          </h2>

          {module.drills.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Application drills
              </h3>
              {module.drills.map((drill, i) => (
                <div key={`drill-${i}`} className="rounded-lg bg-slate-50 p-2">
                  <SelfRevealPanel mode="drill" drill={drill} sources={module.sources} />
                </div>
              ))}
            </div>
          )}

          {module.stressTests.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Stress-test pool
              </h3>
              {module.stressTests.map((stressTest, i) => (
                <div key={`stress-${stressTest.lens}-${i}`} className="rounded-lg bg-slate-50 p-2">
                  <SelfRevealPanel
                    mode="stressTest"
                    stressTest={stressTest}
                    moduleId={module.id}
                    state={state}
                    sources={module.sources}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
