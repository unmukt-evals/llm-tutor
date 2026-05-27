# V-VIZ — Visualization System + Content Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prose-placeholder "diagrams" with a tested, prop-driven visualization component system, wire it into the module reader, and deepen the M02 (embeddings) curriculum content with a real precomputed embedding scatter.

**Architecture:** A module's markdown can declare REAL visualizations in a new optional `## Visuals` section that holds one or more fenced ` ```viz ` blocks, each carrying a JSON object `{ type, title?, data }`. A pure, fence-aware parser helper (`parseVisuals`) extracts + validates these into `Viz[]`, added to `Module.visuals` (backward-compatible: modules without the section parse to `[]`). Each viz `type` maps to a pure SSR-safe React component under `src/components/viz/`, dispatched by an exhaustive `VizBlock` dispatcher. Every component is backed by a PURE, unit-tested data-prep helper (node-env vitest, no jsdom). The reader renders `module.visuals` inline after the depth-pass body via `VizBlock`. Finally the M02 Obsidian curriculum file gets a real engineer-pass rewrite + a baked `embedding-scatter` + `vector-table` viz + worked cosine examples.

**Tech Stack:** Next 15 (App Router), React 19, TypeScript (strict), Tailwind v3 (+ `@tailwindcss/typography`), Vitest 3 (node env, `globals: true`, alias `@` → `src`, test glob `src/**/*.test.ts`). Existing libs: `gray-matter`, `react-markdown`, `mermaid`, `shiki`. NO new runtime deps (scatter is hand-rolled SVG; coords are precomputed in the module data — no runtime model).

---

## Design decisions (locked)

- **Viz mechanism = a `## Visuals` section containing ` ```viz ` fenced JSON blocks.** Rationale: the existing `sectionsByHeading` parser is already fence-aware and treats `## Visuals` identically to every other section, so this is backward-compatible with zero parser surgery; keeping viz out of the engineer pass means it never pollutes `Module.diagrams`; JSON-in-a-fence keeps the data structured + validatable (vs. a freeform `## Visuals` prose section). Each fenced block's inner text is `JSON.parse`d into one `Viz`.
- **`Viz` type shape:**
  ```ts
  export type VizType =
    | 'embedding-scatter'
    | 'vector-table'
    | 'attention-heatmap'
    | 'bar-compare';

  export interface Viz {
    type: VizType;
    title?: string;
    // type-specific JSON payload; validated per-type at parse time.
    data: unknown;
  }
  ```
  Per-type payloads (the validated shapes the data-prep helpers consume):
  ```ts
  // embedding-scatter
  export interface ScatterPoint { label: string; x: number; y: number; cluster: string; }
  export interface EmbeddingScatterData {
    points: ScatterPoint[];
    // optional precomputed nearest-neighbor links (index pairs into points)
    links?: { from: number; to: number }[];
  }
  // vector-table
  export interface VectorTableData {
    dims: string[];                       // column headers, e.g. ["d0","d1","d2"]
    rows: { token: string; values: number[] }[]; // values.length === dims.length
  }
  // attention-heatmap
  export interface AttentionHeatmapData {
    rowLabels: string[];
    colLabels: string[];
    matrix: number[][];                   // matrix.length === rowLabels.length, each row length === colLabels.length
  }
  // bar-compare
  export interface BarCompareData {
    bars: { label: string; value: number }[];
    unit?: string;
  }
  ```
- **Invalid viz blocks are dropped, not thrown.** `parseVisuals` mirrors `extractDiagrams`' robustness: a malformed JSON block or one that fails per-type validation is skipped (so one bad block never breaks a whole module's parse). This is asserted by tests.
- **Components are validated by typecheck + build, not jsdom** (vitest is node-env and only globs `*.test.ts`). All branching logic that needs unit tests lives in the PURE helpers (`*.ts`), which the components import.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/types.ts` (modify) | Add `VizType`, `Viz`, the four per-type data interfaces; add `visuals: Viz[]` to `Module`. |
| `src/lib/ingest/parse-visuals.ts` (create) | PURE `parseVisuals(visualsSection: string \| undefined): Viz[]` + per-type validators. |
| `src/lib/ingest/__tests__/parse-visuals.test.ts` (create) | Unit tests for `parseVisuals`. |
| `src/lib/ingest/parse-module.ts` (modify) | Call `parseVisuals(sections.get('Visuals'))` → `Module.visuals`. |
| `src/lib/ingest/__tests__/parse-module.test.ts` (modify) | Assert `visuals` parsed + backward-compat empty. |
| `src/lib/viz/scatter.ts` (create) | PURE `prepareScatter(data, opts)` → laid-out SVG-ready geometry + color map. |
| `src/lib/viz/__tests__/scatter.test.ts` (create) | Unit tests for `prepareScatter`. |
| `src/lib/viz/heatmap.ts` (create) | PURE `prepareHeatmap(data)` → cells with normalized intensity. |
| `src/lib/viz/__tests__/heatmap.test.ts` (create) | Unit tests for `prepareHeatmap`. |
| `src/lib/viz/bars.ts` (create) | PURE `prepareBars(data)` → bars with width fractions. |
| `src/lib/viz/__tests__/bars.test.ts` (create) | Unit tests for `prepareBars`. |
| `src/lib/viz/dispatch.ts` (create) | PURE `vizComponentName(type): VizComponentName` exhaustive dispatcher. |
| `src/lib/viz/__tests__/dispatch.test.ts` (create) | Unit tests for the dispatcher (exhaustive). |
| `src/components/viz/EmbeddingScatter.tsx` (create) | SVG scatter; hover label; nearest-neighbor link toggle. |
| `src/components/viz/VectorTable.tsx` (create) | Styled token→dims table. |
| `src/components/viz/AttentionHeatmap.tsx` (create) | Grid heatmap. |
| `src/components/viz/BarCompare.tsx` (create) | Labeled bars. |
| `src/components/viz/VizBlock.tsx` (create) | Dispatcher component: `Viz` → the right component (uses `vizComponentName`). |
| `src/components/ModuleReaderClient.tsx` (modify) | Render `module.visuals` via `VizBlock` after the pass body. |
| `~/Obsidian/.../LLM-Curriculum/M02-embeddings.md` (modify, NOT git-added) | Deepen engineer pass; add `## Visuals` with `embedding-scatter` + `vector-table`; add worked cosine examples. |

---

### Task 1: `Viz` types in the shared model

**Files:**
- Modify: `src/lib/types.ts` (insert after the `Diagram` interface, before `Module`)
- Modify: `src/lib/types.ts` (add `visuals` field to `Module`)
- Test: `src/lib/__tests__/types.test.ts` (existing — add a compile-time usage)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Viz, Module } from '@/lib/types';

describe('Viz + Module.visuals types', () => {
  it('constructs a Module with a typed visuals array', () => {
    const viz: Viz = {
      type: 'embedding-scatter',
      title: 'demo',
      data: { points: [{ label: 'a', x: 0, y: 0, cluster: 'c' }] },
    };
    const mod: Pick<Module, 'visuals'> = { visuals: [viz] };
    expect(mod.visuals[0].type).toBe('embedding-scatter');
  });
});
```

> If `src/lib/__tests__/types.test.ts` has a different existing structure, add this `describe` block at the end of the file (do not delete existing tests).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/__tests__/types.test.ts`
Expected: FAIL — `Viz` not exported / `Module.visuals` does not exist (type error surfaced by the test import or by typecheck).

- [ ] **Step 3: Add the types**

In `src/lib/types.ts`, insert immediately AFTER the `Diagram` interface (after its closing `}` on the line `}` following `body: string;`) and BEFORE `export interface Module {`:

```ts
// ── Visualizations (V-VIZ) ───────────────────────────────────────────────────
// A module may declare REAL visualizations in a "## Visuals" section composed of
// one or more fenced ```viz blocks, each carrying a JSON `Viz`. Coords/values are
// PRECOMPUTED in the markdown — no runtime model. parse-visuals.ts validates the
// per-type `data` shape; components consume the validated payloads below.
export type VizType =
  | 'embedding-scatter'
  | 'vector-table'
  | 'attention-heatmap'
  | 'bar-compare';

export interface Viz {
  type: VizType;
  title?: string;
  data: unknown; // type-specific; validated per-type at parse time
}

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  cluster: string;
}
export interface EmbeddingScatterData {
  points: ScatterPoint[];
  links?: { from: number; to: number }[];
}

export interface VectorTableData {
  dims: string[];
  rows: { token: string; values: number[] }[];
}

export interface AttentionHeatmapData {
  rowLabels: string[];
  colLabels: string[];
  matrix: number[][];
}

export interface BarCompareData {
  bars: { label: string; value: number }[];
  unit?: string;
}
```

Then, in `export interface Module { ... }`, add a `visuals` field immediately after the `diagrams` line (`diagrams: Diagram[]; // §7: ...`):

```ts
  visuals: Viz[]; // V-VIZ: parsed from the "## Visuals" section (```viz JSON blocks)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/__tests__/types.test.ts && npm run typecheck`
Expected: PASS. (typecheck will still fail elsewhere because `parseModule` does not yet set `visuals` — that is fixed in Task 3; if `npm run typecheck` errors ONLY in `parse-module.ts` for the missing `visuals` property, that is expected and resolved in Task 3. The test command itself must PASS.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/__tests__/types.test.ts
git commit -m "feat(viz): add Viz types + Module.visuals to shared model

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `parseVisuals` — pure parser + per-type validation

**Files:**
- Create: `src/lib/ingest/parse-visuals.ts`
- Test: `src/lib/ingest/__tests__/parse-visuals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ingest/__tests__/parse-visuals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseVisuals } from '@/lib/ingest/parse-visuals';
import type { EmbeddingScatterData, VectorTableData, BarCompareData } from '@/lib/types';

const scatterBlock = `
\`\`\`viz
{
  "type": "embedding-scatter",
  "title": "Semantic clusters",
  "data": {
    "points": [
      { "label": "bank", "x": 1.0, "y": 2.0, "cluster": "finance" },
      { "label": "AI agent", "x": -3.0, "y": 0.5, "cluster": "ai" }
    ],
    "links": [{ "from": 0, "to": 1 }]
  }
}
\`\`\`
`;

const tableBlock = `
\`\`\`viz
{
  "type": "vector-table",
  "data": {
    "dims": ["d0", "d1"],
    "rows": [{ "token": "bank", "values": [0.1, 0.2] }]
  }
}
\`\`\`
`;

describe('parseVisuals', () => {
  it('returns [] for undefined / empty section (backward-compatible)', () => {
    expect(parseVisuals(undefined)).toEqual([]);
    expect(parseVisuals('')).toEqual([]);
    expect(parseVisuals('Just prose, no fences.')).toEqual([]);
  });

  it('parses a valid embedding-scatter block', () => {
    const out = parseVisuals(scatterBlock);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('embedding-scatter');
    expect(out[0].title).toBe('Semantic clusters');
    const data = out[0].data as EmbeddingScatterData;
    expect(data.points.length).toBe(2);
    expect(data.points[0].label).toBe('bank');
    expect(data.links?.[0]).toEqual({ from: 0, to: 1 });
  });

  it('parses multiple blocks in one section, in order', () => {
    const out = parseVisuals(scatterBlock + '\n' + tableBlock);
    expect(out.map((v) => v.type)).toEqual(['embedding-scatter', 'vector-table']);
    const t = out[1].data as VectorTableData;
    expect(t.dims).toEqual(['d0', 'd1']);
    expect(t.rows[0].token).toBe('bank');
  });

  it('parses a bar-compare block', () => {
    const block = `
\`\`\`viz
{ "type": "bar-compare", "data": { "bars": [{ "label": "ada-002", "value": 71 }], "unit": "%" } }
\`\`\`
`;
    const out = parseVisuals(block);
    expect(out.length).toBe(1);
    const d = out[0].data as BarCompareData;
    expect(d.bars[0].value).toBe(71);
    expect(d.unit).toBe('%');
  });

  it('drops a block with invalid JSON (does not throw)', () => {
    const bad = '```viz\n{ not json }\n```\n';
    expect(parseVisuals(bad)).toEqual([]);
  });

  it('drops a block with an unknown type', () => {
    const bad = '```viz\n{ "type": "pie-chart", "data": {} }\n```\n';
    expect(parseVisuals(bad)).toEqual([]);
  });

  it('drops an embedding-scatter with a malformed point (missing y)', () => {
    const bad =
      '```viz\n{ "type": "embedding-scatter", "data": { "points": [{ "label": "x", "x": 1, "cluster": "c" }] } }\n```\n';
    expect(parseVisuals(bad)).toEqual([]);
  });

  it('drops a vector-table whose row length mismatches dims', () => {
    const bad =
      '```viz\n{ "type": "vector-table", "data": { "dims": ["d0","d1"], "rows": [{ "token": "t", "values": [0.1] }] } }\n```\n';
    expect(parseVisuals(bad)).toEqual([]);
  });

  it('ignores non-viz fences (e.g. mermaid) in the section', () => {
    const mixed = '```mermaid\ngraph TD\nA-->B\n```\n' + scatterBlock;
    const out = parseVisuals(mixed);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('embedding-scatter');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/ingest/__tests__/parse-visuals.test.ts`
Expected: FAIL — cannot find module `@/lib/ingest/parse-visuals`.

- [ ] **Step 3: Implement `parseVisuals`**

Create `src/lib/ingest/parse-visuals.ts`:

```ts
// src/lib/ingest/parse-visuals.ts
// PURE parser for the "## Visuals" section. The section holds zero or more
// fenced ```viz blocks; each block's inner text is JSON for one `Viz`
// ({ type, title?, data }). Coords/values are PRECOMPUTED in the markdown —
// no runtime model. Mirrors extractDiagrams' robustness: a block that is not
// JSON, has an unknown type, or fails per-type validation is DROPPED (never
// throws), so one bad block can't break a whole module's parse.

import type {
  Viz,
  VizType,
  EmbeddingScatterData,
  VectorTableData,
  AttentionHeatmapData,
  BarCompareData,
} from '@/lib/types';

const VIZ_TYPES: readonly VizType[] = [
  'embedding-scatter',
  'vector-table',
  'attention-heatmap',
  'bar-compare',
];

/** Extract the inner text of every ```viz fenced block, in order. */
function extractVizFences(section: string): string[] {
  const out: string[] = [];
  const lines = section.split('\n');
  let inVizFence = false;
  let buffer: string[] = [];

  for (const line of lines) {
    const open = /^```viz\s*$/.exec(line.trimStart());
    const close = /^```\s*$/.exec(line.trimStart());
    if (!inVizFence && open) {
      inVizFence = true;
      buffer = [];
      continue;
    }
    if (inVizFence && close) {
      out.push(buffer.join('\n').trim());
      inVizFence = false;
      continue;
    }
    if (inVizFence) buffer.push(line);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validScatter(data: unknown): data is EmbeddingScatterData {
  if (!isRecord(data) || !Array.isArray(data.points)) return false;
  const pointsOk = data.points.every(
    (p) =>
      isRecord(p) &&
      typeof p.label === 'string' &&
      isFiniteNumber(p.x) &&
      isFiniteNumber(p.y) &&
      typeof p.cluster === 'string',
  );
  if (!pointsOk) return false;
  if (data.links !== undefined) {
    if (!Array.isArray(data.links)) return false;
    if (
      !data.links.every(
        (l) => isRecord(l) && isFiniteNumber(l.from) && isFiniteNumber(l.to),
      )
    )
      return false;
  }
  return true;
}

function validVectorTable(data: unknown): data is VectorTableData {
  if (!isRecord(data) || !Array.isArray(data.dims) || !Array.isArray(data.rows))
    return false;
  if (!data.dims.every((d) => typeof d === 'string')) return false;
  return data.rows.every(
    (r) =>
      isRecord(r) &&
      typeof r.token === 'string' &&
      Array.isArray(r.values) &&
      r.values.length === (data.dims as unknown[]).length &&
      r.values.every(isFiniteNumber),
  );
}

function validHeatmap(data: unknown): data is AttentionHeatmapData {
  if (
    !isRecord(data) ||
    !Array.isArray(data.rowLabels) ||
    !Array.isArray(data.colLabels) ||
    !Array.isArray(data.matrix)
  )
    return false;
  if (!data.rowLabels.every((l) => typeof l === 'string')) return false;
  if (!data.colLabels.every((l) => typeof l === 'string')) return false;
  if (data.matrix.length !== data.rowLabels.length) return false;
  return data.matrix.every(
    (row) =>
      Array.isArray(row) &&
      row.length === (data.colLabels as unknown[]).length &&
      row.every(isFiniteNumber),
  );
}

function validBars(data: unknown): data is BarCompareData {
  if (!isRecord(data) || !Array.isArray(data.bars)) return false;
  if (data.unit !== undefined && typeof data.unit !== 'string') return false;
  return data.bars.every(
    (b) => isRecord(b) && typeof b.label === 'string' && isFiniteNumber(b.value),
  );
}

function validateForType(type: VizType, data: unknown): boolean {
  switch (type) {
    case 'embedding-scatter':
      return validScatter(data);
    case 'vector-table':
      return validVectorTable(data);
    case 'attention-heatmap':
      return validHeatmap(data);
    case 'bar-compare':
      return validBars(data);
  }
}

/**
 * Parse the "## Visuals" section into a validated Viz[]. Backward-compatible:
 * undefined / empty / fence-free input → []. Invalid blocks are dropped.
 */
export function parseVisuals(visualsSection: string | undefined): Viz[] {
  if (!visualsSection) return [];
  const out: Viz[] = [];
  for (const inner of extractVizFences(visualsSection)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inner);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const type = parsed.type;
    if (typeof type !== 'string' || !VIZ_TYPES.includes(type as VizType)) continue;
    if (!validateForType(type as VizType, parsed.data)) continue;
    const viz: Viz = { type: type as VizType, data: parsed.data };
    if (typeof parsed.title === 'string') viz.title = parsed.title;
    out.push(viz);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/ingest/__tests__/parse-visuals.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest/parse-visuals.ts src/lib/ingest/__tests__/parse-visuals.test.ts
git commit -m "feat(viz): add parseVisuals pure parser + per-type validation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire `parseVisuals` into `parseModule`

**Files:**
- Modify: `src/lib/ingest/parse-module.ts`
- Modify: `src/lib/ingest/__tests__/parse-module.test.ts`
- Modify: `src/lib/ingest/__tests__/fixtures/B01-sample.md` (add a `## Visuals` section)

- [ ] **Step 1: Add the fixture section + write the failing test**

Append a `## Visuals` section to the END of `src/lib/ingest/__tests__/fixtures/B01-sample.md` (after the `## Sources` block):

````markdown

## Visuals

```viz
{
  "type": "bar-compare",
  "title": "Eval vs production",
  "data": { "bars": [{ "label": "eval", "value": 92 }, { "label": "prod", "value": 60 }], "unit": "%" }
}
```
````

> NOTE for the implementer: the four-backtick wrapper above is just this plan's way of showing a triple-backtick block. In the fixture file itself, write a normal triple-backtick ` ```viz ` block.

Append to `src/lib/ingest/__tests__/parse-module.test.ts`:

```ts
describe('parseModule — visuals', () => {
  let mod: Module;
  beforeAll(async () => {
    mod = parseModule(await readFile(FIXTURE, 'utf8'));
  });

  it('parses the Visuals section into Module.visuals', () => {
    expect(mod.visuals.length).toBe(1);
    expect(mod.visuals[0].type).toBe('bar-compare');
    expect(mod.visuals[0].title).toBe('Eval vs production');
  });

  it('does NOT treat viz blocks as engineer-pass diagrams', () => {
    // The engineer pass still has exactly its 2 fenced blocks (mermaid + ascii).
    expect(mod.diagrams.length).toBe(2);
  });

  it('returns [] visuals when the section is absent (backward-compatible)', () => {
    const bare = parseModule('---\nmodule_id: V01\ntrack: A\nname: V\n---\n\n## Sources\n- S1\n');
    expect(bare.visuals).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/ingest/__tests__/parse-module.test.ts`
Expected: FAIL — `mod.visuals` is `undefined` (property does not exist on the returned object yet).

- [ ] **Step 3: Wire it into the parser**

In `src/lib/ingest/parse-module.ts`:

Add the import near the top, after the existing `import type` line:

```ts
import { parseVisuals } from '@/lib/ingest/parse-visuals';
```

In the `return { ... }` object of `parseModule`, add `visuals` immediately after the `diagrams: extractDiagrams(passes.engineer),` line:

```ts
    visuals: parseVisuals(sections.get('Visuals')),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/ingest/__tests__/parse-module.test.ts && npm run typecheck`
Expected: PASS, and typecheck clean (the Task 1 `Module.visuals` requirement is now satisfied everywhere).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest/parse-module.ts src/lib/ingest/__tests__/parse-module.test.ts src/lib/ingest/__tests__/fixtures/B01-sample.md
git commit -m "feat(viz): wire parseVisuals into parseModule (Module.visuals)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `prepareScatter` — pure layout helper for EmbeddingScatter

**Files:**
- Create: `src/lib/viz/scatter.ts`
- Test: `src/lib/viz/__tests__/scatter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/viz/__tests__/scatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prepareScatter } from '@/lib/viz/scatter';
import type { EmbeddingScatterData } from '@/lib/types';

const data: EmbeddingScatterData = {
  points: [
    { label: 'bank', x: 0, y: 0, cluster: 'finance' },
    { label: 'JPMorgan', x: 10, y: 10, cluster: 'finance' },
    { label: 'AI agent', x: -10, y: -10, cluster: 'ai' },
  ],
  links: [{ from: 0, to: 1 }],
};

describe('prepareScatter', () => {
  it('maps data extremes to the padded plot box corners', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    // min x (-10) → left edge (padding); max x (10) → right edge (width-padding)
    const minX = out.points.find((p) => p.label === 'AI agent')!;
    const maxX = out.points.find((p) => p.label === 'JPMorgan')!;
    expect(minX.cx).toBeCloseTo(10);
    expect(maxX.cx).toBeCloseTo(90);
  });

  it('inverts the y axis (SVG y grows downward): max data-y → top', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    const maxY = out.points.find((p) => p.label === 'JPMorgan')!; // y=10 (max)
    const minY = out.points.find((p) => p.label === 'AI agent')!; // y=-10 (min)
    expect(maxY.cy).toBeCloseTo(10); // top
    expect(minY.cy).toBeCloseTo(90); // bottom
  });

  it('assigns a stable color per cluster (same cluster → same color)', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    const bank = out.points.find((p) => p.label === 'bank')!;
    const jpm = out.points.find((p) => p.label === 'JPMorgan')!;
    const ai = out.points.find((p) => p.label === 'AI agent')!;
    expect(bank.color).toBe(jpm.color);
    expect(bank.color).not.toBe(ai.color);
  });

  it('resolves link index pairs to laid-out endpoints', () => {
    const out = prepareScatter(data, { width: 100, height: 100, padding: 10 });
    expect(out.links.length).toBe(1);
    const l = out.links[0];
    expect(l.x1).toBeCloseTo(out.points[0].cx);
    expect(l.y1).toBeCloseTo(out.points[0].cy);
    expect(l.x2).toBeCloseTo(out.points[1].cx);
    expect(l.y2).toBeCloseTo(out.points[1].cy);
  });

  it('handles a degenerate axis (all x equal) by centering', () => {
    const flat: EmbeddingScatterData = {
      points: [
        { label: 'a', x: 5, y: 0, cluster: 'c' },
        { label: 'b', x: 5, y: 4, cluster: 'c' },
      ],
    };
    const out = prepareScatter(flat, { width: 100, height: 100, padding: 10 });
    // both x equal → centered horizontally at (width)/2
    expect(out.points[0].cx).toBeCloseTo(50);
    expect(out.points[1].cx).toBeCloseTo(50);
  });

  it('drops links whose indices are out of range', () => {
    const out = prepareScatter(
      { points: data.points, links: [{ from: 0, to: 99 }] },
      { width: 100, height: 100, padding: 10 },
    );
    expect(out.links).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/viz/__tests__/scatter.test.ts`
Expected: FAIL — cannot find module `@/lib/viz/scatter`.

- [ ] **Step 3: Implement `prepareScatter`**

Create `src/lib/viz/scatter.ts`:

```ts
// src/lib/viz/scatter.ts
// PURE layout helper for <EmbeddingScatter>. Maps precomputed data-space (x,y)
// into an SVG plot box: x → [padding, width-padding], y INVERTED so larger
// data-y is nearer the top (SVG y grows downward). Colors are assigned per
// cluster from a fixed palette (stable + deterministic by first-seen order).
// Degenerate axes (all values equal) center on that axis. No DOM, no React.

import type { EmbeddingScatterData } from '@/lib/types';

export interface ScatterOpts {
  width: number;
  height: number;
  padding: number;
}

export interface LaidOutPoint {
  label: string;
  cluster: string;
  cx: number;
  cy: number;
  color: string;
}
export interface LaidOutLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface PreparedScatter {
  points: LaidOutPoint[];
  links: LaidOutLink[];
  clusters: { name: string; color: string }[];
}

// Fixed, colorblind-friendly-ish palette. Cycles if clusters > palette length.
const PALETTE = [
  '#2563eb', // blue
  '#16a34a', // green
  '#db2777', // pink
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
];

function scale(value: number, min: number, max: number, lo: number, hi: number): number {
  if (max === min) return (lo + hi) / 2; // degenerate axis → center
  return lo + ((value - min) / (max - min)) * (hi - lo);
}

export function prepareScatter(
  data: EmbeddingScatterData,
  opts: ScatterOpts,
): PreparedScatter {
  const { width, height, padding } = opts;
  const xs = data.points.map((p) => p.x);
  const ys = data.points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Stable per-cluster colors by first-seen order.
  const colorByCluster = new Map<string, string>();
  for (const p of data.points) {
    if (!colorByCluster.has(p.cluster)) {
      colorByCluster.set(p.cluster, PALETTE[colorByCluster.size % PALETTE.length]);
    }
  }

  const points: LaidOutPoint[] = data.points.map((p) => ({
    label: p.label,
    cluster: p.cluster,
    cx: scale(p.x, minX, maxX, padding, width - padding),
    // INVERT y: max data-y → top (padding); min data-y → bottom (height-padding)
    cy: scale(p.y, minY, maxY, height - padding, padding),
    color: colorByCluster.get(p.cluster)!,
  }));

  const links: LaidOutLink[] = (data.links ?? [])
    .filter(
      (l) =>
        l.from >= 0 &&
        l.from < points.length &&
        l.to >= 0 &&
        l.to < points.length,
    )
    .map((l) => ({
      x1: points[l.from].cx,
      y1: points[l.from].cy,
      x2: points[l.to].cx,
      y2: points[l.to].cy,
    }));

  const clusters = [...colorByCluster.entries()].map(([name, color]) => ({
    name,
    color,
  }));

  return { points, links, clusters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/viz/__tests__/scatter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viz/scatter.ts src/lib/viz/__tests__/scatter.test.ts
git commit -m "feat(viz): add prepareScatter pure layout helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `prepareHeatmap` — pure helper for AttentionHeatmap

**Files:**
- Create: `src/lib/viz/heatmap.ts`
- Test: `src/lib/viz/__tests__/heatmap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/viz/__tests__/heatmap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prepareHeatmap } from '@/lib/viz/heatmap';
import type { AttentionHeatmapData } from '@/lib/types';

const data: AttentionHeatmapData = {
  rowLabels: ['The', 'cat'],
  colLabels: ['The', 'cat'],
  matrix: [
    [0, 1],
    [2, 4],
  ],
};

describe('prepareHeatmap', () => {
  it('emits one cell per matrix entry with row/col indices + raw value', () => {
    const out = prepareHeatmap(data);
    expect(out.cells.length).toBe(4);
    const c = out.cells.find((x) => x.row === 1 && x.col === 1)!;
    expect(c.value).toBe(4);
  });

  it('normalizes intensity to 0..1 against the matrix max', () => {
    const out = prepareHeatmap(data);
    const max = out.cells.find((x) => x.value === 4)!;
    const min = out.cells.find((x) => x.value === 0)!;
    const mid = out.cells.find((x) => x.value === 2)!;
    expect(max.intensity).toBeCloseTo(1);
    expect(min.intensity).toBeCloseTo(0);
    expect(mid.intensity).toBeCloseTo(0.5);
  });

  it('handles an all-zero matrix without NaN (intensity 0)', () => {
    const out = prepareHeatmap({
      rowLabels: ['a'],
      colLabels: ['b'],
      matrix: [[0]],
    });
    expect(out.cells[0].intensity).toBe(0);
  });

  it('passes through the labels', () => {
    const out = prepareHeatmap(data);
    expect(out.rowLabels).toEqual(['The', 'cat']);
    expect(out.colLabels).toEqual(['The', 'cat']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/viz/__tests__/heatmap.test.ts`
Expected: FAIL — cannot find module `@/lib/viz/heatmap`.

- [ ] **Step 3: Implement `prepareHeatmap`**

Create `src/lib/viz/heatmap.ts`:

```ts
// src/lib/viz/heatmap.ts
// PURE helper for <AttentionHeatmap>. Flattens the matrix into per-cell records
// with normalized intensity (value / matrixMax, clamped, NaN-safe) so the
// component just maps intensity → opacity. No DOM, no React.

import type { AttentionHeatmapData } from '@/lib/types';

export interface HeatmapCell {
  row: number;
  col: number;
  value: number;
  intensity: number; // 0..1
}
export interface PreparedHeatmap {
  rowLabels: string[];
  colLabels: string[];
  cells: HeatmapCell[];
}

export function prepareHeatmap(data: AttentionHeatmapData): PreparedHeatmap {
  let max = 0;
  for (const row of data.matrix) {
    for (const v of row) {
      if (v > max) max = v;
    }
  }
  const cells: HeatmapCell[] = [];
  data.matrix.forEach((row, r) => {
    row.forEach((value, c) => {
      cells.push({
        row: r,
        col: c,
        value,
        intensity: max === 0 ? 0 : value / max,
      });
    });
  });
  return { rowLabels: data.rowLabels, colLabels: data.colLabels, cells };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/viz/__tests__/heatmap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viz/heatmap.ts src/lib/viz/__tests__/heatmap.test.ts
git commit -m "feat(viz): add prepareHeatmap pure helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `prepareBars` — pure helper for BarCompare

**Files:**
- Create: `src/lib/viz/bars.ts`
- Test: `src/lib/viz/__tests__/bars.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/viz/__tests__/bars.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prepareBars } from '@/lib/viz/bars';
import type { BarCompareData } from '@/lib/types';

const data: BarCompareData = {
  bars: [
    { label: 'ada-002', value: 50 },
    { label: 'embed-3', value: 100 },
  ],
  unit: '%',
};

describe('prepareBars', () => {
  it('computes width fraction (0..1) against the max value', () => {
    const out = prepareBars(data);
    expect(out.bars[0].fraction).toBeCloseTo(0.5);
    expect(out.bars[1].fraction).toBeCloseTo(1);
  });

  it('passes through label, value, and unit', () => {
    const out = prepareBars(data);
    expect(out.bars[0].label).toBe('ada-002');
    expect(out.bars[0].value).toBe(50);
    expect(out.unit).toBe('%');
  });

  it('handles all-zero values without NaN (fraction 0)', () => {
    const out = prepareBars({ bars: [{ label: 'a', value: 0 }] });
    expect(out.bars[0].fraction).toBe(0);
    expect(out.unit).toBeUndefined();
  });

  it('supports negative max gracefully by using absolute scale', () => {
    const out = prepareBars({ bars: [{ label: 'a', value: -2 }, { label: 'b', value: -4 }] });
    // max abs = 4 → b is full, a is half
    expect(out.bars[1].fraction).toBeCloseTo(1);
    expect(out.bars[0].fraction).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/viz/__tests__/bars.test.ts`
Expected: FAIL — cannot find module `@/lib/viz/bars`.

- [ ] **Step 3: Implement `prepareBars`**

Create `src/lib/viz/bars.ts`:

```ts
// src/lib/viz/bars.ts
// PURE helper for <BarCompare>. Computes each bar's width as a fraction (0..1)
// of the largest absolute value, NaN-safe for all-zero input. No DOM, no React.

import type { BarCompareData } from '@/lib/types';

export interface PreparedBar {
  label: string;
  value: number;
  fraction: number; // 0..1, relative to max |value|
}
export interface PreparedBars {
  bars: PreparedBar[];
  unit?: string;
}

export function prepareBars(data: BarCompareData): PreparedBars {
  const maxAbs = data.bars.reduce((m, b) => Math.max(m, Math.abs(b.value)), 0);
  const bars: PreparedBar[] = data.bars.map((b) => ({
    label: b.label,
    value: b.value,
    fraction: maxAbs === 0 ? 0 : Math.abs(b.value) / maxAbs,
  }));
  const out: PreparedBars = { bars };
  if (data.unit !== undefined) out.unit = data.unit;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/viz/__tests__/bars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viz/bars.ts src/lib/viz/__tests__/bars.test.ts
git commit -m "feat(viz): add prepareBars pure helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `vizComponentName` — exhaustive dispatcher (pure)

**Files:**
- Create: `src/lib/viz/dispatch.ts`
- Test: `src/lib/viz/__tests__/dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/viz/__tests__/dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { vizComponentName } from '@/lib/viz/dispatch';
import type { VizType } from '@/lib/types';

describe('vizComponentName', () => {
  it('maps each viz type to its component name', () => {
    expect(vizComponentName('embedding-scatter')).toBe('EmbeddingScatter');
    expect(vizComponentName('vector-table')).toBe('VectorTable');
    expect(vizComponentName('attention-heatmap')).toBe('AttentionHeatmap');
    expect(vizComponentName('bar-compare')).toBe('BarCompare');
  });

  it('covers every VizType (no missing case)', () => {
    const all: VizType[] = [
      'embedding-scatter',
      'vector-table',
      'attention-heatmap',
      'bar-compare',
    ];
    for (const t of all) {
      expect(typeof vizComponentName(t)).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/viz/__tests__/dispatch.test.ts`
Expected: FAIL — cannot find module `@/lib/viz/dispatch`.

- [ ] **Step 3: Implement the dispatcher**

Create `src/lib/viz/dispatch.ts`:

```ts
// src/lib/viz/dispatch.ts
// PURE, exhaustive mapping from a Viz `type` to the name of the React component
// that renders it. Lives in lib (not the .tsx dispatcher) so it can be
// unit-tested under the node-env vitest config. The switch has no `default`:
// adding a VizType without a case is a compile error (exhaustiveness via the
// `never` assignment).

import type { VizType } from '@/lib/types';

export type VizComponentName =
  | 'EmbeddingScatter'
  | 'VectorTable'
  | 'AttentionHeatmap'
  | 'BarCompare';

export function vizComponentName(type: VizType): VizComponentName {
  switch (type) {
    case 'embedding-scatter':
      return 'EmbeddingScatter';
    case 'vector-table':
      return 'VectorTable';
    case 'attention-heatmap':
      return 'AttentionHeatmap';
    case 'bar-compare':
      return 'BarCompare';
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/viz/__tests__/dispatch.test.ts && npm run typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/viz/dispatch.ts src/lib/viz/__tests__/dispatch.test.ts
git commit -m "feat(viz): add exhaustive vizComponentName dispatcher

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `EmbeddingScatter` component (headline viz)

**Files:**
- Create: `src/components/viz/EmbeddingScatter.tsx`

> No `.tsx` unit test (vitest is node-env + globs only `*.test.ts`). Correctness of the layout/branching is covered by `scatter.test.ts` (Task 4). This task is verified by `typecheck` + `build`.

- [ ] **Step 1: Implement the component**

Create `src/components/viz/EmbeddingScatter.tsx`:

```tsx
// src/components/viz/EmbeddingScatter.tsx
// The headline V-VIZ illustration: a 2D SVG scatter of precomputed embedding
// coords. Points colored by cluster; hover shows the label; an optional toggle
// draws the precomputed nearest-neighbor links. All geometry comes from the
// PURE prepareScatter helper (unit-tested) — this file is presentation only.
'use client';

import { useState } from 'react';
import type { EmbeddingScatterData } from '@/lib/types';
import { prepareScatter } from '@/lib/viz/scatter';

const WIDTH = 520;
const HEIGHT = 360;
const PADDING = 28;

export default function EmbeddingScatter({
  data,
  title,
}: {
  data: EmbeddingScatterData;
  title?: string;
}) {
  const [showLinks, setShowLinks] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const laid = prepareScatter(data, { width: WIDTH, height: HEIGHT, padding: PADDING });

  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title ?? 'Embedding space (2D projection)'}
        </span>
        {laid.links.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLinks((v) => !v)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100"
          >
            {showLinks ? 'Hide' : 'Show'} nearest neighbors
          </button>
        )}
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={title ?? 'Embedding scatter plot'}
      >
        {showLinks &&
          laid.links.map((l, i) => (
            <line
              key={`link-${i}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          ))}

        {laid.points.map((p, i) => (
          <g
            key={`pt-${i}`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            className="cursor-default"
          >
            <circle
              cx={p.cx}
              cy={p.cy}
              r={hovered === i ? 7 : 5}
              fill={p.color}
              fillOpacity={hovered === null || hovered === i ? 0.9 : 0.35}
              className="transition-all"
            />
            {hovered === i && (
              <text
                x={p.cx + 9}
                y={p.cy + 4}
                className="fill-slate-800 text-[11px]"
              >
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* Cluster legend */}
      <ul className="mt-2 flex flex-wrap gap-3">
        {laid.clusters.map((c) => (
          <li key={c.name} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            {c.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (component compiles; no SSR-only API misused — `useState` is fine in a `'use client'` component).

- [ ] **Step 3: Commit**

```bash
git add src/components/viz/EmbeddingScatter.tsx
git commit -m "feat(viz): add EmbeddingScatter SVG component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `VectorTable`, `AttentionHeatmap`, `BarCompare` components

**Files:**
- Create: `src/components/viz/VectorTable.tsx`
- Create: `src/components/viz/AttentionHeatmap.tsx`
- Create: `src/components/viz/BarCompare.tsx`

> Verified by `typecheck` + `build`. Logic is covered by the pure helpers (Tasks 5, 6) + the table is trivial pass-through.

- [ ] **Step 1: Implement `VectorTable`**

Create `src/components/viz/VectorTable.tsx`:

```tsx
// src/components/viz/VectorTable.tsx
// Styled token → example-dims table (the "token embeddings table", not ASCII).
// Pure pass-through of validated VectorTableData; no client interactivity needed.
import type { VectorTableData } from '@/lib/types';

export default function VectorTable({
  data,
  title,
}: {
  data: VectorTableData;
  title?: string;
}) {
  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-2 py-1 font-medium">token</th>
              {data.dims.map((d) => (
                <th key={d} className="px-2 py-1 text-right font-mono font-medium">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.token} className="border-b border-slate-100">
                <td className="px-2 py-1 font-medium text-slate-800">{row.token}</td>
                {row.values.map((v, i) => (
                  <td key={i} className="px-2 py-1 text-right font-mono text-slate-600">
                    {v.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
```

- [ ] **Step 2: Implement `AttentionHeatmap`**

Create `src/components/viz/AttentionHeatmap.tsx`:

```tsx
// src/components/viz/AttentionHeatmap.tsx
// Grid heatmap (for M03-style attention). Cell opacity = normalized intensity
// from the PURE prepareHeatmap helper (unit-tested). No client interactivity.
import type { AttentionHeatmapData } from '@/lib/types';
import { prepareHeatmap } from '@/lib/viz/heatmap';

export default function AttentionHeatmap({
  data,
  title,
}: {
  data: AttentionHeatmapData;
  title?: string;
}) {
  const prepared = prepareHeatmap(data);
  const cols = prepared.colLabels.length;

  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: `auto repeat(${cols}, minmax(2rem, 1fr))` }}
        >
          {/* Header row: empty corner + column labels */}
          <div />
          {prepared.colLabels.map((c) => (
            <div key={`col-${c}`} className="px-1 text-center text-[10px] text-slate-500">
              {c}
            </div>
          ))}
          {/* Body rows */}
          {prepared.rowLabels.map((rowLabel, r) => (
            <RowFragment
              key={`row-${r}`}
              rowLabel={rowLabel}
              cells={prepared.cells.filter((cell) => cell.row === r)}
            />
          ))}
        </div>
      </div>
    </figure>
  );
}

function RowFragment({
  rowLabel,
  cells,
}: {
  rowLabel: string;
  cells: { col: number; value: number; intensity: number }[];
}) {
  return (
    <>
      <div className="pr-1 text-right text-[10px] leading-8 text-slate-500">{rowLabel}</div>
      {cells
        .slice()
        .sort((a, b) => a.col - b.col)
        .map((cell) => (
          <div
            key={`cell-${cell.col}`}
            title={cell.value.toFixed(3)}
            className="h-8 rounded-sm"
            style={{ backgroundColor: `rgba(37, 99, 235, ${cell.intensity})` }}
          />
        ))}
    </>
  );
}
```

- [ ] **Step 3: Implement `BarCompare`**

Create `src/components/viz/BarCompare.tsx`:

```tsx
// src/components/viz/BarCompare.tsx
// Labeled horizontal bars (for benchmark-style numbers). Bar width = fraction
// from the PURE prepareBars helper (unit-tested). No client interactivity.
import type { BarCompareData } from '@/lib/types';
import { prepareBars } from '@/lib/viz/bars';

export default function BarCompare({
  data,
  title,
}: {
  data: BarCompareData;
  title?: string;
}) {
  const prepared = prepareBars(data);

  return (
    <figure className="my-4 rounded-lg border border-slate-200 bg-white p-4">
      {title && (
        <figcaption className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </figcaption>
      )}
      <ul className="space-y-2">
        {prepared.bars.map((b) => (
          <li key={b.label} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 truncate text-slate-700" title={b.label}>
              {b.label}
            </span>
            <span className="relative h-5 flex-1 rounded bg-slate-100">
              <span
                className="absolute inset-y-0 left-0 rounded bg-blue-500 transition-all"
                style={{ width: `${(b.fraction * 100).toFixed(1)}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-slate-600">
              {b.value}
              {prepared.unit ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/viz/VectorTable.tsx src/components/viz/AttentionHeatmap.tsx src/components/viz/BarCompare.tsx
git commit -m "feat(viz): add VectorTable, AttentionHeatmap, BarCompare components

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `VizBlock` dispatcher component

**Files:**
- Create: `src/components/viz/VizBlock.tsx`

> Verified by `typecheck` + `build`; the dispatch logic itself is unit-tested via `vizComponentName` (Task 7). `VizBlock` re-uses that switch to pick the component (keeping one source of truth for exhaustiveness) and narrows `viz.data` per-branch.

- [ ] **Step 1: Implement `VizBlock`**

Create `src/components/viz/VizBlock.tsx`:

```tsx
// src/components/viz/VizBlock.tsx
// Maps a parsed Viz to its component. The switch mirrors vizComponentName
// (Task 7, unit-tested for exhaustiveness): adding a VizType without a case
// here is a compile error via the `never` assignment in the default branch.
// `viz.data` is `unknown` at the type level (validated at parse time), so each
// branch casts to the per-type payload the component expects.
import type {
  Viz,
  EmbeddingScatterData,
  VectorTableData,
  AttentionHeatmapData,
  BarCompareData,
} from '@/lib/types';
import EmbeddingScatter from '@/components/viz/EmbeddingScatter';
import VectorTable from '@/components/viz/VectorTable';
import AttentionHeatmap from '@/components/viz/AttentionHeatmap';
import BarCompare from '@/components/viz/BarCompare';

export default function VizBlock({ viz }: { viz: Viz }) {
  switch (viz.type) {
    case 'embedding-scatter':
      return <EmbeddingScatter data={viz.data as EmbeddingScatterData} title={viz.title} />;
    case 'vector-table':
      return <VectorTable data={viz.data as VectorTableData} title={viz.title} />;
    case 'attention-heatmap':
      return <AttentionHeatmap data={viz.data as AttentionHeatmapData} title={viz.title} />;
    case 'bar-compare':
      return <BarCompare data={viz.data as BarCompareData} title={viz.title} />;
    default: {
      const _exhaustive: never = viz.type;
      return _exhaustive;
    }
  }
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/viz/VizBlock.tsx
git commit -m "feat(viz): add VizBlock dispatcher component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Render `module.visuals` in the reader

**Files:**
- Modify: `src/components/ModuleReaderClient.tsx`

> Verified by `typecheck` + `build` + manual `npm run dev` smoke. The visuals render between the pass body / DiagramPane and the practice section, so existing diagram rendering is untouched.

- [ ] **Step 1: Add the import**

In `src/components/ModuleReaderClient.tsx`, add after the `import DiagramPane from '@/components/DiagramPane';` line:

```tsx
import VizBlock from '@/components/viz/VizBlock';
```

- [ ] **Step 2: Render the visuals block**

In `ModuleReaderClient.tsx`, immediately AFTER the existing DiagramPane JSX:

```tsx
      {/* Diagrams from the module's engineer pass. Returns null when empty. */}
      <DiagramPane diagrams={module.diagrams} />
```

insert:

```tsx
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
```

- [ ] **Step 3: Typecheck + build + lint**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `CURRICULUM_DIR=src/lib/ingest/__tests__/fixtures npm run dev` then open `http://localhost:3000/module/B01` and confirm the BarCompare viz renders below the diagrams. Stop the dev server.

> If the fixtures dir lacks the supporting files the route needs (sources/state), skip the dev smoke — `npm run build` compiling the route is sufficient gate evidence; the real content lands in Task 12.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModuleReaderClient.tsx
git commit -m "feat(viz): render module.visuals via VizBlock in the reader

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Deepen M02 curriculum content (Obsidian — NOT git-added)

**Files:**
- Modify: `/Users/unmukt/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/M02-embeddings.md`

> This is CURRICULUM CONTENT living in the Obsidian vault, NOT repo code. Edit it; do **NOT** `git add` it to the llm-tutor repo. Verification: run the existing parser over it (a temporary node check) to confirm it round-trips and the visuals validate. The precomputed coords are hand-authored fixtures — the negation case "not a bank" deliberately sits NEAR "bank" (the failure mode), and clusters are labeled `finance` / `ai` / `generic`.

- [ ] **Step 1: Rewrite the engineer pass into real prose + add the Visuals section + worked examples**

In `M02-embeddings.md`, replace the entire `### Engineer pass` block (currently the bullet list ending with the `Diagram: token embeddings table...` line, lines ~28–36) with this prose-first version:

```markdown
### Engineer pass

A token never enters a transformer as text. It enters as a row pulled from an embedding matrix of shape `vocab_size × d_model`: the token's integer id is the row index, and that row — a vector of `d_model` floats — IS the token's meaning, the only meaning the model ever sees. Training nudges these rows so that tokens used in similar contexts end up with similar vectors. That is the whole trick: "meaning" is *position in a high-dimensional space*, learned from co-occurrence.

A sentence embedding is built by **pooling** the token vectors — mean-pooling, taking the `[CLS]` position, or (best) a model fine-tuned specifically to make the pooled vector a good sentence representation (sentence-transformers, E5, BGE). Pooling choice matters: mean-pooling a raw LLM's token vectors is a famously weak sentence encoder, which is why purpose-built embedding models exist.

Similarity is almost always **cosine similarity** — the cosine of the angle between two vectors, ignoring their magnitude. cos = 1 means same direction (synonymous-ish), cos = 0 means orthogonal (unrelated), cos < 0 means opposed. It is the dominant metric because embedding magnitude is mostly noise; direction carries the semantics.

Cosine breaks in three ways worth memorizing, because every one of them shows up in production RAG:
- **Negation.** "employees covered by the policy" and "employees NOT covered by the policy" sit almost on top of each other — the single token "not" barely moves a 1024-dim vector, so the two opposite meanings look ~95% similar. This is the canonical failure case (see the scatter below: "not a bank" lands right next to "bank").
- **Polysemy.** "bank" (river) and "bank" (finance) collapse to one vector in a static embedding; only contextual/sentence embeddings separate them.
- **Syntactic vs semantic.** "dog bites man" and "man bites dog" are near-identical under bag-of-meaning pooling though their meaning is opposite.

Embedding model families you'll actually meet: OpenAI `text-embedding-3-{small,large}` (and the legacy `ada-002`), Cohere Embed v3, and the strong open-weight set — BGE, E5, jina. Dimensionality is a real trade-off: 384 dims (MiniLM) is fast and cheap and often *enough*; 1024 (BGE-large) and 3072 (`text-embedding-3-large`) buy accuracy on hard, long-tail retrieval at higher storage + latency cost. The instinct "bigger is always better" is wrong — measure on YOUR corpus.

**Worked example — cosine similarity by hand.** Take two toy 3-dim embeddings:

- `a = "investment bank"  → [0.9, 0.1, 0.2]`
- `b = "Goldman Sachs"    → [0.8, 0.2, 0.1]`

cosine(a, b) = (a·b) / (‖a‖ · ‖b‖)

- dot product a·b = 0.9·0.8 + 0.1·0.2 + 0.2·0.1 = 0.72 + 0.02 + 0.02 = **0.76**
- ‖a‖ = √(0.81 + 0.01 + 0.04) = √0.86 ≈ **0.927**
- ‖b‖ = √(0.64 + 0.04 + 0.01) = √0.69 ≈ **0.831**
- cosine = 0.76 / (0.927 · 0.831) = 0.76 / 0.770 ≈ **0.987** → near-synonymous, as expected.

Now the negation trap. Take:

- `q = "not a bank"  → [0.85, 0.15, 0.18]`  (the "not" barely perturbs it)
- `c = "a bank"      → [0.88, 0.12, 0.20]`

dot = 0.748 + 0.018 + 0.036 = 0.802; ‖q‖ ≈ 0.876; ‖c‖ ≈ 0.912 → cosine ≈ 0.802 / 0.799 ≈ **1.00**. The model thinks "not a bank" and "a bank" are the *same thing*. That single number is why naive semantic search hands a negated query exactly the document the user was trying to exclude.

The two visualizations below make this concrete: a token-embeddings table (token → a few example dims) and a 2D projection of ~18 phrases where you can *see* "not a bank" sitting inside the finance cluster.
```

- [ ] **Step 2: Add a `## Visuals` section** immediately AFTER the `### Operator pass` block and BEFORE `## Lab spec`. Use real triple-backtick fences (shown here with four backticks only to nest in this plan):

````markdown
## Visuals

```viz
{
  "type": "vector-table",
  "title": "Token → example embedding dims (toy, 3 of d_model)",
  "data": {
    "dims": ["d0", "d1", "d2"],
    "rows": [
      { "token": "bank", "values": [0.88, 0.12, 0.20] },
      { "token": "investment bank", "values": [0.90, 0.10, 0.20] },
      { "token": "Goldman Sachs", "values": [0.80, 0.20, 0.10] },
      { "token": "not a bank", "values": [0.85, 0.15, 0.18] },
      { "token": "AI agent", "values": [-0.60, 0.70, 0.10] },
      { "token": "river", "values": [0.10, -0.80, 0.30] }
    ]
  }
}
```

```viz
{
  "type": "embedding-scatter",
  "title": "2D projection — financial / AI / generic phrases (note: 'not a bank' lands inside the finance cluster)",
  "data": {
    "points": [
      { "label": "bank", "x": 4.1, "y": 3.0, "cluster": "finance" },
      { "label": "investment bank", "x": 4.6, "y": 3.4, "cluster": "finance" },
      { "label": "Goldman Sachs", "x": 5.0, "y": 2.6, "cluster": "finance" },
      { "label": "JPMorgan", "x": 4.8, "y": 3.6, "cluster": "finance" },
      { "label": "hedge fund", "x": 4.2, "y": 2.2, "cluster": "finance" },
      { "label": "interest rate", "x": 3.6, "y": 3.1, "cluster": "finance" },
      { "label": "not a bank", "x": 4.3, "y": 2.9, "cluster": "finance" },
      { "label": "AI agent", "x": -4.5, "y": 3.2, "cluster": "ai" },
      { "label": "neural network", "x": -4.0, "y": 3.8, "cluster": "ai" },
      { "label": "embedding model", "x": -4.8, "y": 2.6, "cluster": "ai" },
      { "label": "transformer", "x": -3.7, "y": 2.9, "cluster": "ai" },
      { "label": "RAG retrieval", "x": -4.2, "y": 2.1, "cluster": "ai" },
      { "label": "token", "x": -3.9, "y": 3.4, "cluster": "ai" },
      { "label": "weather", "x": 0.2, "y": -4.1, "cluster": "generic" },
      { "label": "breakfast", "x": -0.4, "y": -4.6, "cluster": "generic" },
      { "label": "river", "x": 0.6, "y": -3.7, "cluster": "generic" },
      { "label": "bicycle", "x": -0.1, "y": -4.3, "cluster": "generic" },
      { "label": "holiday", "x": 0.9, "y": -3.9, "cluster": "generic" }
    ],
    "links": [
      { "from": 0, "to": 6 },
      { "from": 0, "to": 1 },
      { "from": 7, "to": 8 }
    ]
  }
}
```
````

- [ ] **Step 3: Round-trip the file through the real parser**

Run (from the repo root) a one-shot node check that parses the edited file and asserts the visuals validated. This uses `tsx` if available, else compiles via the project. Simplest reliable path — a tiny throwaway script in `/tmp` (per the "no /tmp for project storage" rule this is a true one-time verification, not stored state):

```bash
cd /Users/unmukt/llm-tutor && cat > /tmp/check-m02.mjs <<'EOF'
import { readFile } from 'node:fs/promises';
import { parseModule } from './src/lib/ingest/parse-module.ts';
const raw = await readFile(
  process.env.HOME + '/Obsidian/Trustevals/Trustevals/Operations/Learning/LLM-Curriculum/M02-embeddings.md',
  'utf8',
);
const m = parseModule(raw);
console.log('id', m.id, 'visuals', m.visuals.map((v) => v.type));
if (m.visuals.length !== 2) throw new Error('expected 2 visuals, got ' + m.visuals.length);
if (m.visuals[0].type !== 'vector-table') throw new Error('viz[0] not vector-table');
if (m.visuals[1].type !== 'embedding-scatter') throw new Error('viz[1] not embedding-scatter');
console.log('OK — M02 round-trips and both visuals validate');
EOF
npx tsx /tmp/check-m02.mjs && rm /tmp/check-m02.mjs
```

Expected output: `id M02 visuals [ 'vector-table', 'embedding-scatter' ]` then `OK — M02 round-trips and both visuals validate`.

> If `npx tsx` is unavailable, fall back to a vitest scratch test that imports `parseModule` and reads the file (vitest already resolves `.ts` + the `@` alias), then delete it. Do NOT add a permanent test that depends on the Obsidian path (it's machine-specific and not in the repo).

- [ ] **Step 4: Confirm the M02 .md is NOT staged for the repo**

Run: `cd /Users/unmukt/llm-tutor && git status --porcelain`
Expected: NO entry for any path under `Obsidian/` (the file lives outside the repo tree entirely, so it will not appear — confirm the working tree shows only the plan doc + Task 1–11 code). Do NOT `git add` the curriculum file.

- [ ] **Step 5: No commit for the curriculum edit**

The M02 edit is Obsidian content, not repo code — there is nothing to commit in the llm-tutor repo for this task. (The repo-side work was committed in Tasks 1–11.) If anything under `src/` changed while iterating on M02, that is a bug — revert it; only the `.md` should have changed.

---

### Task 13: Full-suite green gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `cd /Users/unmukt/llm-tutor && npm run test && npm run typecheck && npm run lint && npm run build`
Expected: ALL PASS — every viz/parser test green, typecheck clean, lint clean, `next build` succeeds.

- [ ] **Step 2: Commit any final lint fixups (if lint surfaced auto-fixable issues)**

```bash
git add -A -- ':!*/Obsidian/*'
git commit -m "chore(viz): full-suite green for V-VIZ

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> If there is nothing to commit (the prior task commits already left the tree clean), skip this step.

---

## Stretch / follow-on (NOT required for v1b)

Applying the deepening pattern established in Task 12 to **M01** and **M03** is a follow-on, not part of this plan:
- **M03 (attention)** is the natural home for the `attention-heatmap` viz — a small precomputed attention matrix over a toy sentence (e.g. "The cat sat") makes a strong illustration. The component + helper already exist after Tasks 5 + 9, so M03's deepening is content-only (rewrite the engineer pass + add an `## Visuals` `attention-heatmap` block, same shape as Task 12).
- **M01** can reuse `vector-table` / `bar-compare` similarly.
These are deferred so v1b ships the *mechanism* + the headline M02 illustration without scope-creeping into every module.

---

## Self-Review

**1. Spec coverage (v1-spec §2 "V-VIZ"):**
- "viz content mechanism — extend parser + types, backward-compatible" → Tasks 1 (types), 2 (`parseVisuals` + validation), 3 (wired into `parseModule`, backward-compat test). Chosen mechanism: `## Visuals` section of ` ```viz ` JSON blocks. ✓
- "viz component system in `src/components/viz/`, each with a pure unit-tested data-prep helper" → Tasks 4–6 (pure helpers `prepareScatter`/`prepareHeatmap`/`prepareBars`, all unit-tested), Tasks 8–9 (the four components). ✓
- "EmbeddingScatter — 2D SVG, labeled, cluster-colored, hover label, NN-link toggle, precomputed coords, headline" → Task 8 (uses precomputed coords via `prepareScatter`; hover + link toggle present). ✓
- "VectorTable / AttentionHeatmap / BarCompare" → Task 9. ✓
- "VizBlock dispatcher mapping type→component, exhaustive + tested" → Task 7 (`vizComponentName` exhaustive + unit-tested via `never`) + Task 10 (`VizBlock` reuses the same exhaustive switch). ✓
- "Reader integration — render visuals inline, don't break diagrams" → Task 11 (renders after DiagramPane; DiagramPane untouched; test in Task 3 asserts viz blocks are NOT counted as diagrams). ✓
- "Deepen M02 — real engineer prose, replace placeholder Diagram line with embedding-scatter (~16–20 pts incl. 'not a bank' near 'bank', clustered+labeled), add vector-table, worked cosine examples" → Task 12 (18 scatter points incl. the negation case in the finance cluster, vector-table, two worked cosine computations). ✓
- "Note: M01/M03 is stretch" → covered in the Stretch section. ✓
- Constraints: parser + data-prep + dispatcher are PURE + vitest-tested (`.ts`, node env) ✓; components gated by typecheck/build not jsdom ✓; backward-compatible parsing (Tasks 2 + 3 tests) ✓; each task ends green ✓; trailer on every commit ✓; M02 .md edited not git-added (Task 12 Steps 4–5) ✓.

**2. Placeholder scan:** No "TBD / handle edge cases / similar to Task N / write tests for the above". Every code step contains complete code; every test step contains full test bodies. ✓

**3. Type consistency:** `Viz`, `VizType`, `EmbeddingScatterData`, `VectorTableData`, `AttentionHeatmapData`, `BarCompareData`, `ScatterPoint` defined once in Task 1 and referenced verbatim thereafter. Helper return types (`PreparedScatter`/`LaidOutPoint`, `PreparedHeatmap`/`HeatmapCell`, `PreparedBars`/`PreparedBar`) defined in their creating tasks (4/5/6) and consumed by the matching components (8/9). `vizComponentName` / `VizComponentName` (Task 7) names match `VizBlock`'s component imports (Task 10). `parseVisuals(visualsSection)` signature is consistent between Task 2 (definition) and Task 3 (call site `parseVisuals(sections.get('Visuals'))`). `Module.visuals` field name consistent across Tasks 1, 3, 11. ✓

No issues found on review.