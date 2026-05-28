# V-NAV — Sidebar + Progress Rings + Juice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, collapsible sidebar that lists every module grouped by track with an animated per-module progress ring, wrapped in an app shell that keeps the existing TopBar and never breaks `/`, `/module/[id]`, `/module/[id]/assess`, or `/flashcards`, plus a CSS-first juice layer (animated rings, XP-pop, level-up flourish, route transition) gated by `prefers-reduced-motion`.

**Architecture:** All non-trivial logic lives in pure, unit-tested `.ts` helpers under `src/lib/ui/` (vitest, node env — the project tests pure helpers and relies on `tsc`/`next build` for component correctness; there is NO jsdom). React components (`ProgressRing.tsx`, `Sidebar.tsx`, `XpPop.tsx`, `RouteTransition.tsx`) are thin shells over those helpers. A new server layout at `app/(shell)/layout.tsx` (Next.js App Router route group — the `(shell)` folder groups routes under one layout WITHOUT adding a URL segment) loads curriculum + state once and renders `<Sidebar>` beside `{children}`; the four existing route folders move under `app/(shell)/` so they inherit the shell with zero copy changes. Animation is pure CSS transitions + a tiny `prefers-reduced-motion` gate helper; localStorage persists the collapsed flag. No new runtime dependencies (no `framer-motion` — see Task 0 note).

**Tech Stack:** Next.js 15 App Router (React 19 server + client components), TypeScript 5.7, Tailwind v3 (configured; `@tailwindcss/typography` plugin present), Vitest 3 (globals on, `environment: 'node'`, `include: ['src/**/*.test.ts']`), import alias `@` → `src/`. State writes from client go through `/api/state` (`patchState` in `src/lib/api-client.ts`); server components read via `getStateStore(dir)` and `getCurriculumRepository()`. Env var `process.env.CURRICULUM_DIR` is read only in server components.

**Conventions locked from the existing codebase (read before starting):**
- Pure helpers live under `src/lib/<area>/`, tests in a sibling `__tests__/` dir named `<file>.test.ts`. Vitest `include` only matches `src/**/*.test.ts` — component `.tsx` files are NOT tested by render; correctness is enforced by `tsc --noEmit` + `next build`.
- Shared types come from `@/lib/types` (`Mastery`, `ModuleState`, `TutorState`, `Curriculum`, `Module`, `TrackId`). NEVER redefine them locally.
- Server pages read `process.env.CURRICULUM_DIR`; if unset they render a friendly empty state and DO NOT throw (throwing breaks `next build`). The shell layout MUST follow this rule.
- Client components are marked `'use client'`; they must not import anything that pulls `node:fs`/`node:path` (e.g. import `selectAssessment` from a pure submodule, not a barrel). The Sidebar is purely presentational + localStorage, so this is naturally satisfied.
- Tailwind classes only (no inline style except where React Flow already does it). Slate palette + emoji glyphs match `TopBar.tsx`.
- Commit trailer on EVERY commit:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

**Every task ends green:** `npm test && npm run typecheck && npm run lint && npm run build` all pass before the commit.

---

### Task 0: Dependency decision (no code — read and confirm)

**framer-motion tradeoff (decision: DO NOT add it).** The spec permits `framer-motion` "only if a reviewer agrees it's worth it." Everything in this plan — ring fill animation, XP-pop fade/slide, level-up pulse, route cross-fade — is achievable with CSS transitions + Tailwind utility classes + the existing `prefers-reduced-motion` media query. Adding framer-motion (~50KB gzipped, a client-only React context) buys nothing here and adds a `'use client'` boundary cost. **We stay CSS-first.** If a future task genuinely needs spring physics or layout animations, revisit then. No `package.json` change in this plan.

- [ ] **Step 1: Confirm no dependency change is needed**

Run: `git -C /Users/unmukt/llm-tutor diff --quiet package.json && echo "package.json unchanged — good"`
Expected: prints `package.json unchanged — good`

(No commit for this task — it is a recorded decision only.)

---

### Task 1: Pure ring mapping helper (`mastery → {fraction, color, label}`)

**Files:**
- Create: `src/lib/ui/progress-ring.ts`
- Test: `src/lib/ui/__tests__/progress-ring.test.ts`

The headline pure logic: map a `Mastery` (plus an `openDiagnosis` flag) to a fill fraction, a color token, and an accessible label. Fractions per spec §1: blank=0, fuzzy=1/3, solid=2/3, verified=1. `openDiagnosis` is a distinct state that overrides the color (amber/warning) regardless of mastery, while keeping the mastery's fill fraction so the ring still reflects progress.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ui/__tests__/progress-ring.test.ts
import { describe, it, expect } from 'vitest';
import { ringVisual, RING_COLORS } from '@/lib/ui/progress-ring';

describe('ringVisual', () => {
  it('maps blank → fraction 0', () => {
    const v = ringVisual('blank');
    expect(v.fraction).toBe(0);
    expect(v.color).toBe(RING_COLORS.blank);
    expect(v.label).toBe('Not started');
  });

  it('maps fuzzy → fraction 1/3', () => {
    const v = ringVisual('fuzzy');
    expect(v.fraction).toBeCloseTo(1 / 3, 10);
    expect(v.color).toBe(RING_COLORS.fuzzy);
    expect(v.label).toBe('Fuzzy');
  });

  it('maps solid → fraction 2/3', () => {
    const v = ringVisual('solid');
    expect(v.fraction).toBeCloseTo(2 / 3, 10);
    expect(v.color).toBe(RING_COLORS.solid);
    expect(v.label).toBe('Solid');
  });

  it('maps verified → fraction 1', () => {
    const v = ringVisual('verified');
    expect(v.fraction).toBe(1);
    expect(v.color).toBe(RING_COLORS.verified);
    expect(v.label).toBe('Verified');
  });

  it('open diagnosis overrides color to the diagnosis token but keeps mastery fraction', () => {
    const v = ringVisual('fuzzy', true);
    expect(v.fraction).toBeCloseTo(1 / 3, 10);
    expect(v.color).toBe(RING_COLORS.openDiagnosis);
    expect(v.label).toBe('Needs attention');
  });

  it('open diagnosis on a blank module still shows fraction 0 with the diagnosis color', () => {
    const v = ringVisual('blank', true);
    expect(v.fraction).toBe(0);
    expect(v.color).toBe(RING_COLORS.openDiagnosis);
    expect(v.label).toBe('Needs attention');
  });

  it('every fraction is within [0,1]', () => {
    for (const m of ['blank', 'fuzzy', 'solid', 'verified'] as const) {
      const v = ringVisual(m);
      expect(v.fraction).toBeGreaterThanOrEqual(0);
      expect(v.fraction).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/unmukt/llm-tutor && npm test -- progress-ring`
Expected: FAIL — `Failed to resolve import "@/lib/ui/progress-ring"` / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ui/progress-ring.ts
// PURE mapping: a module's Mastery (+ whether it has an open diagnosis) →
// the visual properties a progress ring needs. No React, no DOM — unit-tested.
// Fractions per V1 spec §1: blank=0, fuzzy=1/3, solid=2/3, verified=full.
// An open diagnosis is a distinct state: it overrides the color to a warning
// token but keeps the mastery's fill fraction so the ring still reads progress.

import type { Mastery } from '@/lib/types';

/**
 * Stroke colors as raw hex (consumed by an SVG `stroke` attribute, not a
 * Tailwind class — SVG strokes can't use Tailwind text/bg tokens reliably).
 * Slate/emerald/amber chosen to match the existing slate-based UI.
 */
export const RING_COLORS = {
  blank: '#cbd5e1', // slate-300
  fuzzy: '#fbbf24', // amber-400
  solid: '#38bdf8', // sky-400
  verified: '#34d399', // emerald-400
  openDiagnosis: '#f97316', // orange-500 — distinct "needs attention"
} as const;

export interface RingVisual {
  /** 0..1 fraction of the circle to fill. */
  fraction: number;
  /** SVG stroke color (hex). */
  color: string;
  /** Accessible label describing the state. */
  label: string;
}

const FRACTION: Record<Mastery, number> = {
  blank: 0,
  fuzzy: 1 / 3,
  solid: 2 / 3,
  verified: 1,
};

const COLOR: Record<Mastery, string> = {
  blank: RING_COLORS.blank,
  fuzzy: RING_COLORS.fuzzy,
  solid: RING_COLORS.solid,
  verified: RING_COLORS.verified,
};

const LABEL: Record<Mastery, string> = {
  blank: 'Not started',
  fuzzy: 'Fuzzy',
  solid: 'Solid',
  verified: 'Verified',
};

/**
 * Map a mastery level (+ open-diagnosis flag) to ring visuals.
 * openDiagnosis overrides color + label but preserves the mastery fraction.
 */
export function ringVisual(mastery: Mastery, openDiagnosis = false): RingVisual {
  return {
    fraction: FRACTION[mastery],
    color: openDiagnosis ? RING_COLORS.openDiagnosis : COLOR[mastery],
    label: openDiagnosis ? 'Needs attention' : LABEL[mastery],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/unmukt/llm-tutor && npm test -- progress-ring`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/ui/progress-ring.ts src/lib/ui/__tests__/progress-ring.test.ts
git commit -m "$(cat <<'EOF'
feat(v1a): pure mastery→ring-visual mapping helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Pure ring geometry helper (`fraction → SVG dash array`)

**Files:**
- Modify: `src/lib/ui/progress-ring.ts` (add `ringGeometry`)
- Modify: `src/lib/ui/__tests__/progress-ring.test.ts` (add geometry tests)

`ProgressRing` draws a circle whose filled arc is controlled by `stroke-dasharray` / `stroke-dashoffset`. Keep that math pure + tested so the component stays a dumb renderer. Given a radius, return circumference and the dash offset for a given fraction (offset = circumference × (1 − fraction), so fraction 0 → fully hidden, fraction 1 → fully shown).

- [ ] **Step 1: Write the failing test (append to the existing test file)**

```typescript
// append to src/lib/ui/__tests__/progress-ring.test.ts
import { ringGeometry } from '@/lib/ui/progress-ring';

describe('ringGeometry', () => {
  it('computes circumference from radius', () => {
    const g = ringGeometry(10, 0.5);
    expect(g.circumference).toBeCloseTo(2 * Math.PI * 10, 10);
  });

  it('fraction 0 → dashoffset === circumference (nothing shown)', () => {
    const g = ringGeometry(10, 0);
    expect(g.dashOffset).toBeCloseTo(g.circumference, 10);
  });

  it('fraction 1 → dashoffset 0 (full circle shown)', () => {
    const g = ringGeometry(10, 1);
    expect(g.dashOffset).toBeCloseTo(0, 10);
  });

  it('fraction 0.5 → dashoffset is half the circumference', () => {
    const g = ringGeometry(10, 0.5);
    expect(g.dashOffset).toBeCloseTo(g.circumference / 2, 10);
  });

  it('clamps out-of-range fractions to [0,1]', () => {
    expect(ringGeometry(10, -1).dashOffset).toBeCloseTo(ringGeometry(10, 0).circumference, 10);
    expect(ringGeometry(10, 5).dashOffset).toBeCloseTo(0, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/unmukt/llm-tutor && npm test -- progress-ring`
Expected: FAIL — `ringGeometry` is not exported.

- [ ] **Step 3: Write minimal implementation (append to `progress-ring.ts`)**

```typescript
// append to src/lib/ui/progress-ring.ts

export interface RingGeometry {
  circumference: number;
  /** stroke-dashoffset: circumference * (1 - clampedFraction). */
  dashOffset: number;
}

/** Clamp a number into [min,max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Pure SVG ring geometry from a stroke radius + fill fraction. */
export function ringGeometry(radius: number, fraction: number): RingGeometry {
  const circumference = 2 * Math.PI * radius;
  const f = clamp(fraction, 0, 1);
  return { circumference, dashOffset: circumference * (1 - f) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/unmukt/llm-tutor && npm test -- progress-ring`
Expected: PASS — all `ringVisual` + `ringGeometry` tests pass.

- [ ] **Step 5: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/ui/progress-ring.ts src/lib/ui/__tests__/progress-ring.test.ts
git commit -m "$(cat <<'EOF'
feat(v1a): pure SVG ring geometry helper (dasharray math)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Reduced-motion gate helper

**Files:**
- Create: `src/lib/ui/motion.ts`
- Test: `src/lib/ui/__tests__/motion.test.ts`

A pure helper that decides whether animation is allowed, given a "user prefers reduced motion" boolean. Components call `prefersReducedMotion()` (a thin browser wrapper) and pass the result to `animationEnabled()`. Keeping the gate pure lets us unit-test the policy without a DOM. Policy: animation is enabled iff the user does NOT prefer reduced motion.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ui/__tests__/motion.test.ts
import { describe, it, expect } from 'vitest';
import { animationEnabled, motionDurationMs } from '@/lib/ui/motion';

describe('animationEnabled', () => {
  it('is true when the user does NOT prefer reduced motion', () => {
    expect(animationEnabled(false)).toBe(true);
  });

  it('is false when the user prefers reduced motion', () => {
    expect(animationEnabled(true)).toBe(false);
  });
});

describe('motionDurationMs', () => {
  it('returns the requested duration when motion is enabled', () => {
    expect(motionDurationMs(400, false)).toBe(400);
  });

  it('collapses to 0ms when the user prefers reduced motion', () => {
    expect(motionDurationMs(400, true)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/unmukt/llm-tutor && npm test -- motion`
Expected: FAIL — `Failed to resolve import "@/lib/ui/motion"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ui/motion.ts
// PURE motion policy + a thin browser probe. The policy is unit-tested; the
// probe is a one-line wrapper around matchMedia (untested — no jsdom in this
// project). Components read `prefersReducedMotion()` once, then feed the boolean
// into the pure helpers so all animation honors the OS setting (V1 spec §1).

/** Animation is allowed iff the user does NOT prefer reduced motion. */
export function animationEnabled(prefersReduced: boolean): boolean {
  return !prefersReduced;
}

/** A duration, collapsed to 0ms when the user prefers reduced motion. */
export function motionDurationMs(ms: number, prefersReduced: boolean): number {
  return prefersReduced ? 0 : ms;
}

/**
 * Browser probe: true if the OS/browser requests reduced motion.
 * SSR-safe: returns false when `window`/`matchMedia` is unavailable.
 * (Not unit-tested — node env has no matchMedia; covered by build/typecheck.)
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/unmukt/llm-tutor && npm test -- motion`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/ui/motion.ts src/lib/ui/__tests__/motion.test.ts
git commit -m "$(cat <<'EOF'
feat(v1a): reduced-motion gate helper + SSR-safe probe

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Juice detection helpers (xp-increase + level-up)

**Files:**
- Create: `src/lib/ui/juice.ts`
- Test: `src/lib/ui/__tests__/juice.test.ts`

Pure detectors the juice layer uses to decide WHEN to fire effects:
1. `xpDelta(prevTotal, nextTotal)` → the positive XP gained (0 if not increased) — drives the XP-pop.
2. `modulesReachingVerified(prevStates, nextStates)` → the module IDs that transitioned INTO `verified` — drives the level-up flourish. A module counts only if its previous mastery existed and was NOT `verified` and its next mastery IS `verified`. A module newly appearing as `verified` (no prior entry) does NOT count (avoids a flourish on first load).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ui/__tests__/juice.test.ts
import { describe, it, expect } from 'vitest';
import { xpDelta, modulesReachingVerified } from '@/lib/ui/juice';
import type { Mastery } from '@/lib/types';

describe('xpDelta', () => {
  it('returns the positive gain when xp increases', () => {
    expect(xpDelta(100, 130)).toBe(30);
  });
  it('returns 0 when xp is unchanged', () => {
    expect(xpDelta(100, 100)).toBe(0);
  });
  it('returns 0 when xp decreases (never negative)', () => {
    expect(xpDelta(100, 80)).toBe(0);
  });
});

describe('modulesReachingVerified', () => {
  const prev: Record<string, Mastery> = { M01: 'solid', M02: 'verified', M03: 'fuzzy' };

  it('detects a module that just hit verified', () => {
    const next: Record<string, Mastery> = { M01: 'verified', M02: 'verified', M03: 'fuzzy' };
    expect(modulesReachingVerified(prev, next)).toEqual(['M01']);
  });

  it('does not re-fire for a module already verified', () => {
    const next: Record<string, Mastery> = { M01: 'solid', M02: 'verified', M03: 'fuzzy' };
    expect(modulesReachingVerified(prev, next)).toEqual([]);
  });

  it('ignores a module newly appearing as verified with no prior entry', () => {
    const next: Record<string, Mastery> = { ...prev, M99: 'verified' };
    expect(modulesReachingVerified(prev, next)).toEqual([]);
  });

  it('returns multiple ids when several advance at once, in stable order', () => {
    const p: Record<string, Mastery> = { A: 'solid', B: 'solid' };
    const n: Record<string, Mastery> = { A: 'verified', B: 'verified' };
    expect(modulesReachingVerified(p, n).sort()).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/unmukt/llm-tutor && npm test -- juice`
Expected: FAIL — `Failed to resolve import "@/lib/ui/juice"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ui/juice.ts
// PURE juice detectors: decide WHEN celebratory effects fire. No React, no DOM.
// The juice React shells (XpPop, level-up flourish) call these against the
// previous vs next snapshot they hold, then animate. Keeping detection pure
// means the "did this just happen?" logic is unit-tested (V1 spec §1 juice).

import type { Mastery } from '@/lib/types';

/** Positive XP gained between two totals; 0 if unchanged or decreased. */
export function xpDelta(prevTotal: number, nextTotal: number): number {
  return Math.max(0, nextTotal - prevTotal);
}

/**
 * Module ids that transitioned INTO 'verified' between two mastery snapshots.
 * A module qualifies only if it had a prior entry that was not already
 * 'verified' and its next value is 'verified'. Modules with no prior entry are
 * ignored (prevents a false flourish on first load / hydration).
 */
export function modulesReachingVerified(
  prev: Record<string, Mastery>,
  next: Record<string, Mastery>,
): string[] {
  const out: string[] = [];
  for (const id of Object.keys(next)) {
    const before = prev[id];
    if (before !== undefined && before !== 'verified' && next[id] === 'verified') {
      out.push(id);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/unmukt/llm-tutor && npm test -- juice`
Expected: PASS — all `xpDelta` + `modulesReachingVerified` tests pass.

- [ ] **Step 5: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/ui/juice.ts src/lib/ui/__tests__/juice.test.ts
git commit -m "$(cat <<'EOF'
feat(v1a): pure juice detectors (xp delta + level-up to verified)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Pure sidebar grouping helper (modules → track sections)

**Files:**
- Create: `src/lib/ui/sidebar-model.ts`
- Test: `src/lib/ui/__tests__/sidebar-model.test.ts`

The Sidebar groups modules by track (A / B / C) and, within a track, preserves the curriculum's module order. Each row needs the module id, name, its mastery, and its `openDiagnosis` flag (read from `TutorState`, defaulting to `blank`/false when a module has no state entry). This shaping is pure + tested so the component is a dumb mapper. Output is serializable (server → client props).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/ui/__tests__/sidebar-model.test.ts
import { describe, it, expect } from 'vitest';
import { buildSidebarModel } from '@/lib/ui/sidebar-model';
import type { Curriculum, Module, TutorState, Mastery } from '@/lib/types';

function mod(id: string, track: 'A' | 'B' | 'C', name: string): Module {
  return {
    id,
    track,
    name,
    prerequisites: [],
    primarySources: [],
    whyThisMatters: 'x',
    anchors: [],
    passes: {},
    diagrams: [],
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}

function curriculum(modules: Module[]): Curriculum {
  return {
    tracks: ['A', 'B'],
    modules,
    byId: (id) => modules.find((m) => m.id === id),
  };
}

function stateWith(mastery: Record<string, Mastery>, openDiag: string[] = []): TutorState {
  const modules: TutorState['modules'] = {};
  for (const [id, level] of Object.entries(mastery)) {
    modules[id] = {
      mastery: level,
      masteryHistory: [],
      mcq: {
        matrix: { easy: {}, medium: {}, hard: {} },
        distractorLog: [],
        dimensionProfile: { topic: 'untested', logic: 'untested', example: 'untested', extension: 'untested' },
        recentCorrect: [],
        ...(openDiag.includes(id)
          ? {
              openDiagnosis: {
                dimension: 'topic',
                confidence: 0.5,
                evidence: { qids: [], recurringMisconceptions: [] },
                remediation: 'drill',
                openedAt: '2026-05-27',
              },
            }
          : {}),
      },
      stressTest: {},
    };
  }
  return {
    version: 1,
    modules,
    flashcards: {},
    xp: { total: 0, thisWeek: 0 },
    streak: { count: 0, lastActive: '', freezeTokens: 0 },
    sessionLog: [],
  };
}

describe('buildSidebarModel', () => {
  it('groups modules by track and preserves curriculum order within a track', () => {
    const cur = curriculum([
      mod('A01', 'A', 'Alpha'),
      mod('B01', 'B', 'Beta'),
      mod('A02', 'A', 'Gamma'),
    ]);
    const model = buildSidebarModel(cur, stateWith({}));
    expect(model.map((g) => g.track)).toEqual(['A', 'B']);
    const trackA = model.find((g) => g.track === 'A')!;
    expect(trackA.rows.map((r) => r.id)).toEqual(['A01', 'A02']);
  });

  it('defaults missing module state to blank mastery and no open diagnosis', () => {
    const cur = curriculum([mod('A01', 'A', 'Alpha')]);
    const model = buildSidebarModel(cur, stateWith({}));
    const row = model[0].rows[0];
    expect(row.mastery).toBe('blank');
    expect(row.openDiagnosis).toBe(false);
    expect(row.name).toBe('Alpha');
  });

  it('reads mastery and open-diagnosis from state', () => {
    const cur = curriculum([mod('A01', 'A', 'Alpha'), mod('A02', 'A', 'Beta')]);
    const model = buildSidebarModel(cur, stateWith({ A01: 'verified', A02: 'fuzzy' }, ['A02']));
    const rows = model[0].rows;
    expect(rows[0]).toMatchObject({ id: 'A01', mastery: 'verified', openDiagnosis: false });
    expect(rows[1]).toMatchObject({ id: 'A02', mastery: 'fuzzy', openDiagnosis: true });
  });

  it('omits tracks that have no modules', () => {
    const cur = curriculum([mod('A01', 'A', 'Alpha')]);
    const model = buildSidebarModel(cur, stateWith({}));
    expect(model.map((g) => g.track)).toEqual(['A']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/unmukt/llm-tutor && npm test -- sidebar-model`
Expected: FAIL — `Failed to resolve import "@/lib/ui/sidebar-model"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/ui/sidebar-model.ts
// PURE shaping: Curriculum + TutorState → the serializable view-model the
// Sidebar renders. Groups by track (curriculum order preserved within a track),
// resolves each module's mastery + open-diagnosis flag from state (defaulting
// to blank/false when absent). No React — server builds this, passes it down.

import type { Curriculum, Mastery, TrackId, TutorState } from '@/lib/types';

export interface SidebarRow {
  id: string;
  name: string;
  track: TrackId;
  mastery: Mastery;
  openDiagnosis: boolean;
}

export interface SidebarGroup {
  track: TrackId;
  rows: SidebarRow[];
}

const TRACK_ORDER: TrackId[] = ['A', 'B', 'C'];

/** Build the per-track grouped sidebar view-model. */
export function buildSidebarModel(
  curriculum: Curriculum,
  state: TutorState,
): SidebarGroup[] {
  const byTrack = new Map<TrackId, SidebarRow[]>();

  for (const m of curriculum.modules) {
    const ms = state.modules[m.id];
    const row: SidebarRow = {
      id: m.id,
      name: m.name,
      track: m.track,
      mastery: ms?.mastery ?? 'blank',
      openDiagnosis: Boolean(ms?.mcq?.openDiagnosis),
    };
    const list = byTrack.get(m.track);
    if (list) list.push(row);
    else byTrack.set(m.track, [row]);
  }

  // Emit tracks in canonical A,B,C order, skipping empty ones.
  return TRACK_ORDER.filter((t) => byTrack.has(t)).map((track) => ({
    track,
    rows: byTrack.get(track)!,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/unmukt/llm-tutor && npm test -- sidebar-model`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/ui/sidebar-model.ts src/lib/ui/__tests__/sidebar-model.test.ts
git commit -m "$(cat <<'EOF'
feat(v1a): pure sidebar view-model (group by track + resolve mastery)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `ProgressRing` component (thin SVG over the pure helpers)

**Files:**
- Create: `src/components/ProgressRing.tsx`

A purely presentational client component. Props: `mastery: Mastery`, `openDiagnosis?: boolean`, `size?: number` (px, default 24), `strokeWidth?: number` (default 3). It calls `ringVisual` + `ringGeometry`, renders a two-circle SVG (a faint track + the colored progress arc), and animates `stroke-dashoffset` via a CSS transition. The transition is gated: it reads `prefersReducedMotion()` on mount and applies a 0ms duration when reduced motion is requested. Marked `'use client'` because it reads `matchMedia`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/ProgressRing.tsx
// Presentational SVG progress ring. ALL logic lives in pure tested helpers:
//   ringVisual  (mastery → fraction/color/label)
//   ringGeometry(radius, fraction → dasharray/offset)
//   motion      (reduced-motion gate)
// The arc animates its stroke-dashoffset via a CSS transition; reduced motion
// collapses the duration to 0ms. (V1 spec §1: animated rings, distinct
// open-diagnosis state, prefers-reduced-motion respected.)
'use client';

import { useEffect, useState } from 'react';
import type { Mastery } from '@/lib/types';
import { ringVisual, ringGeometry, RING_COLORS } from '@/lib/ui/progress-ring';
import { motionDurationMs, prefersReducedMotion } from '@/lib/ui/motion';

interface ProgressRingProps {
  mastery: Mastery;
  openDiagnosis?: boolean;
  /** Outer pixel size of the square SVG. */
  size?: number;
  strokeWidth?: number;
}

export default function ProgressRing({
  mastery,
  openDiagnosis = false,
  size = 24,
  strokeWidth = 3,
}: ProgressRingProps) {
  // Detect reduced-motion after mount (matchMedia is browser-only). Default to
  // animating; collapse to 0ms if the user prefers reduced motion.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(prefersReducedMotion());
  }, []);

  const { fraction, color, label } = ringVisual(mastery, openDiagnosis);
  const radius = size / 2 - strokeWidth;
  const { circumference, dashOffset } = ringGeometry(radius, fraction);
  const durationMs = motionDurationMs(500, reduced);
  const center = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Progress: ${label}`}
      data-testid="progress-ring"
      className="shrink-0"
    >
      {/* faint track */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={RING_COLORS.blank}
        strokeOpacity={0.35}
        strokeWidth={strokeWidth}
      />
      {/* progress arc — rotated -90deg so it starts at 12 o'clock */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: `stroke-dashoffset ${durationMs}ms ease-out, stroke ${durationMs}ms ease-out` }}
      />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck the new component in isolation**

Run: `cd /Users/unmukt/llm-tutor && npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed. (No render test — vitest only matches `.test.ts`; correctness of the `.tsx` is enforced by typecheck + build. The pure mapping/geometry it depends on is already covered by Tasks 1–2.)

- [ ] **Step 4: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/components/ProgressRing.tsx
git commit -m "$(cat <<'EOF'
feat(v1a): ProgressRing — animated, prop-driven SVG ring

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `Sidebar` component (grouped module list + collapse + active highlight)

**Files:**
- Create: `src/components/Sidebar.tsx`

Client component (uses `usePathname`, localStorage, click handlers). Props: `groups: SidebarGroup[]` (from `buildSidebarModel`, passed by the server layout). Renders each track as a section with a heading and rows; each row = a `next/link` to `/module/<id>` showing the module name + a `<ProgressRing mastery openDiagnosis />`. The row matching the current pathname gets an active highlight. A collapse toggle button shrinks the sidebar to an icon rail; the collapsed boolean persists in `localStorage` under `llmtutor.sidebar.collapsed`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/Sidebar.tsx
// Persistent left nav. Pure shaping is done server-side by buildSidebarModel;
// this is a dumb renderer + two bits of client state: active-route highlight
// (usePathname) and a localStorage-persisted collapsed flag. Each row shows a
// ProgressRing reflecting that module's mastery (V1 spec §1).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SidebarGroup } from '@/lib/ui/sidebar-model';
import ProgressRing from '@/components/ProgressRing';

const STORAGE_KEY = 'llmtutor.sidebar.collapsed';

interface SidebarProps {
  groups: SidebarGroup[];
}

export default function Sidebar({ groups }: SidebarProps) {
  const pathname = usePathname();

  // Persisted collapse state. Read after mount (localStorage is browser-only);
  // default expanded to avoid a hydration mismatch on first paint.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      // localStorage unavailable (private mode etc.) — stay expanded.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore persistence failure
      }
      return next;
    });
  }

  return (
    <nav
      aria-label="Modules"
      data-collapsed={collapsed}
      className={`flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-64'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Modules
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <section key={group.track} className="mb-4">
            {!collapsed && (
              <h2 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Track {group.track}
              </h2>
            )}
            <ul className="space-y-1">
              {group.rows.map((row) => {
                const href = `/module/${row.id}`;
                const active = pathname === href;
                return (
                  <li key={row.id}>
                    <Link
                      href={href}
                      title={row.name}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        active
                          ? 'bg-slate-800 font-medium text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <ProgressRing
                        mastery={row.mastery}
                        openDiagnosis={row.openDiagnosis}
                        size={20}
                      />
                      {!collapsed && <span className="truncate">{row.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 3: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(v1a): Sidebar — track-grouped modules with rings, collapse, active

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: App shell layout — move existing routes under `(shell)` route group

**Files:**
- Create: `app/(shell)/layout.tsx`
- Move: `app/page.tsx` → `app/(shell)/page.tsx`
- Move: `app/module/` → `app/(shell)/module/` (carries `[id]/page.tsx` + `[id]/assess/page.tsx`)
- Move: `app/flashcards/` → `app/(shell)/flashcards/`
- Keep unchanged: `app/layout.tsx` (root html/body), `app/globals.css`, `app/api/state/route.ts`

The `(shell)` route group adds NO URL segment — `/`, `/module/[id]`, `/module/[id]/assess`, `/flashcards` keep their exact paths. The shell layout is a SERVER component: it loads curriculum + state once, builds the sidebar model, and renders `<Sidebar>` beside `{children}`. It follows the same `CURRICULUM_DIR`-unset guard the pages use — when unset it renders `{children}` WITHOUT a sidebar (the child page already shows the friendly empty state) so `next build` never throws.

- [ ] **Step 1: Move the route files (preserve git history)**

```bash
cd /Users/unmukt/llm-tutor
mkdir -p "app/(shell)"
git mv app/page.tsx "app/(shell)/page.tsx"
git mv app/module "app/(shell)/module"
git mv app/flashcards "app/(shell)/flashcards"
```

- [ ] **Step 2: Verify the move left `app/api` and `app/layout.tsx` in place**

Run: `cd /Users/unmukt/llm-tutor && ls app && echo '---' && ls "app/(shell)"`
Expected: `app` contains `(shell)`, `api`, `globals.css`, `layout.tsx`. `app/(shell)` contains `flashcards`, `module`, `page.tsx`.

- [ ] **Step 3: Create the shell layout**

```tsx
// app/(shell)/layout.tsx
// Server layout for the (shell) route group: a persistent Sidebar + content.
// Loads curriculum + state ONCE here (server-side, reading CURRICULUM_DIR) and
// passes the pre-built, serializable sidebar model down to the client Sidebar.
// The (shell) group adds NO URL segment, so /, /module/[id], /module/[id]/assess
// and /flashcards keep their exact paths and inherit this shell.
//
// CURRICULUM_DIR-unset guard mirrors the pages: when unset we render children
// WITHOUT a sidebar (the child page shows its own friendly empty state) so
// `next build` — which renders these routes — never throws.

import type { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import { getCurriculumRepository } from '@/lib/ingest';
import { getStateStore } from '@/lib/state';
import { buildSidebarModel } from '@/lib/ui/sidebar-model';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const curriculumDir = process.env.CURRICULUM_DIR;

  if (!curriculumDir) {
    // No curriculum → no sidebar; the page renders its own empty state.
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  const [curriculum, state] = await Promise.all([
    getCurriculumRepository().load(curriculumDir),
    getStateStore(curriculumDir).read(),
  ]);
  const groups = buildSidebarModel(curriculum, state);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar groups={groups} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Verify all four routes still render + build**

Run: `cd /Users/unmukt/llm-tutor && npm run build`
Expected: build succeeds and the route list includes `/`, `/module/[id]`, `/module/[id]/assess`, `/flashcards` (NOT `/(shell)/...` — the group is invisible in URLs).

- [ ] **Step 5: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add -A
git commit -m "$(cat <<'EOF'
feat(v1a): app shell — (shell) route group with persistent Sidebar layout

Move /, /module/[id], /module/[id]/assess, /flashcards under app/(shell)/ so
they inherit a server layout that loads curriculum+state once and renders the
Sidebar. URLs unchanged; api/ and root layout untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `XpPop` toast — fires when XP increases

**Files:**
- Create: `src/components/XpPop.tsx`
- Modify: `app/(shell)/layout.tsx` (mount `<XpPop initialXpTotal={state.xp.total} />`)

A client component that polls/derives the current XP total and shows a brief "+N XP" toast when it increases, using the pure `xpDelta` detector. Since client components write state via `patchState` (which returns the updated `TutorState`) but the layout is server-rendered, the simplest correct trigger is: on mount the layout passes the server-known `state.xp.total`; `XpPop` then listens for a custom `llmtutor:xp` window event (dispatched by client code that earns XP) carrying the new total, computes the delta, and renders a transient toast. This keeps `XpPop` decoupled and testable-by-helper (the detector is already tested in Task 4). The toast auto-dismisses; animation honors reduced motion.

- [ ] **Step 1: Write the component**

```tsx
// src/components/XpPop.tsx
// Transient "+N XP" toast. Decoupled from any specific earn-site: it listens
// for a window CustomEvent `llmtutor:xp` whose detail is the new xp total, then
// uses the pure xpDelta detector (tested) to decide whether (and how much) to
// pop. Auto-dismisses; animation collapses to instant under reduced motion.
// Any client code that earns XP can fire:
//   window.dispatchEvent(new CustomEvent('llmtutor:xp', { detail: newTotal }))
'use client';

import { useEffect, useRef, useState } from 'react';
import { xpDelta } from '@/lib/ui/juice';
import { motionDurationMs, prefersReducedMotion } from '@/lib/ui/motion';

export const XP_EVENT = 'llmtutor:xp';

interface XpPopProps {
  /** Server-known XP total at mount; the baseline for the first delta. */
  initialXpTotal: number;
}

export default function XpPop({ initialXpTotal }: XpPopProps) {
  const prevTotalRef = useRef(initialXpTotal);
  const [gain, setGain] = useState<number | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = prefersReducedMotion();

    function onXp(e: Event) {
      const next = (e as CustomEvent<number>).detail;
      if (typeof next !== 'number') return;
      const delta = xpDelta(prevTotalRef.current, next);
      prevTotalRef.current = next;
      if (delta <= 0) return;
      setGain(delta);
      const hold = motionDurationMs(1500, reducedRef.current) || 1200;
      const t = window.setTimeout(() => setGain(null), hold);
      return () => window.clearTimeout(t);
    }

    window.addEventListener(XP_EVENT, onXp);
    return () => window.removeEventListener(XP_EVENT, onXp);
  }, []);

  if (gain === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="xp-pop"
      className="pointer-events-none fixed bottom-6 right-6 z-50 animate-[xppop_300ms_ease-out] rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg"
    >
      +{gain} XP
    </div>
  );
}
```

- [ ] **Step 2: Add the `xppop` keyframe to globals.css**

Append to `app/globals.css`:

```css
@keyframes xppop {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.95);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-\[xppop_300ms_ease-out\] {
    animation: none;
  }
}
```

- [ ] **Step 3: Mount XpPop in the shell layout**

In `app/(shell)/layout.tsx`, add the import and render it inside the content column (within the `curriculumDir` branch, so it has the server XP baseline):

```tsx
// add import at top
import XpPop from '@/components/XpPop';
```

Change the returned JSX of the `curriculumDir`-present branch to:

```tsx
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar groups={groups} />
      <div className="min-w-0 flex-1">{children}</div>
      <XpPop initialXpTotal={state.xp.total} />
    </div>
  );
```

- [ ] **Step 4: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 5: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/components/XpPop.tsx app/globals.css "app/(shell)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(v1a): XP-pop toast driven by pure xpDelta + window event

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Level-up flourish — fires when a module reaches `verified`

**Files:**
- Create: `src/components/LevelUpFlourish.tsx`
- Modify: `app/(shell)/layout.tsx` (mount `<LevelUpFlourish initialMastery={...} />`)

Mirrors `XpPop` but for the level-up moment. It holds the server-known mastery snapshot at mount and listens for a `llmtutor:mastery` window event whose detail is the new `Record<moduleId, Mastery>` snapshot; it runs the pure `modulesReachingVerified` detector and, if any module just hit `verified`, shows a celebratory flourish naming the module(s). Auto-dismisses; reduced-motion safe.

- [ ] **Step 1: Build the initial mastery snapshot in the shell layout and pass it down**

In `app/(shell)/layout.tsx`, after `buildSidebarModel`, derive a flat snapshot and pass it to the new component. Add:

```tsx
// add import at top
import LevelUpFlourish from '@/components/LevelUpFlourish';
import type { Mastery } from '@/lib/types';
```

Inside the `curriculumDir`-present branch, before the `return`, compute:

```tsx
  const masterySnapshot: Record<string, Mastery> = {};
  for (const m of curriculum.modules) {
    masterySnapshot[m.id] = state.modules[m.id]?.mastery ?? 'blank';
  }
```

And add `<LevelUpFlourish initialMastery={masterySnapshot} />` next to `<XpPop ... />`:

```tsx
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar groups={groups} />
      <div className="min-w-0 flex-1">{children}</div>
      <XpPop initialXpTotal={state.xp.total} />
      <LevelUpFlourish initialMastery={masterySnapshot} />
    </div>
  );
```

- [ ] **Step 2: Write the component**

```tsx
// src/components/LevelUpFlourish.tsx
// Celebratory "level up" moment when a module transitions INTO 'verified'.
// Decoupled like XpPop: listens for a window CustomEvent `llmtutor:mastery`
// whose detail is the new Record<moduleId, Mastery> snapshot, then uses the
// pure modulesReachingVerified detector (tested) to decide whether to fire.
// Any client code that advances mastery can dispatch the new snapshot:
//   window.dispatchEvent(new CustomEvent('llmtutor:mastery', { detail: snapshot }))
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Mastery } from '@/lib/types';
import { modulesReachingVerified } from '@/lib/ui/juice';
import { motionDurationMs, prefersReducedMotion } from '@/lib/ui/motion';

export const MASTERY_EVENT = 'llmtutor:mastery';

interface LevelUpFlourishProps {
  /** Server-known mastery snapshot at mount; baseline for transition detection. */
  initialMastery: Record<string, Mastery>;
}

export default function LevelUpFlourish({ initialMastery }: LevelUpFlourishProps) {
  const prevRef = useRef<Record<string, Mastery>>(initialMastery);
  const [verifiedIds, setVerifiedIds] = useState<string[] | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = prefersReducedMotion();

    function onMastery(e: Event) {
      const next = (e as CustomEvent<Record<string, Mastery>>).detail;
      if (!next || typeof next !== 'object') return;
      const advanced = modulesReachingVerified(prevRef.current, next);
      prevRef.current = next;
      if (advanced.length === 0) return;
      setVerifiedIds(advanced);
      const hold = motionDurationMs(2200, reducedRef.current) || 1500;
      const t = window.setTimeout(() => setVerifiedIds(null), hold);
      return () => window.clearTimeout(t);
    }

    window.addEventListener(MASTERY_EVENT, onMastery);
    return () => window.removeEventListener(MASTERY_EVENT, onMastery);
  }, []);

  if (!verifiedIds || verifiedIds.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="level-up-flourish"
      className="pointer-events-none fixed inset-x-0 top-10 z-50 flex justify-center"
    >
      <div className="animate-[levelup_500ms_ease-out] rounded-xl border border-emerald-300 bg-white px-6 py-4 text-center shadow-2xl">
        <div className="text-2xl">🎉</div>
        <div className="mt-1 text-sm font-semibold text-emerald-700">
          {verifiedIds.length === 1
            ? `Module ${verifiedIds[0]} verified!`
            : `${verifiedIds.length} modules verified!`}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the `levelup` keyframe to globals.css**

Append to `app/globals.css`:

```css
@keyframes levelup {
  0% {
    opacity: 0;
    transform: translateY(-12px) scale(0.92);
  }
  60% {
    transform: translateY(0) scale(1.04);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-\[levelup_500ms_ease-out\] {
    animation: none;
  }
}
```

- [ ] **Step 4: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 5: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/components/LevelUpFlourish.tsx app/globals.css "app/(shell)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(v1a): level-up flourish driven by pure verified-transition detector

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Smooth route transition + TopBar in shell

**Files:**
- Create: `src/components/RouteTransition.tsx`
- Modify: `app/(shell)/layout.tsx` (wrap `{children}` in `<RouteTransition>`)

A thin client wrapper that cross-fades content when the route changes, keyed on `usePathname`. The fade animation is CSS-only and disabled under reduced motion (via the same media query in globals.css). This satisfies "smooth content transition between routes" without route-group-level template files. The existing per-page TopBar stays as-is on each page; the shell does not duplicate it (each page already renders its own `<TopBar>` with the correct streak/due/XP — moving TopBar into the shell would require re-plumbing those props and is out of scope).

- [ ] **Step 1: Write the component**

```tsx
// src/components/RouteTransition.tsx
// Cross-fades content on route change. Keyed on the pathname so React remounts
// the wrapper (re-running the entry animation) each navigation. CSS-only; the
// reduced-motion media query in globals.css disables the animation. Thin shell —
// no logic beyond reading the current path.
'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export default function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-[routefade_250ms_ease-out]">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Add the `routefade` keyframe to globals.css**

Append to `app/globals.css`:

```css
@keyframes routefade {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-\[routefade_250ms_ease-out\] {
    animation: none;
  }
}
```

- [ ] **Step 3: Wrap children in the shell layout**

In `app/(shell)/layout.tsx`, add the import and wrap `{children}`:

```tsx
// add import at top
import RouteTransition from '@/components/RouteTransition';
```

Change the content column in the `curriculumDir`-present branch:

```tsx
      <div className="min-w-0 flex-1">
        <RouteTransition>{children}</RouteTransition>
      </div>
```

(Leave the no-curriculum branch returning bare `{children}` — no sidebar, no transition needed for the empty state.)

- [ ] **Step 4: Full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 5: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/components/RouteTransition.tsx app/globals.css "app/(shell)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat(v1a): CSS route cross-fade transition in the app shell

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Manual smoke verification + final gate

**Files:** none (verification only).

Confirm the shell renders, the sidebar lists modules with rings, navigation works, and reduced-motion is honored — against a real curriculum dir if available, else just the build.

- [ ] **Step 1: Final full green gate**

Run: `cd /Users/unmukt/llm-tutor && npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four succeed.

- [ ] **Step 2: Manual smoke (only if a curriculum dir is available)**

Run (substitute the real curriculum path):

```bash
cd /Users/unmukt/llm-tutor && CURRICULUM_DIR=/absolute/path/to/curriculum npm run dev
```

Then in the browser:
- Visit `/` — sidebar appears on the left, grouped by Track A/B, each module showing a ring; the home journey map still renders to the right.
- Click a module — navigates to `/module/<id>`, the sidebar row highlights as active, content cross-fades in.
- Visit `/module/<id>/assess` and `/flashcards` — both render inside the shell.
- Toggle the collapse button — sidebar shrinks to the icon rail; reload — collapsed state persists.
- In OS settings enable "reduce motion" — rings/toasts no longer animate; reload to confirm.

Expected: all behaviors as described. (If no curriculum dir is available, the unset-guard path renders children without a sidebar — that is the documented empty state, not a failure.)

- [ ] **Step 3: Confirm the working tree is clean (all work committed)**

Run: `cd /Users/unmukt/llm-tutor && git status --porcelain`
Expected: empty output (nothing uncommitted).

---

## Self-Review

**1. Spec coverage (V1 spec §1 V-NAV):**
- ProgressRing (pure prop-driven SVG, mastery→fraction+color, animated, open-diagnosis state, tested mapping helper) → Tasks 1, 2, 6. ✓
- Sidebar (all modules grouped by Track A/B, name + ring + active highlight, click→`/module/<id>`, collapsible + localStorage, mastery from TutorState via server props) → Tasks 5, 7, 8. ✓
- App shell (persistent sidebar+content, server layout loads curriculum+state once, keeps existing routes working + building) → Task 8; TopBar retained per-page (Task 11 note). ✓
- Juice (animated ring fill → Task 6; XP-pop → Task 9; level-up flourish → Task 10; route transition → Task 11; prefers-reduced-motion gate → Task 3, applied in 6/9/10/11). ✓
- Pure logic in tested helpers: ring mapping (1), ring geometry (2), reduced-motion gate (3), juice detectors (4), sidebar model (5). ✓
- Light-deps / CSS-first, framer-motion only if justified → Task 0 records the decision NOT to add it. ✓
- Every task ends green (test+typecheck+lint+build) + commit with the trailer. ✓

**2. Placeholder scan:** No "TBD"/"add error handling"/"write tests for the above"/"similar to Task N". Every code step shows complete code; every command shows expected output. ✓

**3. Type consistency:** `Mastery`, `Module`, `Curriculum`, `TutorState`, `TrackId` taken verbatim from `@/lib/types`. `RingVisual.fraction/color/label`, `RingGeometry.circumference/dashOffset`, `SidebarRow`/`SidebarGroup`, `xpDelta`/`modulesReachingVerified`, `animationEnabled`/`motionDurationMs`/`prefersReducedMotion`, event names `XP_EVENT`/`MASTERY_EVENT` are used consistently across the tasks that consume them. The shell layout passes `groups`, `initialXpTotal`, `initialMastery` matching each component's props. ✓
