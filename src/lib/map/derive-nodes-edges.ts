// src/lib/map/derive-nodes-edges.ts
// Pure derivation: Curriculum + TutorState -> React-Flow-shaped nodes + edges.
// No React import, no fetch — plain TS so it is unit-testable with Vitest.
// The JourneyMap client component renders these as-is; all logic lives here.

import type { CSSProperties } from 'react';
import type { Curriculum, TutorState, Mastery, TrackId } from '@/lib/types';

export interface MapNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label: string; mastery: Mastery };
  style?: CSSProperties;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  style?: CSSProperties;
}

// Node fill by mastery (build-spec colour tokens).
const MASTERY_COLOR: Record<Mastery, string> = {
  blank: '#e2e8f0', // slate-200
  fuzzy: '#fef9c3', // yellow-100
  solid: '#bbf7d0', // green-200
  verified: '#6ee7b7', // emerald-300
};

// Track lanes: A=80, B=400, C=720 (left-to-right).
const TRACK_X: Record<TrackId, number> = {
  A: 80,
  B: 400,
  C: 720,
};

const ROW_HEIGHT = 120;

/**
 * Derive React-Flow nodes + edges from a Curriculum and the current TutorState.
 *
 * Nodes: one per Module. x is the module's track lane; y is the module's index
 * WITHIN its own track (per-track stacking) * ROW_HEIGHT. Each node carries the
 * module's mastery from state (default 'blank' if the module isn't in
 * state.modules) plus the matching fill colour.
 *
 * Edges: one dashed soft-lock edge per prerequisite, source=prereq -> target=module.
 * A prerequisite that does not resolve to a module in the curriculum is dropped
 * (no dangling edge).
 */
export function deriveNodesEdges(
  curriculum: Curriculum,
  state: TutorState
): { nodes: MapNode[]; edges: MapEdge[] } {
  // Per-track running index so each lane stacks from y=0 independently.
  const trackIndex: Partial<Record<TrackId, number>> = {};

  const nodes: MapNode[] = curriculum.modules.map((mod) => {
    const track = mod.track;
    const idx = trackIndex[track] ?? 0;
    trackIndex[track] = idx + 1;

    const mastery: Mastery = state.modules[mod.id]?.mastery ?? 'blank';

    return {
      id: mod.id,
      position: { x: TRACK_X[track] ?? TRACK_X.A, y: idx * ROW_HEIGHT },
      data: { label: mod.name, mastery },
      style: { background: MASTERY_COLOR[mastery], borderRadius: 8, padding: 8 },
    };
  });

  const edges: MapEdge[] = [];
  for (const mod of curriculum.modules) {
    for (const prereqId of mod.prerequisites) {
      // Drop dangling prerequisites that don't resolve to a real module.
      if (!curriculum.byId(prereqId)) continue;
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
