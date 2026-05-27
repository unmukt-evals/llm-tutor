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
    const trimmed = line.trimStart();
    const open = /^```viz\s*$/.exec(trimmed);
    const close = /^```\s*$/.exec(trimmed);
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
