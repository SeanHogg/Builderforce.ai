'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  ReactFlow, Background, Controls, MarkerType,
  useNodesState, useEdgesState, type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { pmoApi, type ValueStream, type ValueStreamInitiative, type ValueStreamEdge } from '@/lib/builderforceApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError } from '@/components/pm/pmShared';

/**
 * Value stream — the cross-artifact value-delivery graph: initiatives as nodes
 * (coloured by status, labelled with delivery %), dependency blockers as edges,
 * and the critical path (longest chain of still-incomplete initiatives) highlighted
 * so "where is value stuck in the chain" is visible at a glance. Read-only; the
 * dependency math + node progress come pre-computed from /api/pmo/value-stream.
 */

const STATUS_COLOR: Record<string, string> = {
  proposed: '#6b7280', active: '#2563eb', completed: '#16a34a', archived: '#9ca3af',
};
const CRITICAL_COLOR = '#dc2626';
const COL_W = 240;
const ROW_H = 96;

/** Longest-path layering over blocker→blocked edges (cycle nodes fall to layer 0). */
function layout(nodes: ValueStreamInitiative[], edges: ValueStreamEdge[]): Map<string, { x: number; y: number }> {
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) {
    if (!indeg.has(e.fromInitiativeId) || !indeg.has(e.toInitiativeId)) continue;
    (succ.get(e.fromInitiativeId) ?? succ.set(e.fromInitiativeId, []).get(e.fromInitiativeId)!).push(e.toInitiativeId);
    indeg.set(e.toInitiativeId, (indeg.get(e.toInitiativeId) ?? 0) + 1);
  }
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const remaining = new Map(indeg);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const s of succ.get(id) ?? []) {
      layer.set(s, Math.max(layer.get(s) ?? 0, (layer.get(id) ?? 0) + 1));
      remaining.set(s, (remaining.get(s) ?? 0) - 1);
      if ((remaining.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  const rowOf = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const row = rowOf.get(l) ?? 0;
    rowOf.set(l, row + 1);
    pos.set(n.id, { x: l * COL_W, y: row * ROW_H });
  }
  return pos;
}

export function ValueStreamGraph() {
  const t = useTranslations('insights');
  const { data, error } = usePmData<ValueStream>(() => pmoApi.valueStream(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const built = useMemo(() => {
    if (!data || data.nodes.length === 0) return null;
    const pos = layout(data.nodes, data.edges);
    const flowNodes: Node[] = data.nodes.map((n) => ({
      id: n.id,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: { label: `${n.name} · ${n.completionPct}%` },
      style: {
        borderRadius: 8,
        border: `${n.onCriticalPath ? 3 : 2}px solid ${n.onCriticalPath ? CRITICAL_COLOR : (STATUS_COLOR[n.status] ?? '#6b7280')}`,
        background: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        fontSize: 12,
        width: COL_W - 40,
        padding: 8,
        boxShadow: n.onCriticalPath ? `0 0 0 2px ${CRITICAL_COLOR}22` : undefined,
      },
    }));
    const flowEdges: Edge[] = data.edges.map((e) => ({
      id: e.id,
      source: e.fromInitiativeId,
      target: e.toInitiativeId,
      animated: e.onCriticalPath,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: e.onCriticalPath ? CRITICAL_COLOR : 'var(--coral-bright, #f97316)', strokeWidth: e.onCriticalPath ? 2.5 : 1.5 },
    }));
    return { flowNodes, flowEdges };
  }, [data]);

  useEffect(() => {
    if (built) { setNodes(built.flowNodes); setEdges(built.flowEdges); }
  }, [built, setNodes, setEdges]);

  if (error) return <PmError message={error} />;
  if (!data) return null;
  if (data.nodes.length === 0) return null; // no initiatives → nothing to stream

  return (
    <PmCard title={t('deliv.valueStream.title')}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        <span>{t('deliv.valueStream.subtitle')}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 0, borderTop: `2.5px solid ${CRITICAL_COLOR}`, display: 'inline-block' }} /> {t('deliv.valueStream.criticalPath')}</span>
        {data.cycleDetected && <span style={{ color: CRITICAL_COLOR, fontWeight: 600 }}>{t('deliv.valueStream.cycle')}</span>}
      </div>
      {data.edges.length === 0 ? (
        <PmEmpty message={t('deliv.valueStream.noDeps')} />
      ) : (
        <div style={{ height: 420, border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView proOptions={{ hideAttribution: true }}>
            <Background color="var(--border-subtle)" gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </PmCard>
  );
}
