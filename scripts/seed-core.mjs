// seed-core.mjs — Pure, dependency-free logic for the sidecar seed migration.
//
// This module is intentionally plain ESM (.mjs) with NO imports so it can be:
//   (a) run directly by the Node CLI in seed-sidecar.mjs, and
//   (b) imported by a Vitest .ts test under src/ (the pure-mapping gate).
//
// It deliberately replicates the EXACT shapes of the app's
// `defaultModuleState()` / `defaultTutorState()` (src/lib/state/defaults.ts).
// The Vitest test asserts these stay structurally identical to the app
// defaults, so drift between this script and the app is caught at the gate.

/** The four valid Mastery values (mirrors `Mastery` in src/lib/types.ts). */
export const VALID_MASTERY = ['blank', 'fuzzy', 'solid', 'verified'];

/**
 * Map a raw `current_level` string (from `_progress.md` / module frontmatter
 * `baseline_state.current_level`) to a `Mastery` value.
 *
 *   null / undefined / "" / "null" / "none" / missing / unknown → "blank"
 *   "blank" | "fuzzy" | "solid" | "verified" (case-insensitive)  → itself
 *
 * Anything not in the valid set is treated as "blank" (non-destructive default).
 *
 * @param {unknown} raw
 * @returns {'blank'|'fuzzy'|'solid'|'verified'}
 */
export function levelToMastery(raw) {
  if (raw === null || raw === undefined) return 'blank';
  const v = String(raw).trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (v === '' || v === 'null' || v === 'none') return 'blank';
  return VALID_MASTERY.includes(v) ? v : 'blank';
}

/**
 * Empty PerformanceMatrix — mirrors emptyMatrix() in defaults.ts.
 * @returns {{ easy: {}, medium: {}, hard: {} }}
 */
function emptyMatrix() {
  return { easy: {}, medium: {}, hard: {} };
}

/**
 * Untested DimensionProfile — mirrors untestedProfile() in defaults.ts.
 */
function untestedProfile() {
  return { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' };
}

/**
 * Build a default ModuleState seeded with the given mastery.
 *
 * Mirrors `defaultModuleState()` (src/lib/state/defaults.ts) EXACTLY, except:
 *   - `mastery` is the seeded value (default 'blank'), and
 *   - when the seeded mastery is non-blank, a single masteryHistory entry is
 *     appended recording the seed provenance.
 *
 * @param {'blank'|'fuzzy'|'solid'|'verified'} mastery
 * @param {string} nowIso  ISO-8601 UTC timestamp for masteryHistory.at
 * @returns {object} ModuleState
 */
export function buildSeededModuleState(mastery = 'blank', nowIso) {
  return {
    mastery,
    masteryHistory:
      mastery === 'blank'
        ? []
        : [{ level: mastery, at: nowIso, via: 'seed-sidecar-migration' }],
    mcq: {
      matrix: emptyMatrix(),
      distractorLog: [],
      // §7 reconciliation: recentCorrect is a required anti-farm source.
      recentCorrect: [],
      dimensionProfile: untestedProfile(),
    },
    stressTest: {},
  };
}

/**
 * Build a full default TutorState v1. Mirrors `defaultTutorState()` with the
 * supplied modules block. `lastActive` defaults to '' to match the app.
 *
 * @param {Record<string, object>} modules
 * @returns {object} TutorState
 */
export function buildSeededTutorState(modules = {}) {
  return {
    version: 1,
    modules,
    flashcards: {},
    xp: { total: 0, thisWeek: 0 },
    streak: { count: 0, lastActive: '', freezeTokens: 1 },
    sessionLog: [],
  };
}

/**
 * Idempotent / non-destructive merge of seeded levels into an existing
 * (possibly empty) modules block.
 *
 * Rules:
 *   - If an existing module already has a non-`blank` mastery → PRESERVE it
 *     wholesale (don't regress earned progress); record action 'preserved'.
 *   - Otherwise seed a fresh ModuleState from the scanned level; action
 *     'seeded'.
 *   - Existing modules NOT present in the current scan are carried forward
 *     untouched; action 'carried'.
 *
 * Returns { modules, actions } where actions is an ordered array of
 * { id, action, mastery } log records (caller prints them).
 *
 * @param {Record<string, object>} existingModules
 * @param {Record<string, 'blank'|'fuzzy'|'solid'|'verified'>} seededLevels
 * @param {string} nowIso
 */
export function mergeModules(existingModules, seededLevels, nowIso) {
  const modules = {};
  const actions = [];

  for (const [id, seededLevel] of Object.entries(seededLevels)) {
    const existing = existingModules[id];
    const existingMastery = existing && typeof existing === 'object' ? existing.mastery : undefined;
    if (existing && existingMastery && existingMastery !== 'blank') {
      // Preserve earned progress — do not overwrite with the seed value.
      modules[id] = existing;
      actions.push({ id, action: 'preserved', mastery: existingMastery });
      continue;
    }
    modules[id] = buildSeededModuleState(seededLevel, nowIso);
    actions.push({ id, action: 'seeded', mastery: seededLevel });
  }

  // Carry forward any existing modules not in the current scan.
  for (const [id, modState] of Object.entries(existingModules)) {
    if (!(id in modules)) {
      modules[id] = modState;
      const m = modState && typeof modState === 'object' ? modState.mastery : 'blank';
      actions.push({ id, action: 'carried', mastery: m });
    }
  }

  return { modules, actions };
}

/**
 * Extract (module_id, mastery) from already-parsed frontmatter data.
 * Returns null if there is no `module_id` (e.g. _progress.md, _flashcards.md).
 *
 * Accepts the object that gray-matter (or any YAML parser) produces. Handles
 * `baseline_state` as either a nested object { current_level } or absent.
 *
 * @param {Record<string, unknown>} fm  parsed frontmatter data
 * @returns {{ moduleId: string, level: 'blank'|'fuzzy'|'solid'|'verified' } | null}
 */
export function moduleFromFrontmatter(fm) {
  if (!fm || typeof fm !== 'object') return null;
  const rawId = fm.module_id;
  if (rawId === undefined || rawId === null || String(rawId).trim() === '') return null;
  const moduleId = String(rawId).trim();

  let rawLevel;
  const bs = fm.baseline_state;
  if (bs && typeof bs === 'object') {
    rawLevel = bs.current_level;
  }
  return { moduleId, level: levelToMastery(rawLevel) };
}
