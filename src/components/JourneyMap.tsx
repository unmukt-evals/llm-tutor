// src/components/JourneyMap.tsx
// Client component: renders the React Flow journey map.
// Receives nodes + edges already derived server-side by deriveNodesEdges
// (src/lib/map/derive-nodes-edges.ts) — NO business logic lives here. The
// component is a thin adapter: it feeds the pre-derived MapNode[]/MapEdge[]
// into React Flow's local node/edge state so drag positions work, and exposes
// an optional onNodeClick hook (navigation is wired up in a later task).
'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MapNode, MapEdge } from '@/lib/map/derive-nodes-edges';

interface JourneyMapProps {
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
  /** Optional click handler — node-click navigation is built in a later task. */
  onNodeClick?: (moduleId: string) => void;
}

export default function JourneyMap({
  initialNodes,
  initialEdges,
  onNodeClick,
}: JourneyMapProps) {
  // MapNode/MapEdge are plain-TS shapes that match React Flow's Node/Edge at
  // runtime (id, position, data, style / id, source, target, style). Cast on
  // the way in so React Flow's hooks can manage local drag state.
  const [nodes, , onNodesChange] = useNodesState(initialNodes as Node[]);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges as Edge[]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
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
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
