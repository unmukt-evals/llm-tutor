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
      // Graceful fallback for an unknown type (shouldn't happen post-validation).
      const _exhaustive: never = viz.type;
      void _exhaustive;
      return null;
    }
  }
}
