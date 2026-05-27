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
import {
  DEFAULT_DEPTH,
  DEPTH_OPTIONS,
  resolvePass,
} from '@/lib/reader/select-pass';
import type { DepthPass, Module } from '@/lib/types';

interface ModuleReaderClientProps {
  module: Module;
}

export default function ModuleReaderClient({ module }: ModuleReaderClientProps) {
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
        <article>
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
    </section>
  );
}
