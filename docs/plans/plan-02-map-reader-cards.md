# S-MAP + S-READER + S-CARDS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three visible product surfaces — the React Flow journey map (S-MAP), the module reader with 3-pass depth toggle and diagram rendering (S-READER), and the flashcard spaced-repetition review UI (S-CARDS) — all reading/writing state exclusively through the plan-01 `StateStore` API via `/api/state`.

**Architecture:** All three surfaces are Next.js App Router pages/components backed by server-side `CurriculumRepository` reads and a thin `/api/state` GET/PATCH route that wraps `StateStore`. Presentational components receive typed props; all derivation logic (map node/edge computation, depth-pass selection, flashcard due-card filtering, SR interval update) lives in pure helper functions in `src/lib/` that are Vitest-tested against fixtures. React components stay thin — they only bind UI events to these helpers and fire API calls.

**Tech Stack:** Next.js 14+ App Router · TypeScript (strict) · `@xyflow/react` (React Flow v12) · `mermaid` · `shiki` · Vitest · `gray-matter` (already in plan-01) · `src/lib/types.ts` + `CurriculumRepository` + `StateStore` from plan-01

---

## Pre-conditions (plan-01 must exist)

This plan assumes plan-01 has already been implemented and the following exist and pass tests:

- `src/lib/types.ts` — exports all types from `00-shared-model.md` including `Module`, `Curriculum`, `CurriculumRepository`, `TutorState`, `ModuleState`, `FlashcardState`, `StateStore`, `Mastery`, `DepthPass`
- `src/lib/ingest/` — implements `CurriculumRepository` with a `load(dir)` method
- `src/lib/state/` — implements `StateStore` (JSON sidecar, atomic write, `read()`, `write()`, `getModule()`)
- `app/api/state/route.ts` — exposes GET and PATCH (or PUT) over HTTP wrapping `StateStore`
- Vitest configured (`vitest.config.ts`), `npm test` works
- `npm run dev` starts the Next.js dev server

**Assumption about `/api/state`:** plan-01 exposes:
- `GET /api/state` → `TutorState` (full sidecar)
- `PATCH /api/state` → body `{ path: string[]; value: unknown }` → applies a deep-set and atomically writes; returns updated `TutorState`

If plan-01 used a different PATCH shape, adjust the helpers in Task 3 and Task 8 to match — the shape is pinned in `src/lib/api-client.ts` (Task 1) so there is one place to change.

---

## File map

```
src/lib/
  api-client.ts                    ← NEW: thin fetch wrappers for /api/state (GET + PATCH)
  map/
    derive-nodes-edges.ts           ← NEW: pure fn: Curriculum + TutorState → nodes + edges (React Flow)
    __tests__/
      derive-nodes-edges.test.ts    ← NEW: Vitest tests
  reader/
    select-pass.ts                  ← NEW: pure fn: depth label → DepthPass key + "not authored" guard
    __tests__/
      select-pass.test.ts           ← NEW: Vitest tests
  cards/
    parse-flashcards.ts             ← NEW: pure fn: _flashcards.md string → Flashcard[]
    due-cards.ts                    ← NEW: pure fn: Flashcard[] + FlashcardState map + now → DueCard[]
    sr-update.ts                    ← NEW: pure fn: DueCard + 'good'|'again' → FlashcardState delta
    __tests__/
      parse-flashcards.test.ts      ← NEW: Vitest tests
      due-cards.test.ts             ← NEW: Vitest tests
      sr-update.test.ts             ← NEW: Vitest tests

components/
  JourneyMap.tsx                    ← NEW: React Flow client component (receives nodes/edges as props)
  TopBar.tsx                        ← NEW: streak / due-card count / weekly XP
  DepthToggle.tsx                   ← NEW: 3-button toggle; emits DepthPass
  DiagramPane.tsx                   ← NEW: mermaid + shiki renderer (client component)
  FlashcardReview.tsx               ← NEW: card deck UI; SR self-graded recall

app/
  page.tsx                          ← NEW: journey map home (server component; derives nodes/edges server-side)
  module/[id]/
    page.tsx                        ← NEW: reader (server component; loads module + state)
  flashcards/
    page.tsx                        ← NEW: flashcard review page (server component; loads due cards)
```

---

## Task 1: Add deps + API client

**Files:**
- Modify: `package.json`
- Create: `src/lib/api-client.ts`

- [ ] **Step 1: Install React Flow, mermaid, and shiki**

```bash
cd /Users/unmukt/llm-tutor
npm install @xyflow/react mermaid shiki
```

Expected: all three packages appear in `package.json` `dependencies`. No peer-dep errors.

- [ ] **Step 2: Write the API client**

Create `src/lib/api-client.ts`:

```typescript
// src/lib/api-client.ts
// Thin fetch wrappers for /api/state — used by client components only.
// Server components call StateStore directly; never import this from server code.

import type { TutorState } from './types';

const BASE = '/api/state';

/** Fetch the full TutorState from the sidecar. */
export async function fetchState(): Promise<TutorState> {
  const res = await fetch(BASE, { cache: 'no-store' });
  if (!res.ok) throw new Error(`fetchState: ${res.status} ${res.statusText}`);
  return res.json() as Promise<TutorState>;
}

/**
 * Apply a deep patch to the sidecar.
 * `path` is an array of keys, e.g. ['modules', 'B01', 'mastery'].
 * `value` is the new value at that path.
 * Returns the updated TutorState.
 */
export async function patchState(path: string[], value: unknown): Promise<TutorState> {
  const res = await fetch(BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, value }),
  });
  if (!res.ok) throw new Error(`patchState: ${res.status} ${res.statusText}`);
  return res.json() as Promise<TutorState>;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors. (If `TutorState` isn't yet exported by `src/lib/types.ts`, fix the import path to wherever plan-01 placed it — do not redefine the type.)

- [ ] **Step 4: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add package.json package-lock.json src/lib/api-client.ts
git commit -m "feat(deps): add @xyflow/react, mermaid, shiki; add api-client fetch wrappers"
```

---

## Task 2: Map node/edge derivation (pure logic, tested first)

**Files:**
- Create: `src/lib/map/derive-nodes-edges.ts`
- Create: `src/lib/map/__tests__/derive-nodes-edges.test.ts`

The derivation is pure: given a `Curriculum` and a `TutorState`, produce a React Flow `Node[]` and `Edge[]`. This is the only logic that needs testing — the React component that renders them stays thin.

### Node color by mastery

| mastery | color token |
|---|---|
| `blank` | `#e2e8f0` (slate-200) |
| `fuzzy` | `#fef9c3` (yellow-100) |
| `solid` | `#bbf7d0` (green-200) |
| `verified` | `#6ee7b7` (emerald-300) |

### Lane layout (two tracks)

Track A nodes: `position.x = 80`, `position.y = nodeIndex * 120`  
Track B nodes: `position.x = 400`, `position.y = nodeIndex * 120`  
Track C (if present): `position.x = 720`, `position.y = nodeIndex * 120`

"nodeIndex" = position within that track's ordered list (from `Curriculum.modules` filtered by `track`).

### Edges

One edge per entry in `module.prerequisites`. `id = "${prereqId}->${module.id}"`, `source = prereqId`, `target = module.id`, `type = 'default'`, `style = { stroke: '#94a3b8', strokeDasharray: '5 5' }` (soft/dashed).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/map/__tests__/derive-nodes-edges.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveNodesEdges } from '../derive-nodes-edges';
import type { Curriculum, Module, TutorState } from '../../types';

// Minimal fixture factory
function makeModule(overrides: Partial<Module> & { id: string; track: 'A' | 'B' | 'C' }): Module {
  return {
    id: overrides.id,
    track: overrides.track,
    name: overrides.name ?? `Module ${overrides.id}`,
    prerequisites: overrides.prerequisites ?? [],
    primarySources: [],
    whyThisMatters: 'why',
    anchors: [],
    passes: {},
    diagrams: [],
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}

function makeCurriculum(modules: Module[]): Curriculum {
  return {
    tracks: ['A', 'B'],
    modules,
    byId: (id) => modules.find((m) => m.id === id),
  };
}

function makeState(moduleEntries: Record<string, { mastery: string }>): TutorState {
  return {
    version: 1,
    modules: Object.fromEntries(
      Object.entries(moduleEntries).map(([id, { mastery }]) => [
        id,
        {
          mastery: mastery as any,
          masteryHistory: [],
          mcq: {
            matrix: {},
            distractorLog: [],
            dimensionProfile: {
              topic: 'untested',
              logic: 'untested',
              example: 'untested',
              extension: 'untested',
            },
          },
          stressTest: {},
        },
      ])
    ),
    flashcards: {},
    xp: { total: 0, thisWeek: 0 },
    streak: { count: 0, lastActive: '', freezeTokens: 0 },
    sessionLog: [],
  };
}

describe('deriveNodesEdges', () => {
  it('produces one node per module', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B' }),
    ]);
    const state = makeState({ A01: { mastery: 'blank' }, B01: { mastery: 'fuzzy' } });
    const { nodes } = deriveNodesEdges(curriculum, state);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['A01', 'B01']));
  });

  it('colors nodes by mastery', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'A02', track: 'A' }),
      makeModule({ id: 'A03', track: 'A' }),
      makeModule({ id: 'A04', track: 'A' }),
    ]);
    const state = makeState({
      A01: { mastery: 'blank' },
      A02: { mastery: 'fuzzy' },
      A03: { mastery: 'solid' },
      A04: { mastery: 'verified' },
    });
    const { nodes } = deriveNodesEdges(curriculum, state);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['A01'].style?.background).toBe('#e2e8f0');
    expect(byId['A02'].style?.background).toBe('#fef9c3');
    expect(byId['A03'].style?.background).toBe('#bbf7d0');
    expect(byId['A04'].style?.background).toBe('#6ee7b7');
  });

  it('places track A nodes at x=80, track B at x=400', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B' }),
    ]);
    const state = makeState({ A01: { mastery: 'blank' }, B01: { mastery: 'blank' } });
    const { nodes } = deriveNodesEdges(curriculum, state);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['A01'].position.x).toBe(80);
    expect(byId['B01'].position.x).toBe(400);
  });

  it('stacks nodes vertically within each track at 120px intervals', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'A02', track: 'A' }),
    ]);
    const state = makeState({ A01: { mastery: 'blank' }, A02: { mastery: 'blank' } });
    const { nodes } = deriveNodesEdges(curriculum, state);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['A01'].position.y).toBe(0);
    expect(byId['A02'].position.y).toBe(120);
  });

  it('produces dashed edges for prerequisites', () => {
    const curriculum = makeCurriculum([
      makeModule({ id: 'A01', track: 'A' }),
      makeModule({ id: 'B01', track: 'B', prerequisites: ['A01'] }),
    ]);
    const state = makeState({ A01: { mastery: 'blank' }, B01: { mastery: 'blank' } });
    const { edges } = deriveNodesEdges(curriculum, state);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe('A01->B01');
    expect(edges[0].source).toBe('A01');
    expect(edges[0].target).toBe('B01');
    expect(edges[0].style?.strokeDasharray).toBe('5 5');
  });

  it('produces no edges when no prerequisites', () => {
    const curriculum = makeCurriculum([makeModule({ id: 'A01', track: 'A' })]);
    const state = makeState({ A01: { mastery: 'blank' } });
    const { edges } = deriveNodesEdges(curriculum, state);
    expect(edges).toHaveLength(0);
  });

  it('defaults to blank color for a module with no state entry', () => {
    const curriculum = makeCurriculum([makeModule({ id: 'A01', track: 'A' })]);
    // state has no entry for A01
    const state = makeState({});
    const { nodes } = deriveNodesEdges(curriculum, state);
    expect(nodes[0].style?.background).toBe('#e2e8f0');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/map/__tests__/derive-nodes-edges.test.ts
```

Expected: `FAIL` — "Cannot find module '../derive-nodes-edges'"

- [ ] **Step 3: Implement `deriveNodesEdges`**

Create `src/lib/map/derive-nodes-edges.ts`:

```typescript
// src/lib/map/derive-nodes-edges.ts
// Pure derivation: Curriculum + TutorState → React Flow nodes + edges.
// No React import — this is plain TS so it is testable with Vitest.

import type { Curriculum, TutorState, Mastery } from '../types';

export interface MapNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label: string; mastery: Mastery };
  style?: Record<string, string | number>;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  style?: Record<string, string | number>;
}

const MASTERY_COLOR: Record<Mastery, string> = {
  blank: '#e2e8f0',
  fuzzy: '#fef9c3',
  solid: '#bbf7d0',
  verified: '#6ee7b7',
};

const TRACK_X: Record<string, number> = {
  A: 80,
  B: 400,
  C: 720,
};

export function deriveNodesEdges(
  curriculum: Curriculum,
  state: TutorState
): { nodes: MapNode[]; edges: MapEdge[] } {
  // Index position within each track
  const trackIndex: Record<string, number> = {};

  const nodes: MapNode[] = curriculum.modules.map((mod) => {
    const track = mod.track;
    const idx = trackIndex[track] ?? 0;
    trackIndex[track] = idx + 1;

    const mastery: Mastery = state.modules[mod.id]?.mastery ?? 'blank';

    return {
      id: mod.id,
      position: { x: TRACK_X[track] ?? 80, y: idx * 120 },
      data: { label: mod.name, mastery },
      style: { background: MASTERY_COLOR[mastery], borderRadius: 8, padding: 8 },
    };
  });

  const edges: MapEdge[] = [];
  for (const mod of curriculum.modules) {
    for (const prereqId of mod.prerequisites) {
      edges.push({
        id: `${prereqId}->${mod.id}`,
        source: prereqId,
        target: mod.id,
        type: 'default',
        style: { stroke: '#94a3b8', strokeDasharray: '5 5' },
      });
    }
  }

  return { nodes, edges };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/map/__tests__/derive-nodes-edges.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/map/derive-nodes-edges.ts src/lib/map/__tests__/derive-nodes-edges.test.ts
git commit -m "feat(s-map): add deriveNodesEdges pure helper + Vitest tests"
```

---

## Task 3: TopBar component (streak / due-card count / weekly XP)

**Files:**
- Create: `components/TopBar.tsx`
- Create: `src/lib/cards/due-cards.ts` (needed for the count — built fully in Task 7; for now just the signature and the count helper used by TopBar)

TopBar is a purely presentational server component — it receives pre-computed props so it has no data-fetching logic and no tests needed. The due-card count is derived server-side (loaded from sidecar + `_flashcards.md`) and passed as a prop.

- [ ] **Step 1: Create TopBar component**

Create `components/TopBar.tsx`:

```tsx
// components/TopBar.tsx
// Purely presentational. Receives computed values from the server component.
// Renders streak, due-card count, and weekly XP in a top bar.

interface TopBarProps {
  streak: number;
  dueCardCount: number;
  weeklyXp: number;
}

export default function TopBar({ streak, dueCardCount, weeklyXp }: TopBarProps) {
  return (
    <header className="flex items-center gap-6 px-6 py-3 border-b border-slate-200 bg-white text-sm font-medium text-slate-700">
      <span title="Day streak">🔥 {streak} day{streak !== 1 ? 's' : ''}</span>
      <span title="Flashcards due">📚 {dueCardCount} due</span>
      <span title="XP this week">⚡ {weeklyXp} XP this week</span>
    </header>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add components/TopBar.tsx
git commit -m "feat(s-map): add TopBar presentational component"
```

---

## Task 4: JourneyMap React Flow component

**Files:**
- Create: `components/JourneyMap.tsx`

This is a client component (React Flow requires browser APIs). It receives pre-computed `MapNode[]` and `MapEdge[]` as props (derived server-side in Task 2) so it has no business logic.

- [ ] **Step 1: Create JourneyMap component**

Create `components/JourneyMap.tsx`:

```tsx
// components/JourneyMap.tsx
// Client component: renders the React Flow journey map.
// Receives nodes + edges derived server-side — no business logic here.
'use client';

import { useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MapNode, MapEdge } from '@/src/lib/map/derive-nodes-edges';

interface JourneyMapProps {
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
  onNodeClick?: (moduleId: string) => void;
}

export default function JourneyMap({ initialNodes, initialEdges, onNodeClick }: JourneyMapProps) {
  // useNodesState / useEdgesState allow React Flow to manage drag positions locally.
  // We cast to any because MapNode/MapEdge are our plain-TS types; React Flow's
  // Node/Edge types require a generic param — plain-TS props match the shape at runtime.
  const [nodes, , onNodesChange] = useNodesState(initialNodes as any);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges as any);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      onNodeClick?.(node.id);
    },
    [onNodeClick]
  );

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors. (If `@xyflow/react` types are missing, run `npm install --save-dev @types/reactflow` — though v12 ships its own types; check the installed version first.)

- [ ] **Step 3: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add components/JourneyMap.tsx
git commit -m "feat(s-map): add JourneyMap React Flow client component"
```

---

## Task 5: Journey map home page (`app/page.tsx`)

**Files:**
- Create: `app/page.tsx`

This is a server component. It:
1. Loads the curriculum via `CurriculumRepository`
2. Reads the sidecar via `StateStore`
3. Counts due cards (using a helper from Task 7 — see note below)
4. Derives nodes + edges with `deriveNodesEdges`
5. Passes everything as props to `JourneyMap` + `TopBar`

**Note:** The `countDueCards` helper is built fully in Task 7. For now, write a local stub inline that returns `0` — you will replace it in Task 7 Step 4 with a real import. This lets the page compile and render immediately.

- [ ] **Step 1: Create the home page**

Create `app/page.tsx`:

```tsx
// app/page.tsx
// Server component: journey map home.
// Loads curriculum + state server-side; passes pre-computed props to client components.

import { redirect } from 'next/navigation';
import TopBar from '@/components/TopBar';
import JourneyMap from '@/components/JourneyMap';
import { deriveNodesEdges } from '@/src/lib/map/derive-nodes-edges';
// These are the plan-01 exports — adjust import path if plan-01 placed them differently.
import { getCurriculumRepository } from '@/src/lib/ingest';
import { getStateStore } from '@/src/lib/state';

// Stub: replaced in Task 7 Step 4 with real import from src/lib/cards/due-cards.ts
function stubCountDueCards(): number {
  return 0;
}

export default async function HomePage() {
  const curriculumDir = process.env.CURRICULUM_DIR;
  if (!curriculumDir) {
    throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  }

  const repo = getCurriculumRepository();
  const store = getStateStore(curriculumDir);

  const [curriculum, state] = await Promise.all([
    repo.load(curriculumDir),
    store.read(),
  ]);

  const { nodes, edges } = deriveNodesEdges(curriculum, state);

  const dueCardCount = stubCountDueCards();

  return (
    <main className="min-h-screen bg-slate-50">
      <TopBar
        streak={state.streak.count}
        dueCardCount={dueCardCount}
        weeklyXp={state.xp.thisWeek}
      />
      <div className="p-4">
        <h1 className="text-xl font-semibold text-slate-800 mb-4">LLM Tutor — Journey Map</h1>
        <JourneyMap
          initialNodes={nodes}
          initialEdges={edges}
          // Navigate to the module reader on node click — handled client-side
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the page compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors. If `getCurriculumRepository` or `getStateStore` aren't the names plan-01 exported, adjust the import — the important thing is to call plan-01's public API, not reimplement it.

- [ ] **Step 3: Smoke-test in the browser**

```bash
cd /Users/unmukt/llm-tutor && CURRICULUM_DIR=/path/to/your/curriculum npm run dev
```

Open `http://localhost:3000`. Expected: top bar shows streak/XP (0 if no state yet), React Flow canvas renders (empty or with nodes from curriculum). No JS console errors about missing modules.

- [ ] **Step 4: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add app/page.tsx
git commit -m "feat(s-map): add journey map home page (server component)"
```

---

## Task 6: Depth-pass selection helper + DepthToggle component (S-READER)

**Files:**
- Create: `src/lib/reader/select-pass.ts`
- Create: `src/lib/reader/__tests__/select-pass.test.ts`
- Create: `components/DepthToggle.tsx`

The depth-pass logic is pure: given a button label and a `Module`, return the `DepthPass` key and whether that pass is authored. All logic is tested; the component is just a button group.

### Depth label → DepthPass key mapping

| Button label | DepthPass key |
|---|---|
| `Dumb it down` | `tenYearOld` |
| `Engineer` | `engineer` (DEFAULT) |
| `Make it matter` | `operator` |

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reader/__tests__/select-pass.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolvePass, DEPTH_OPTIONS } from '../select-pass';
import type { Module } from '../../types';

function makeModule(passes: Partial<Record<string, string>>): Module {
  return {
    id: 'T01',
    track: 'A',
    name: 'Test',
    prerequisites: [],
    primarySources: [],
    whyThisMatters: 'matters',
    anchors: [],
    passes: passes as any,
    diagrams: [],
    drills: [],
    stressTests: [],
    flashcardSeeds: [],
    sources: [],
  };
}

describe('DEPTH_OPTIONS', () => {
  it('has three options in order: Dumb it down, Engineer, Make it matter', () => {
    expect(DEPTH_OPTIONS.map((o) => o.label)).toEqual([
      'Dumb it down',
      'Engineer',
      'Make it matter',
    ]);
  });

  it('maps labels to correct DepthPass keys', () => {
    const byLabel = Object.fromEntries(DEPTH_OPTIONS.map((o) => [o.label, o.key]));
    expect(byLabel['Dumb it down']).toBe('tenYearOld');
    expect(byLabel['Engineer']).toBe('engineer');
    expect(byLabel['Make it matter']).toBe('operator');
  });

  it('marks Engineer as the default', () => {
    const def = DEPTH_OPTIONS.find((o) => o.isDefault);
    expect(def?.key).toBe('engineer');
  });
});

describe('resolvePass', () => {
  it('returns authored content when pass is present', () => {
    const mod = makeModule({ engineer: '# Engineer content' });
    const result = resolvePass(mod, 'engineer');
    expect(result.authored).toBe(true);
    expect(result.content).toBe('# Engineer content');
  });

  it('returns authored=false when pass is absent', () => {
    const mod = makeModule({});
    const result = resolvePass(mod, 'tenYearOld');
    expect(result.authored).toBe(false);
    expect(result.content).toBeUndefined();
  });

  it('returns authored=false when pass is empty string', () => {
    const mod = makeModule({ operator: '' });
    const result = resolvePass(mod, 'operator');
    expect(result.authored).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/reader/__tests__/select-pass.test.ts
```

Expected: FAIL — "Cannot find module '../select-pass'"

- [ ] **Step 3: Implement `select-pass.ts`**

Create `src/lib/reader/select-pass.ts`:

```typescript
// src/lib/reader/select-pass.ts
// Pure helpers for depth-pass resolution.

import type { DepthPass, Module } from '../types';

export interface DepthOption {
  label: 'Dumb it down' | 'Engineer' | 'Make it matter';
  key: DepthPass;
  isDefault: boolean;
}

export const DEPTH_OPTIONS: DepthOption[] = [
  { label: 'Dumb it down', key: 'tenYearOld', isDefault: false },
  { label: 'Engineer',      key: 'engineer',   isDefault: true  },
  { label: 'Make it matter', key: 'operator',  isDefault: false },
];

export interface ResolvedPass {
  key: DepthPass;
  authored: boolean;
  content?: string;
}

/**
 * Resolve a DepthPass key against a Module.
 * Returns { authored: true, content } if the pass is present and non-empty,
 * { authored: false } otherwise — the caller should surface a clear
 * "this depth not authored yet" state (do NOT generate with LLM in MVP).
 */
export function resolvePass(mod: Module, key: DepthPass): ResolvedPass {
  const content = mod.passes[key];
  if (content && content.trim().length > 0) {
    return { key, authored: true, content };
  }
  return { key, authored: false };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/reader/__tests__/select-pass.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Create DepthToggle component**

Create `components/DepthToggle.tsx`:

```tsx
// components/DepthToggle.tsx
// Three-button toggle for depth pass selection.
// Purely presentational — receives current key + onChange callback.
'use client';

import { DEPTH_OPTIONS } from '@/src/lib/reader/select-pass';
import type { DepthPass } from '@/src/lib/types';

interface DepthToggleProps {
  current: DepthPass;
  onChange: (key: DepthPass) => void;
}

export default function DepthToggle({ current, onChange }: DepthToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
      {DEPTH_OPTIONS.map(({ label, key }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-4 py-2 transition-colors ${
            current === key
              ? 'bg-slate-800 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/reader/select-pass.ts src/lib/reader/__tests__/select-pass.test.ts components/DepthToggle.tsx
git commit -m "feat(s-reader): add resolvePass helper + DepthToggle component"
```

---

## Task 7: Flashcard parser + due-card logic (S-CARDS, pure logic)

**Files:**
- Create: `src/lib/cards/parse-flashcards.ts`
- Create: `src/lib/cards/due-cards.ts`
- Create: `src/lib/cards/sr-update.ts`
- Create: `src/lib/cards/__tests__/parse-flashcards.test.ts`
- Create: `src/lib/cards/__tests__/due-cards.test.ts`
- Create: `src/lib/cards/__tests__/sr-update.test.ts`

### `_flashcards.md` format

The build-spec says cards are seeded from `## Flashcard seeds` sections. The `llm-deep-dive` skill appends them to `_flashcards.md`. Assume the file format is:

```markdown
<!-- card: B01-c01 module:B01 last-tested:2026-05-20 -->
**Front:** What is the role of a harness in LLM eval?
**Back:** It controls the prompt format, execution, scoring, and logging — the scaffold around the eval itself.

<!-- card: B01-c02 module:B01 last-tested:2026-05-14 -->
**Front:** Name two sources of eval contamination.
**Back:** Training-data leakage and benchmark-specific fine-tuning (overfitting to the test split).
```

Each card block starts with an HTML comment `<!-- card: <id> module:<moduleId> last-tested:<YYYY-MM-DD> -->` (the `last-tested` date may be absent for never-tested cards). The next non-blank line is the front (`**Front:** ...`), then the back (`**Back:** ...`).

- [ ] **Step 1: Write failing tests for the parser**

Create `src/lib/cards/__tests__/parse-flashcards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseFlashcards } from '../parse-flashcards';

const SAMPLE = `
<!-- card: B01-c01 module:B01 last-tested:2026-05-20 -->
**Front:** What is a harness?
**Back:** The scaffold around the eval.

<!-- card: B01-c02 module:B01 -->
**Front:** Name two contamination sources.
**Back:** Training leakage and benchmark overfitting.

<!-- card: M03-c01 module:M03 last-tested:2026-01-10 -->
**Front:** Define attention.
**Back:** Weighted sum over value vectors.
`.trim();

describe('parseFlashcards', () => {
  it('parses the correct number of cards', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards).toHaveLength(3);
  });

  it('extracts id and moduleId', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].id).toBe('B01-c01');
    expect(cards[0].moduleId).toBe('B01');
    expect(cards[1].id).toBe('B01-c02');
    expect(cards[1].moduleId).toBe('B01');
  });

  it('extracts front and back text', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].front).toBe('What is a harness?');
    expect(cards[0].back).toBe('The scaffold around the eval.');
  });

  it('parses lastTested date when present', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[0].lastTested).toBe('2026-05-20');
  });

  it('sets lastTested to null when absent', () => {
    const cards = parseFlashcards(SAMPLE);
    expect(cards[1].lastTested).toBeNull();
  });

  it('returns empty array for empty input', () => {
    expect(parseFlashcards('')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run parser tests — expect FAIL**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/cards/__tests__/parse-flashcards.test.ts
```

Expected: FAIL — "Cannot find module '../parse-flashcards'"

- [ ] **Step 3: Implement `parse-flashcards.ts`**

Create `src/lib/cards/parse-flashcards.ts`:

```typescript
// src/lib/cards/parse-flashcards.ts
// Parses the _flashcards.md file into typed Flashcard objects.
// Does NOT read files — caller passes the raw string (keeps this pure + testable).

export interface Flashcard {
  id: string;
  moduleId: string;
  lastTested: string | null;   // ISO date string or null if never tested
  front: string;
  back: string;
}

// Matches lines like: <!-- card: B01-c01 module:B01 last-tested:2026-05-20 -->
const CARD_HEADER = /<!--\s*card:\s*(\S+)\s+module:(\S+)(?:\s+last-tested:(\S+))?\s*-->/;
const FRONT_LINE  = /^\*\*Front:\*\*\s*(.+)$/;
const BACK_LINE   = /^\*\*Back:\*\*\s*(.+)$/;

export function parseFlashcards(raw: string): Flashcard[] {
  const results: Flashcard[] = [];
  const lines = raw.split('\n');

  let i = 0;
  while (i < lines.length) {
    const headerMatch = CARD_HEADER.exec(lines[i]);
    if (!headerMatch) { i++; continue; }

    const [, id, moduleId, lastTested = null] = headerMatch;

    // Scan ahead for Front/Back lines (skip blank lines between header and content)
    let front: string | undefined;
    let back: string | undefined;
    let j = i + 1;
    while (j < lines.length && !(front && back)) {
      const fl = FRONT_LINE.exec(lines[j]);
      const bl = BACK_LINE.exec(lines[j]);
      if (fl) front = fl[1].trim();
      if (bl) back = bl[1].trim();
      j++;
    }

    if (front !== undefined && back !== undefined) {
      results.push({ id, moduleId, lastTested, front, back });
    }
    i = j;
  }

  return results;
}
```

- [ ] **Step 4: Run parser tests — expect PASS**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/cards/__tests__/parse-flashcards.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Write failing tests for due-card logic**

Create `src/lib/cards/__tests__/due-cards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getDueCards } from '../due-cards';
import type { Flashcard } from '../parse-flashcards';
import type { FlashcardState } from '../../types';

const NOW = '2026-05-27';

function state(lastTested: string, intervalDays: 7 | 14 | 30): FlashcardState {
  return { lastTested, intervalDays, ease: 'good' };
}

const CARDS: Flashcard[] = [
  { id: 'B01-c01', moduleId: 'B01', lastTested: '2026-05-20', front: 'Q1', back: 'A1' },
  { id: 'B01-c02', moduleId: 'B01', lastTested: '2026-05-20', front: 'Q2', back: 'A2' },
  { id: 'B01-c03', moduleId: 'B01', lastTested: '2026-05-25', front: 'Q3', back: 'A3' },
  { id: 'B01-c04', moduleId: 'B01', lastTested: null,          front: 'Q4', back: 'A4' },
];

describe('getDueCards', () => {
  it('returns cards where now - lastTested >= intervalDays', () => {
    // B01-c01: 2026-05-20 + 7 days = 2026-05-27 → DUE (on the boundary)
    const stateMap: Record<string, FlashcardState> = {
      'B01-c01': state('2026-05-20', 7),
      'B01-c02': state('2026-05-20', 14), // 7 days elapsed < 14 → not due
      'B01-c03': state('2026-05-25', 7),  // 2 days elapsed < 7 → not due
    };
    const due = getDueCards(CARDS, stateMap, NOW);
    expect(due.map((d) => d.card.id)).toEqual(['B01-c01']);
  });

  it('includes never-tested cards (lastTested=null) as always due', () => {
    const due = getDueCards([CARDS[3]], {}, NOW);
    expect(due).toHaveLength(1);
    expect(due[0].card.id).toBe('B01-c04');
  });

  it('uses card-level lastTested as fallback when no state entry', () => {
    // Card has lastTested=2026-05-20; no state entry → treat as never tested → due
    const due = getDueCards([CARDS[0]], {}, NOW);
    expect(due).toHaveLength(1);
  });

  it('returns empty array when nothing is due', () => {
    const stateMap: Record<string, FlashcardState> = {
      'B01-c01': state('2026-05-26', 7), // 1 day elapsed < 7
    };
    const due = getDueCards([CARDS[0]], stateMap, NOW);
    expect(due).toHaveLength(0);
  });

  it('attaches the current FlashcardState (or default) to each due card', () => {
    const stateMap: Record<string, FlashcardState> = {
      'B01-c01': state('2026-05-20', 7),
    };
    const due = getDueCards([CARDS[0]], stateMap, NOW);
    expect(due[0].currentState.intervalDays).toBe(7);
  });
});
```

- [ ] **Step 6: Run due-cards tests — expect FAIL**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/cards/__tests__/due-cards.test.ts
```

Expected: FAIL — "Cannot find module '../due-cards'"

- [ ] **Step 7: Implement `due-cards.ts`**

Create `src/lib/cards/due-cards.ts`:

```typescript
// src/lib/cards/due-cards.ts
// Pure due-date computation for the SR schedule.
// MVP rule: card is due when now - lastTested >= intervalDays.

import type { FlashcardState } from '../types';
import type { Flashcard } from './parse-flashcards';

export interface DueCard {
  card: Flashcard;
  currentState: FlashcardState;
}

const DEFAULT_STATE: FlashcardState = { lastTested: '', intervalDays: 7, ease: 'good' };

function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
}

/**
 * Return all cards that are due for review as of `nowDate` (YYYY-MM-DD).
 * Priority: state map entry wins; else card-level lastTested; else null (always due).
 */
export function getDueCards(
  cards: Flashcard[],
  stateMap: Record<string, FlashcardState>,
  nowDate: string
): DueCard[] {
  const due: DueCard[] = [];

  for (const card of cards) {
    const currentState: FlashcardState = stateMap[card.id] ?? DEFAULT_STATE;
    const lastTested = currentState.lastTested || card.lastTested;

    if (!lastTested) {
      // Never tested — always due
      due.push({ card, currentState });
      continue;
    }

    const elapsed = daysBetween(lastTested, nowDate);
    if (elapsed >= currentState.intervalDays) {
      due.push({ card, currentState });
    }
  }

  return due;
}

/** Count due cards without allocating DueCard objects — used by TopBar. */
export function countDueCards(
  cards: Flashcard[],
  stateMap: Record<string, FlashcardState>,
  nowDate: string
): number {
  return getDueCards(cards, stateMap, nowDate).length;
}
```

- [ ] **Step 8: Run due-cards tests — expect PASS**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/cards/__tests__/due-cards.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 9: Write failing tests for SR update logic**

Create `src/lib/cards/__tests__/sr-update.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applySRResult } from '../sr-update';
import type { FlashcardState } from '../../types';

function state(intervalDays: 7 | 14 | 30, lastTested = '2026-05-20'): FlashcardState {
  return { lastTested, intervalDays, ease: 'good' };
}

describe('applySRResult', () => {
  it("advances interval 7→14 on 'good'", () => {
    const result = applySRResult(state(7), 'good', '2026-05-27');
    expect(result.intervalDays).toBe(14);
  });

  it("advances interval 14→30 on 'good'", () => {
    const result = applySRResult(state(14), 'good', '2026-05-27');
    expect(result.intervalDays).toBe(30);
  });

  it("caps interval at 30 on 'good'", () => {
    const result = applySRResult(state(30), 'good', '2026-05-27');
    expect(result.intervalDays).toBe(30);
  });

  it("resets interval to 7 on 'again'", () => {
    const result = applySRResult(state(30), 'again', '2026-05-27');
    expect(result.intervalDays).toBe(7);
  });

  it('updates lastTested to the provided date', () => {
    const result = applySRResult(state(7), 'good', '2026-05-27');
    expect(result.lastTested).toBe('2026-05-27');
  });

  it("sets ease to 'good' on good, 'again' on again", () => {
    expect(applySRResult(state(7), 'good', '2026-05-27').ease).toBe('good');
    expect(applySRResult(state(7), 'again', '2026-05-27').ease).toBe('again');
  });
});
```

- [ ] **Step 10: Run SR tests — expect FAIL**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/cards/__tests__/sr-update.test.ts
```

Expected: FAIL — "Cannot find module '../sr-update'"

- [ ] **Step 11: Implement `sr-update.ts`**

Create `src/lib/cards/sr-update.ts`:

```typescript
// src/lib/cards/sr-update.ts
// Pure SR state transition: given a recall result, compute the next FlashcardState.
// Caller is responsible for writing the result to the sidecar via /api/state.

import type { FlashcardState } from '../types';

type Recall = 'good' | 'again';

const INTERVAL_PROGRESSION: Record<7 | 14 | 30, 7 | 14 | 30> = {
  7: 14,
  14: 30,
  30: 30,   // capped
};

/**
 * Compute the next FlashcardState after a recall attempt.
 * - good: advance interval (7→14→30, cap at 30); set lastTested; ease=good
 * - again: reset interval to 7; set lastTested; ease=again
 */
export function applySRResult(
  current: FlashcardState,
  recall: Recall,
  nowDate: string  // YYYY-MM-DD
): FlashcardState {
  if (recall === 'good') {
    return {
      lastTested: nowDate,
      intervalDays: INTERVAL_PROGRESSION[current.intervalDays],
      ease: 'good',
    };
  }
  return {
    lastTested: nowDate,
    intervalDays: 7,
    ease: 'again',
  };
}
```

- [ ] **Step 12: Run SR tests — expect PASS**

```bash
cd /Users/unmukt/llm-tutor && npm test src/lib/cards/__tests__/sr-update.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 13: Wire `countDueCards` into `app/page.tsx`**

Replace the stub in `app/page.tsx` with a real import. The page needs the raw `_flashcards.md` file content — read it server-side with `fs.readFile`.

Edit `app/page.tsx` — remove the stub function and update the imports + body:

```tsx
// app/page.tsx  (updated — replace the entire file)
import { readFile } from 'fs/promises';
import path from 'path';
import TopBar from '@/components/TopBar';
import JourneyMap from '@/components/JourneyMap';
import { deriveNodesEdges } from '@/src/lib/map/derive-nodes-edges';
import { getCurriculumRepository } from '@/src/lib/ingest';
import { getStateStore } from '@/src/lib/state';
import { parseFlashcards } from '@/src/lib/cards/parse-flashcards';
import { countDueCards } from '@/src/lib/cards/due-cards';

export default async function HomePage() {
  const curriculumDir = process.env.CURRICULUM_DIR;
  if (!curriculumDir) {
    throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  }

  const repo = getCurriculumRepository();
  const store = getStateStore(curriculumDir);

  const flashcardsPath = path.join(curriculumDir, '_flashcards.md');
  const [curriculum, state, flashcardsRaw] = await Promise.all([
    repo.load(curriculumDir),
    store.read(),
    readFile(flashcardsPath, 'utf-8').catch(() => ''),
  ]);

  const { nodes, edges } = deriveNodesEdges(curriculum, state);
  const flashcards = parseFlashcards(flashcardsRaw);
  const today = new Date().toISOString().slice(0, 10);
  const dueCardCount = countDueCards(flashcards, state.flashcards, today);

  return (
    <main className="min-h-screen bg-slate-50">
      <TopBar
        streak={state.streak.count}
        dueCardCount={dueCardCount}
        weeklyXp={state.xp.thisWeek}
      />
      <div className="p-4">
        <h1 className="text-xl font-semibold text-slate-800 mb-4">LLM Tutor — Journey Map</h1>
        <JourneyMap initialNodes={nodes} initialEdges={edges} />
      </div>
    </main>
  );
}
```

- [ ] **Step 14: Run all tests**

```bash
cd /Users/unmukt/llm-tutor && npm test
```

Expected: all tests pass (parser + due-cards + sr-update + map + reader).

- [ ] **Step 15: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add src/lib/cards/ app/page.tsx
git commit -m "feat(s-cards): add flashcard parser, due-card filter, SR update logic + wire into homepage"
```

---

## Task 8: DiagramPane component (mermaid + shiki)

**Files:**
- Create: `components/DiagramPane.tsx`

This is a client component. It receives an array of fenced code blocks (strings) from `Module.diagrams` and renders them: mermaid blocks as SVG diagrams, all other fenced blocks as syntax-highlighted code via shiki.

The diagrams are already extracted by the plan-01 parser as raw strings (the content inside the triple-backtick fence, with the language tag stripped or not). We detect the language by checking if the raw string begins with `graph `, `sequenceDiagram`, `flowchart`, `gantt`, `classDiagram`, `stateDiagram`, `erDiagram`, `journey`, `gitGraph`, `pie`, or `%%{init` — or if the fence was tagged `mermaid`.

Because `mermaid` and `shiki` both run in the browser (mermaid especially needs `window`), this component is `'use client'` and initialises lazily.

- [ ] **Step 1: Create DiagramPane**

Create `components/DiagramPane.tsx`:

```tsx
// components/DiagramPane.tsx
// Renders Module.diagrams: mermaid → SVG, other code blocks → shiki-highlighted HTML.
// Must be 'use client' because mermaid.initialize() requires the browser.
'use client';

import { useEffect, useRef, useState } from 'react';

interface DiagramPaneProps {
  /** Raw diagram/code strings extracted from the engineer pass by the parser. */
  diagrams: string[];
}

const MERMAID_STARTERS = [
  'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'erDiagram', 'journey', 'gitGraph', 'gantt', 'pie ', '%%{init',
];

function isMermaid(raw: string): boolean {
  const trimmed = raw.trimStart();
  return MERMAID_STARTERS.some((s) => trimmed.startsWith(s));
}

// ── Mermaid block ──────────────────────────────────────────────────────────
function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    render();
    return () => { cancelled = true; };
  }, [source]);

  if (error) {
    return (
      <pre className="text-xs text-red-600 bg-red-50 p-2 rounded">
        Diagram render error: {error}
      </pre>
    );
  }
  return <div ref={ref} className="overflow-x-auto my-4" />;
}

// ── Shiki code block ───────────────────────────────────────────────────────
function ShikiBlock({ source }: { source: string }) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    async function highlight() {
      try {
        const { codeToHtml } = await import('shiki');
        const result = await codeToHtml(source, {
          lang: 'text',
          theme: 'github-light',
        });
        if (!cancelled) setHtml(result);
      } catch {
        if (!cancelled) setHtml(`<pre>${source}</pre>`);
      }
    }
    highlight();
    return () => { cancelled = true; };
  }, [source]);

  return (
    <div
      className="my-4 rounded overflow-x-auto text-sm"
      // shiki returns safe HTML from trusted source strings
      dangerouslySetInnerHTML={{ __html: html || `<pre>${source}</pre>` }}
    />
  );
}

// ── DiagramPane ────────────────────────────────────────────────────────────
export default function DiagramPane({ diagrams }: DiagramPaneProps) {
  if (diagrams.length === 0) return null;

  return (
    <aside className="border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Diagrams &amp; Code
      </h3>
      {diagrams.map((src, i) =>
        isMermaid(src)
          ? <MermaidBlock key={i} source={src} />
          : <ShikiBlock key={i} source={src} />
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add components/DiagramPane.tsx
git commit -m "feat(s-reader): add DiagramPane (mermaid + shiki, lazy client import)"
```

---

## Task 9: Module reader page (`app/module/[id]/page.tsx`)

**Files:**
- Create: `app/module/[id]/page.tsx`

Server component. Loads the module from `CurriculumRepository`, loads sidecar state for the module. Renders:
1. **Why-this-matters banner** — if absent (`whyThisMatters` empty or undefined), shows a visible warning.
2. **Anchor card** — the first anchor scenario.
3. **DepthToggle + pass body** — depth toggle is client-interactive; the pass body is rendered as markdown HTML server-side for the default pass, then updated client-side when the user switches. The "not authored yet" state is a clear inline message.
4. **DiagramPane** — the module's `diagrams` array.

Because the depth toggle is interactive, we need a thin client wrapper for the pass body. We keep this minimal: a `ModuleReaderClient` client component that receives all three pass bodies (as pre-rendered HTML strings) and swaps them on toggle. Server component renders the markdown to HTML.

- [ ] **Step 1: Create the module reader page**

Create `app/module/[id]/page.tsx`:

```tsx
// app/module/[id]/page.tsx
// Server component: module reader.
// Loads module + state server-side; passes pre-rendered pass HTML to the client component.

import { notFound } from 'next/navigation';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkHtml from 'remark-html';
import DiagramPane from '@/components/DiagramPane';
import ModuleReaderClient from '@/components/ModuleReaderClient';
import { getCurriculumRepository } from '@/src/lib/ingest';
import { getStateStore } from '@/src/lib/state';
import type { DepthPass } from '@/src/lib/types';
import { DEPTH_OPTIONS, resolvePass } from '@/src/lib/reader/select-pass';

interface PageProps {
  params: { id: string };
}

async function mdToHtml(md: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkHtml, { sanitize: false })
    .process(md);
  return String(result);
}

export default async function ModuleReaderPage({ params }: PageProps) {
  const curriculumDir = process.env.CURRICULUM_DIR;
  if (!curriculumDir) throw new Error('CURRICULUM_DIR not set');

  const repo = getCurriculumRepository();
  const curriculum = await repo.load(curriculumDir);
  const mod = curriculum.byId(params.id);
  if (!mod) notFound();

  const store = getStateStore(curriculumDir);
  const state = await store.read();
  const moduleState = state.modules[mod.id];

  // Pre-render all three passes to HTML server-side (avoids client-side markdown parsing)
  const passHtml: Partial<Record<DepthPass, string>> = {};
  for (const { key } of DEPTH_OPTIONS) {
    const resolved = resolvePass(mod, key);
    if (resolved.authored && resolved.content) {
      passHtml[key] = await mdToHtml(resolved.content);
    }
  }

  const whyHtml = mod.whyThisMatters ? await mdToHtml(mod.whyThisMatters) : null;
  const anchorHtml = mod.anchors[0] ? await mdToHtml(mod.anchors[0]) : null;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Why this matters banner */}
      {whyHtml ? (
        <div
          className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded text-slate-800"
          dangerouslySetInnerHTML={{ __html: whyHtml }}
        />
      ) : (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded text-red-700 text-sm font-medium">
          ⚠ "Why this matters" not authored for this module.
        </div>
      )}

      {/* Module title + mastery badge */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{mod.name}</h1>
        {moduleState && (
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-200 text-slate-600 capitalize">
            {moduleState.mastery}
          </span>
        )}
      </div>

      {/* Anchor card */}
      {anchorHtml && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Anchor scenario
          </h2>
          <div
            className="bg-slate-100 rounded-lg p-4 text-slate-700 text-sm"
            dangerouslySetInnerHTML={{ __html: anchorHtml }}
          />
        </section>
      )}

      {/* Depth toggle + pass body — client interactive */}
      <ModuleReaderClient
        moduleId={mod.id}
        passHtml={passHtml}
      />

      {/* Diagram pane */}
      <DiagramPane diagrams={mod.diagrams} />
    </main>
  );
}
```

- [ ] **Step 2: Create `ModuleReaderClient` — the interactive depth wrapper**

Create `components/ModuleReaderClient.tsx`:

```tsx
// components/ModuleReaderClient.tsx
// Thin client wrapper: holds the selected DepthPass in state, swaps pass HTML.
'use client';

import { useState } from 'react';
import DepthToggle from './DepthToggle';
import type { DepthPass } from '@/src/lib/types';

interface ModuleReaderClientProps {
  moduleId: string;
  passHtml: Partial<Record<DepthPass, string>>;
}

export default function ModuleReaderClient({ moduleId: _moduleId, passHtml }: ModuleReaderClientProps) {
  const [currentPass, setCurrentPass] = useState<DepthPass>('engineer');

  const html = passHtml[currentPass];

  return (
    <section className="space-y-4">
      <DepthToggle current={currentPass} onChange={setCurrentPass} />

      {html ? (
        <article
          className="prose prose-slate max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="text-sm text-slate-500 italic border border-dashed border-slate-300 rounded p-4">
          This depth pass hasn't been authored yet — no LLM generation in MVP.
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Install remark-html (needed for `mdToHtml`)**

```bash
cd /Users/unmukt/llm-tutor && npm install remark-html
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke-test in the browser**

```bash
cd /Users/unmukt/llm-tutor && CURRICULUM_DIR=/path/to/curriculum npm run dev
```

Navigate to `http://localhost:3000/module/B01` (substitute a real module id). Expected: Why-this-matters banner renders (or shows the warning), DepthToggle buttons appear, Engineer pass renders by default, clicking "Dumb it down" swaps content (or shows "not authored yet").

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add app/module components/ModuleReaderClient.tsx
git commit -m "feat(s-reader): add module reader page + client depth toggle wrapper"
```

---

## Task 10: FlashcardReview component + flashcards page (S-CARDS)

**Files:**
- Create: `components/FlashcardReview.tsx`
- Create: `app/flashcards/page.tsx`

`FlashcardReview` is a client component: it holds a card deck in local state, shows front then back on click, and fires `patchState` to record the recall result and update the sidecar SR interval. It uses `applySRResult` for the state transition.

- [ ] **Step 1: Create FlashcardReview**

Create `components/FlashcardReview.tsx`:

```tsx
// components/FlashcardReview.tsx
// Client component: self-graded flashcard deck.
// Receives due cards as props (derived server-side); writes SR results back via /api/state.
'use client';

import { useState, useCallback } from 'react';
import { applySRResult } from '@/src/lib/cards/sr-update';
import { patchState } from '@/src/lib/api-client';
import type { DueCard } from '@/src/lib/cards/due-cards';

interface FlashcardReviewProps {
  dueCards: DueCard[];
}

type Phase = 'front' | 'back' | 'done';

export default function FlashcardReview({ dueCards }: FlashcardReviewProps) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('front');

  const current = dueCards[index];

  const handleReveal = useCallback(() => {
    setPhase('back');
  }, []);

  const handleGrade = useCallback(
    async (recall: 'good' | 'again') => {
      if (!current) return;

      const today = new Date().toISOString().slice(0, 10);
      const nextState = applySRResult(current.currentState, recall, today);

      // Persist to sidecar via /api/state PATCH
      await patchState(['flashcards', current.card.id], nextState);

      const nextIndex = index + 1;
      if (nextIndex >= dueCards.length) {
        setPhase('done');
      } else {
        setIndex(nextIndex);
        setPhase('front');
      }
    },
    [current, index, dueCards.length]
  );

  if (dueCards.length === 0) {
    return (
      <div className="text-center text-slate-500 py-12">
        No cards due today — come back tomorrow.
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-2xl">Done for today!</p>
        <p className="text-slate-500 text-sm">Reviewed {dueCards.length} card{dueCards.length !== 1 ? 's' : ''}.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-8 space-y-6">
      <p className="text-xs text-slate-400 text-right">
        Card {index + 1} / {dueCards.length}
      </p>

      {/* Card face */}
      <div className="bg-white border border-slate-200 rounded-xl p-8 min-h-[180px] flex items-center justify-center text-center shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
            {phase === 'front' ? 'Front' : 'Back'}
          </p>
          <p className="text-lg text-slate-800">
            {phase === 'front' ? current.card.front : current.card.back}
          </p>
        </div>
      </div>

      {/* Actions */}
      {phase === 'front' ? (
        <button
          onClick={handleReveal}
          className="w-full py-3 rounded-lg bg-slate-800 text-white font-medium hover:bg-slate-700 transition-colors"
        >
          Reveal answer
        </button>
      ) : (
        <div className="flex gap-4">
          <button
            onClick={() => handleGrade('again')}
            className="flex-1 py-3 rounded-lg border border-red-300 text-red-600 font-medium hover:bg-red-50 transition-colors"
          >
            Again
          </button>
          <button
            onClick={() => handleGrade('good')}
            className="flex-1 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition-colors"
          >
            Good
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the flashcards page**

Create `app/flashcards/page.tsx`:

```tsx
// app/flashcards/page.tsx
// Server component: loads due flashcards and passes them to FlashcardReview.

import { readFile } from 'fs/promises';
import path from 'path';
import FlashcardReview from '@/components/FlashcardReview';
import { getStateStore } from '@/src/lib/state';
import { parseFlashcards } from '@/src/lib/cards/parse-flashcards';
import { getDueCards } from '@/src/lib/cards/due-cards';

export default async function FlashcardsPage() {
  const curriculumDir = process.env.CURRICULUM_DIR;
  if (!curriculumDir) throw new Error('CURRICULUM_DIR not set');

  const store = getStateStore(curriculumDir);
  const flashcardsPath = path.join(curriculumDir, '_flashcards.md');

  const [state, flashcardsRaw] = await Promise.all([
    store.read(),
    readFile(flashcardsPath, 'utf-8').catch(() => ''),
  ]);

  const flashcards = parseFlashcards(flashcardsRaw);
  const today = new Date().toISOString().slice(0, 10);
  const dueCards = getDueCards(flashcards, state.flashcards, today);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Flashcard Review</h1>
        <p className="text-sm text-slate-500 mb-8">
          {dueCards.length} card{dueCards.length !== 1 ? 's' : ''} due today
        </p>
        <FlashcardReview dueCards={dueCards} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/unmukt/llm-tutor && npm test
```

Expected: all tests pass (16 total across map, reader, cards suites).

- [ ] **Step 5: Smoke-test in the browser**

```bash
cd /Users/unmukt/llm-tutor && CURRICULUM_DIR=/path/to/curriculum npm run dev
```

Navigate to `http://localhost:3000/flashcards`. Expected: page loads with due card count, first card front visible, "Reveal answer" button present. Click reveals back. "Good" and "Again" buttons fire and advance to next card. Final card shows "Done for today!". No JS console errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add components/FlashcardReview.tsx app/flashcards/page.tsx
git commit -m "feat(s-cards): add FlashcardReview component + flashcards page"
```

---

## Task 11: Wire node click → module navigation in JourneyMap

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/JourneyMap.tsx`

The JourneyMap needs to navigate to `app/module/[id]/page.tsx` when a node is clicked. Use Next.js `useRouter` — because `JourneyMap` is already a client component, this is a one-line change.

- [ ] **Step 1: Update JourneyMap to use `useRouter`**

Edit `components/JourneyMap.tsx` — add the router and navigate on node click:

```tsx
// components/JourneyMap.tsx  (updated — replace entire file)
'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MapNode, MapEdge } from '@/src/lib/map/derive-nodes-edges';

interface JourneyMapProps {
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
}

export default function JourneyMap({ initialNodes, initialEdges }: JourneyMapProps) {
  const router = useRouter();
  const [nodes, , onNodesChange] = useNodesState(initialNodes as any);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges as any);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      router.push(`/module/${node.id}`);
    },
    [router]
  );

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Remove the now-unused `onNodeClick` prop from `app/page.tsx`**

Edit `app/page.tsx` — the `<JourneyMap>` JSX line no longer needs an `onNodeClick` prop (it was never passed, but remove any stale reference):

```tsx
        <JourneyMap initialNodes={nodes} initialEdges={edges} />
```

(This line is already correct in Task 7 Step 13 — verify it matches, no change needed if it does.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/unmukt/llm-tutor && npm test
```

Expected: all tests still pass (no logic changed).

- [ ] **Step 5: Smoke-test navigation**

```bash
cd /Users/unmukt/llm-tutor && CURRICULUM_DIR=/path/to/curriculum npm run dev
```

Open `http://localhost:3000`. Click a node on the map. Expected: browser navigates to `/module/<id>` and the reader page loads.

- [ ] **Step 6: Commit**

```bash
cd /Users/unmukt/llm-tutor
git add components/JourneyMap.tsx app/page.tsx
git commit -m "feat(s-map): wire node click → module reader navigation"
```

---

## Task 12: Run full test suite + final type check

- [ ] **Step 1: Run all Vitest tests**

```bash
cd /Users/unmukt/llm-tutor && npm test
```

Expected output (all pass):
```
✓ src/lib/map/__tests__/derive-nodes-edges.test.ts (6)
✓ src/lib/reader/__tests__/select-pass.test.ts (6)
✓ src/lib/cards/__tests__/parse-flashcards.test.ts (6)
✓ src/lib/cards/__tests__/due-cards.test.ts (5)
✓ src/lib/cards/__tests__/sr-update.test.ts (6)

Test Files  5 passed
Tests      29 passed
```

- [ ] **Step 2: Full TypeScript check**

```bash
cd /Users/unmukt/llm-tutor && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit (if any stray fixes were made)**

```bash
cd /Users/unmukt/llm-tutor
git add -A
git status  # verify nothing unintended is staged
git commit -m "chore: plan-02 complete — all tests pass, zero TS errors"
```

---

## Assumptions about plan-01's API (not fully pinned in 00-shared-model.md)

1. **`getCurriculumRepository()` factory** — the shared model defines the `CurriculumRepository` interface but doesn't name the export that instantiates it. This plan assumes `src/lib/ingest/index.ts` (or similar) exports `getCurriculumRepository(): CurriculumRepository`. If plan-01 used a different name (e.g. `createCurriculumRepository`, `new IngestService()`), update the import in `app/page.tsx` and `app/module/[id]/page.tsx`.

2. **`getStateStore(curriculumDir)` factory** — similarly, `StateStore` is an interface in the shared model. This plan assumes `src/lib/state/index.ts` exports `getStateStore(dir: string): StateStore`. Adjust if plan-01 used a different constructor signature.

3. **`/api/state` PATCH shape** — the shared model says `StateStore.write(s: TutorState)` but doesn't specify the HTTP PATCH body format. This plan assumes `{ path: string[]; value: unknown }` (deep-set). If plan-01 instead exposed a PUT that takes the full `TutorState`, change `patchState` in `src/lib/api-client.ts` to match.

4. **`Module.diagrams` content** — the shared model says `diagrams: string[]` and the build-spec says "fenced mermaid/ASCII blocks pulled from the engineer pass." This plan assumes plan-01 strips the opening/closing triple-backtick fences and language tag, storing only the raw inner content. `DiagramPane` runs its `isMermaid` detector on this raw content. If plan-01 stores the full fenced string (including ` ```mermaid ` markers), add a strip step at the top of `DiagramPane`.

5. **`FlashcardState.intervalDays` type** — the shared model types it as `7 | 14 | 30` (a union). `sr-update.ts` uses a lookup table keyed on this union. This is consistent with the shared model as written.
