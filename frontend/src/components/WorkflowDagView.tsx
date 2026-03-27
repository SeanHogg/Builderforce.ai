'use client';

/**
 * WorkflowDagView — SVG-based visual dependency graph for a workflow (P4-1).
 *
 * Uses a simple Kahn's-algorithm topological sort to assign each node a
 * column (layer), then distributes nodes within each layer vertically.
 * Edges are drawn as cubic-bezier SVG paths.
 *
 * No external dependency required — pure SVG + React.
 */

import { useMemo } from 'react';
import type { WorkflowGraphNode, WorkflowGraphEdge } from '@/lib/builderforceApi';

const STATUS_COLORS: Record<string, string> = {
  pending:   'var(--text-muted, #8a8f9c)',
  running:   'var(--cyan-bright, #00e5cc)',
  completed: 'rgba(34,197,94,0.9)',
  failed:    'var(--coral-bright, #f4726e)',
};

const NODE_W = 180;
const NODE_H = 56;
const COL_GAP = 100;
const ROW_GAP = 24;

interface PositionedNode extends WorkflowGraphNode {
  col: number;
  row: number;
  x: number;
  y: number;
}

/** Assign nodes to columns via Kahn's algorithm. */
function assignLayers(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): Map<string, number> {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outEdges = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    const arr = outEdges.get(e.from);
    if (arr) arr.push(e.to);
  }

  const col = new Map<string, number>();
  const queue: string[] = [];

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const curCol = col.get(id) ?? 0;
    for (const next of outEdges.get(id) ?? []) {
      const nextCol = Math.max(col.get(next) ?? 0, curCol + 1);
      col.set(next, nextCol);
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg <= 0) queue.push(next);
    }
    if (!col.has(id)) col.set(id, 0);
  }

  // Assign any remaining (cycle / disconnected) nodes
  for (const n of nodes) {
    if (!col.has(n.id)) col.set(n.id, 0);
  }

  return col;
}

function layoutNodes(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
): PositionedNode[] {
  const colMap = assignLayers(nodes, edges);

  // Group by column
  const byCol = new Map<number, WorkflowGraphNode[]>();
  for (const n of nodes) {
    const c = colMap.get(n.id) ?? 0;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n);
  }

  const positioned: PositionedNode[] = [];
  for (const [colIdx, colNodes] of byCol) {
    colNodes.forEach((n, rowIdx) => {
      positioned.push({
        ...n,
        col: colIdx,
        row: rowIdx,
        x: colIdx * (NODE_W + COL_GAP),
        y: rowIdx * (NODE_H + ROW_GAP),
      });
    });
  }
  return positioned;
}

interface Props {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  onNodeClick?: (node: WorkflowGraphNode) => void;
}

export function WorkflowDagView({ nodes, edges, onNodeClick }: Props) {
  const positioned = useMemo(() => layoutNodes(nodes, edges), [nodes, edges]);

  if (positioned.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
        No tasks in this workflow yet.
      </div>
    );
  }

  const posMap = new Map(positioned.map((n) => [n.id, n]));

  const maxX = Math.max(...positioned.map((n) => n.x)) + NODE_W;
  const maxY = Math.max(...positioned.map((n) => n.y)) + NODE_H;
  const svgW = maxX + 24;
  const svgH = maxY + 24;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 480 }}>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`-12 -12 ${svgW} ${svgH}`}
        style={{ display: 'block' }}
      >
        {/* Edges */}
        {edges.map((e, i) => {
          const src = posMap.get(e.from);
          const dst = posMap.get(e.to);
          if (!src || !dst) return null;
          const x1 = src.x + NODE_W;
          const y1 = src.y + NODE_H / 2;
          const x2 = dst.x;
          const y2 = dst.y + NODE_H / 2;
          const cx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="var(--border-subtle, rgba(255,255,255,0.1))"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker
            id="arrow"
            markerWidth={8}
            markerHeight={8}
            refX={6}
            refY={3}
            orient="auto"
          >
            <path
              d="M0,0 L0,6 L8,3 z"
              fill="var(--border-subtle, rgba(255,255,255,0.15))"
            />
          </marker>
        </defs>

        {/* Nodes */}
        {positioned.map((n) => {
          const color = STATUS_COLORS[n.status] ?? STATUS_COLORS.pending;
          const isActive = n.status === 'running';
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
              onClick={() => onNodeClick?.(n)}
            >
              {/* Card background */}
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill="var(--bg-elevated, #1a1c23)"
                stroke={isActive ? color : 'var(--border-subtle, rgba(255,255,255,0.08))'}
                strokeWidth={isActive ? 1.5 : 1}
              />
              {/* Left accent bar */}
              <rect
                x={0}
                y={0}
                width={3}
                height={NODE_H}
                rx={2}
                fill={color}
                opacity={0.85}
              />
              {/* Role label */}
              <text
                x={12}
                y={19}
                fontSize={9}
                fontWeight={700}
                fill={color}
                style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {(n.role ?? 'agent').slice(0, 20)}
              </text>
              {/* Description */}
              <text
                x={12}
                y={34}
                fontSize={11}
                fontWeight={600}
                fill="var(--text-primary, #e2e5ec)"
              >
                {n.label.slice(0, 22)}
                {n.label.length > 22 ? '…' : ''}
              </text>
              {/* Duration / cost */}
              {(n.durationMs != null || n.estimatedCostUsd != null) && (
                <text
                  x={12}
                  y={48}
                  fontSize={9}
                  fill="var(--text-muted, #8a8f9c)"
                >
                  {n.durationMs != null ? `${(n.durationMs / 1000).toFixed(1)}s` : ''}
                  {n.durationMs != null && n.estimatedCostUsd != null ? '  ·  ' : ''}
                  {n.estimatedCostUsd != null ? `$${n.estimatedCostUsd.toFixed(4)}` : ''}
                </text>
              )}
              {/* Status dot (top-right) */}
              <circle
                cx={NODE_W - 10}
                cy={10}
                r={4}
                fill={color}
                opacity={0.9}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
