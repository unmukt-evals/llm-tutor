// src/components/JourneyMap.tsx
// Client component: renders the React Flow journey map.
// Receives nodes + edges already derived server-side by deriveNodesEdges
// (src/lib/map/derive-nodes-edges.ts) — NO business logic lives here. The
// component is a thin adapter: it feeds the pre-derived MapNode[]/MapEdge[]
// into React Flow's local node/edge state so drag positions work, and
// navigates to /module/<id> on node click (Task 11).
'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
}

export default function JourneyMap({
  initialNodes,
  initialEdges,
}: JourneyMapProps) {
  const router = useRouter();

  // MapNode/MapEdge are plain-TS shapes that match React Flow's Node/Edge at
  // runtime (id, position, data, style / id, source, target, style). Cast on
  // the way in so React Flow's hooks can manage local drag state.
  const [nodes, , onNodesChange] = useNodesState(initialNodes as Node[]);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges as Edge[]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
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
