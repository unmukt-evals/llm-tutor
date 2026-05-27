// Typed re-export wrapper around scripts/seed-core.mjs.
//
// The seed migration's pure logic deliberately lives in plain ESM
// (scripts/seed-core.mjs) so the plain-node CLI (scripts/seed-sidecar.mjs) can
// import it with zero build step. This wrapper gives that logic a typed surface
// for the Vitest gate and tsc, without duplicating the implementation.
//
// @ts-expect-error — untyped .mjs import; the typed shapes are declared below.
import * as core from '../../../scripts/seed-core.mjs';
import type { Mastery, ModuleState, TutorState } from '@/lib/types';

export const VALID_MASTERY = core.VALID_MASTERY as Mastery[];

export const levelToMastery = core.levelToMastery as (raw: unknown) => Mastery;

export const buildSeededModuleState = core.buildSeededModuleState as (
  mastery?: Mastery,
  nowIso?: string,
) => ModuleState;

export const buildSeededTutorState = core.buildSeededTutorState as (
  modules?: Record<string, ModuleState>,
) => TutorState;

export interface MergeAction {
  id: string;
  action: 'seeded' | 'preserved' | 'carried';
  mastery: Mastery;
}

export const mergeModules = core.mergeModules as (
  existingModules: Record<string, ModuleState>,
  seededLevels: Record<string, Mastery>,
  nowIso: string,
) => { modules: Record<string, ModuleState>; actions: MergeAction[] };

export const moduleFromFrontmatter = core.moduleFromFrontmatter as (
  fm: Record<string, unknown> | null | undefined,
) => { moduleId: string; level: Mastery } | null;
