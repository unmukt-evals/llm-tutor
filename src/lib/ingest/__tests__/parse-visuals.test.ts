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

  it('parses an attention-heatmap block', () => {
    const block = `
\`\`\`viz
{ "type": "attention-heatmap", "data": { "rowLabels": ["The"], "colLabels": ["cat"], "matrix": [[0.5]] } }
\`\`\`
`;
    const out = parseVisuals(block);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('attention-heatmap');
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

  it('drops an attention-heatmap whose matrix dims mismatch labels', () => {
    const bad =
      '```viz\n{ "type": "attention-heatmap", "data": { "rowLabels": ["a","b"], "colLabels": ["c"], "matrix": [[1]] } }\n```\n';
    expect(parseVisuals(bad)).toEqual([]);
  });

  it('drops a bar-compare with a non-numeric value', () => {
    const bad =
      '```viz\n{ "type": "bar-compare", "data": { "bars": [{ "label": "a", "value": "nope" }] } }\n```\n';
    expect(parseVisuals(bad)).toEqual([]);
  });

  it('ignores non-viz fences (e.g. mermaid) in the section', () => {
    const mixed = '```mermaid\ngraph TD\nA-->B\n```\n' + scatterBlock;
    const out = parseVisuals(mixed);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('embedding-scatter');
  });
});
