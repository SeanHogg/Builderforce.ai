'use client';

import { ControlButton, Controls, MiniMap, type Edge, type Node } from '@xyflow/react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import styles from './CanvasCommands.module.css';

function MinimapIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2 10.5 5.5 7l2.3 2.2L11 5.7l3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>;
}

function CleanLayoutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.75" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="1.75" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.3 1.3" />
  </svg>;
}

type CanvasCommandsProps = {
  minimapOpen: boolean;
  setMinimapOpen: Dispatch<SetStateAction<boolean>>;
  onCleanLayout: () => void;
  showInteractive?: boolean;
  minimapNodeColor?: string | ((node: Node) => string);
  minimapMaskColor?: string;
  minimapStyle?: CSSProperties;
};

/** The common command rail and dismissible mini map used by every spatial canvas. */
export function CanvasCommands({
  minimapOpen,
  setMinimapOpen,
  onCleanLayout,
  showInteractive = true,
  minimapNodeColor,
  minimapMaskColor,
  minimapStyle,
}: CanvasCommandsProps) {
  return <>
    <Controls position="bottom-left" showInteractive={showInteractive}>
      <ControlButton onClick={onCleanLayout} aria-label="Clean up canvas layout" title="Clean up canvas layout">
        <CleanLayoutIcon />
      </ControlButton>
      <ControlButton
        onClick={() => setMinimapOpen((open) => !open)}
        aria-label="Toggle mini map"
        aria-pressed={minimapOpen}
        title={minimapOpen ? 'Hide mini map' : 'Show mini map'}
      >
        <MinimapIcon />
      </ControlButton>
    </Controls>
    {minimapOpen && <>
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={minimapNodeColor}
        maskColor={minimapMaskColor}
        style={minimapStyle}
      />
      <button type="button" className={styles.minimapClose} onClick={() => setMinimapOpen(false)} aria-label="Close mini map" title="Close mini map">×</button>
    </>}
  </>;
}

const nodeSize = (node: Node) => ({
  width: node.measured?.width ?? node.width ?? (Number(node.style?.width) || 260),
  height: node.measured?.height ?? node.height ?? (Number(node.style?.height) || 150),
});

/** Deterministically spaces nodes into graph layers, or a compact grid when there are no connections. */
export function cleanCanvasLayout<T extends Node>(nodes: T[], edges: Edge[]): T[] {
  if (nodes.length < 2) return nodes;
  const horizontalGap = 88;
  const verticalGap = 64;
  const ids = new Set(nodes.map((node) => node.id));
  const usableEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target);

  if (usableEdges.length === 0) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const columnWidths = Array.from({ length: columns }, () => 0);
    const rowHeights: number[] = [];
    nodes.forEach((node, index) => {
      const size = nodeSize(node);
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnWidths[column] = Math.max(columnWidths[column], size.width);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, size.height);
    });
    const xs = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, width) => sum + width + horizontalGap, 0));
    const ys = rowHeights.map((_, index) => rowHeights.slice(0, index).reduce((sum, height) => sum + height + verticalGap, 0));
    return nodes.map((node, index) => ({ ...node, position: { x: xs[index % columns], y: ys[Math.floor(index / columns)] } }));
  }

  const successors = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of usableEdges) {
    successors.set(edge.source, [...(successors.get(edge.source) ?? []), edge.target]);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    visited.add(id);
    for (const target of successors.get(id) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  // Cyclic nodes still get a stable layer instead of remaining piled together.
  let cycleRank = Math.max(...rank.values()) + 1;
  for (const node of nodes) if (!visited.has(node.id)) rank.set(node.id, cycleRank++);

  const layers = new Map<number, T[]>();
  for (const node of nodes) layers.set(rank.get(node.id) ?? 0, [...(layers.get(rank.get(node.id) ?? 0) ?? []), node]);
  const orderedLayers = [...layers.entries()].sort(([a], [b]) => a - b);
  let x = 0;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [, layerNodes] of orderedLayers) {
    let y = 0;
    let layerWidth = 0;
    for (const node of layerNodes) {
      const size = nodeSize(node);
      positions.set(node.id, { x, y });
      y += size.height + verticalGap;
      layerWidth = Math.max(layerWidth, size.width);
    }
    x += layerWidth + horizontalGap;
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
