// src/lib/reader/select-pass.ts
// Pure helpers for depth-pass resolution (S-READER).
// No React import — plain TS so it is Vitest-testable. The DepthToggle
// component and the module reader page both consume these.

import type { DepthPass, Module } from '@/lib/types';

export type DepthLabel = 'Dumb it down' | 'Engineer' | 'Make it matter';

export interface DepthOption {
  label: DepthLabel;
  key: DepthPass;
  isDefault: boolean;
}

// Order is load-bearing: the DepthToggle renders buttons in this order, and
// the spec pins "Engineer" as the default depth.
export const DEPTH_OPTIONS: DepthOption[] = [
  { label: 'Dumb it down', key: 'tenYearOld', isDefault: false },
  { label: 'Engineer', key: 'engineer', isDefault: true },
  { label: 'Make it matter', key: 'operator', isDefault: false },
];

/** The default depth pass key (Engineer) — single source of truth. */
export const DEFAULT_DEPTH: DepthPass =
  DEPTH_OPTIONS.find((o) => o.isDefault)?.key ?? 'engineer';

export interface ResolvedPass {
  key: DepthPass;
  authored: boolean;
  content?: string;
}

/**
 * Resolve a DepthPass key against a Module.
 * Returns { authored: true, content } if the pass is present and non-empty,
 * { authored: false } otherwise — the caller should surface a clear
 * "this depth not authored yet" state. Do NOT generate with an LLM in MVP.
 */
export function resolvePass(mod: Module, key: DepthPass): ResolvedPass {
  const content = mod.passes[key];
  if (content && content.trim().length > 0) {
    return { key, authored: true, content };
  }
  return { key, authored: false };
}
