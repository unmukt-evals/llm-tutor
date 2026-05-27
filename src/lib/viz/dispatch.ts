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
