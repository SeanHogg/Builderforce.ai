'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { tasksApi, type Task, type DependencyEdge } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, PmSelectProject } from './pmShared';

/**
 * Task dependency / epic-flow graph for one project. Nodes are tasks; solid edges
 * are precedence dependencies (predecessor → successor); dashed edges are epic →
 * child decomposition. Edges that participate in a cycle are flagged red
 * defensively (the API blocks new cycles, but legacy/data drift can still occur).
 * Add an edge via the inline form; click an edge to delete it.
 */

const STATUS_COLOR: Record<string, string> = {
  done: '#16a34a', shipped: '#16a34a', in_progress: '#2563eb',
  in_review: '#7c3aed', blocked: '#dc2626', backlog: '#6b7280',
};

const COL_W = 230;
const ROW_H = 90;

/** Longest-path layering over precedence edges; cycle nodes fall back to layer 0. */
function layout(tasks: Task[], deps: DependencyEdge[]): Map<number, { x: number; y: number }> {
  const succ = new Map<number, number[]>();
  const indeg = new Map<number, number>();
  for (const t of tasks) indeg.set(t.id, 0);
  for (const d of deps) {
    if (!indeg.has(d.predecessorTaskId) || !indeg.has(d.successorTaskId)) continue;
    (succ.get(d.predecessorTaskId) ?? succ.set(d.predecessorTaskId, []).get(d.predecessorTaskId)!).push(d.successorTaskId);
    indeg.set(d.successorTaskId, (indeg.get(d.successorTaskId) ?? 0) + 1);
  }
  const layer = new Map<number, number>(tasks.map((t) => [t.id, 0]));
  const queue = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const remaining = new Map(indeg);
  while (queue.length) {
    const id = queue.shift()!;
    for (const s of succ.get(id) ?? []) {
      layer.set(s, Math.max(layer.get(s) ?? 0, (layer.get(id) ?? 0) + 1));
      remaining.set(s, (remaining.get(s) ?? 0) - 1);
      if ((remaining.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  // Pack rows per layer.
  const rowOf = new Map<number, number>();
  const pos = new Map<number, { x: number; y: number }>();
  for (const t of tasks) {
    const l = layer.get(t.id) ?? 0;
    const row = rowOf.get(l) ?? 0;
    rowOf.set(l, row + 1);
    pos.set(t.id, { x: l * COL_W, y: row * ROW_H });
  }
  return pos;
}

/** Set of edge keys (`p->s`) that lie on a cycle: s can already reach p. */
function cycleEdgeKeys(deps: DependencyEdge[]): Set<string> {
  const adj = new Map<number, number[]>();
  for (const d of deps) (adj.get(d.predecessorTaskId) ?? adj.set(d.predecessorTaskId, []).get(d.predecessorTaskId)!).push(d.successorTaskId);
  const reaches = (from: number, target: number): boolean => {
    const seen = new Set<number>([from]);
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      if (c === target) return true;
      for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return false;
  };
  const bad = new Set<string>();
  for (const d of deps) if (reaches(d.successorTaskId, d.predecessorTaskId)) bad.add(`${d.predecessorTaskId}->${d.successorTaskId}`);
  return bad;
}

export function DependencyGraph() {
  const { projectId } = usePmScope();
  const tasksQ = usePmData<Task[]>(() => (projectId == null ? Promise.resolve([]) : tasksApi.list(projectId)), [projectId]);
  const depsQ = usePmData<DependencyEdge[]>(() => (projectId == null ? Promise.resolve([]) : tasksApi.dependencies(projectId)), [projectId]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [predId, setPredId] = useState('');
  const [succId, setSuccId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tasks = tasksQ.data;
  const deps = depsQ.data;

  const built = useMemo(() => {
    if (!tasks || !deps) return null;
    const pos = layout(tasks, deps);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const cyc = cycleEdgeKeys(deps);
    const flowNodes: Node[] = tasks.map((t) => ({
      id: String(t.id),
      position: pos.get(t.id) ?? { x: 0, y: 0 },
      data: { label: `${t.key} · ${t.title}` },
      style: {
        borderRadius: 8,
        border: `2px solid ${STATUS_COLOR[t.status] ?? '#6b7280'}`,
        background: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        fontSize: 12,
        width: COL_W - 40,
        padding: 8,
      },
    }));
    const depEdges: Edge[] = deps.map((d) => {
      const onCycle = cyc.has(`${d.predecessorTaskId}->${d.successorTaskId}`);
      return {
        id: `dep-${d.id}`,
        source: String(d.predecessorTaskId),
        target: String(d.successorTaskId),
        animated: !onCycle,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: onCycle ? '#dc2626' : 'var(--coral-bright, #f97316)', strokeWidth: 2 },
        label: onCycle ? '⚠ cycle' : undefined,
        data: { edgeId: d.id },
      };
    });
    // Epic → child decomposition edges (dashed, non-deletable).
    const epicEdges: Edge[] = tasks
      .filter((t) => t.parentTaskId != null && byId.has(t.parentTaskId))
      .map((t) => ({
        id: `epic-${t.parentTaskId}-${t.id}`,
        source: String(t.parentTaskId),
        target: String(t.id),
        style: { stroke: 'var(--text-muted, #9ca3af)', strokeWidth: 1.5, strokeDasharray: '4 4' },
        markerEnd: { type: MarkerType.Arrow },
      }));
    return { flowNodes, edges: [...epicEdges, ...depEdges] };
  }, [tasks, deps]);

  useEffect(() => {
    if (built) { setNodes(built.flowNodes); setEdges(built.edges); }
  }, [built, setNodes, setEdges]);

  if (projectId == null) return <PmSelectProject what="dependencies" />;
  if (tasksQ.error || depsQ.error) return <PmError message={tasksQ.error ?? depsQ.error ?? 'error'} />;
  if (!tasks || !deps) return <PmEmpty message="Loading dependency graph…" />;
  if (!tasks.length) return <PmEmpty message="No tasks in this project yet." />;

  const reload = () => { tasksQ.reload(); depsQ.reload(); };

  const addEdge = async () => {
    setFormError(null);
    const pred = Number(predId);
    const succ = Number(succId);
    if (!pred || !succ) { setFormError('Pick both a predecessor and a successor.'); return; }
    setBusy(true);
    try {
      await tasksApi.addDependency(succ, pred);
      setPredId(''); setSuccId('');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onEdgeClick = async (_: unknown, edge: Edge) => {
    const edgeId = (edge.data as { edgeId?: number } | undefined)?.edgeId;
    if (edgeId == null) return; // epic edges aren't deletable here
    if (!window.confirm('Remove this dependency?')) return;
    try { await tasksApi.removeDependency(edgeId); reload(); } catch { /* surfaced on next load */ }
  };

  const selectStyle: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select aria-label="Predecessor task" value={predId} onChange={(e) => setPredId(e.target.value)} style={selectStyle}>
          <option value="">Predecessor (blocks)…</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.key} · {t.title}</option>)}
        </select>
        <span style={{ color: 'var(--text-muted)' }}>→</span>
        <select aria-label="Successor task" value={succId} onChange={(e) => setSuccId(e.target.value)} style={selectStyle}>
          <option value="">Successor (blocked by)…</option>
          {tasks.map((t) => <option key={t.id} value={t.id}>{t.key} · {t.title}</option>)}
        </select>
        <button
          type="button"
          onClick={addEdge}
          disabled={busy}
          style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)', color: '#fff', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          Add dependency
        </button>
        {formError && <span style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{formError}</span>}
      </div>
      <div style={{ height: 520, border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeClick={onEdgeClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border-subtle)" gap={18} />
          <Controls />
        </ReactFlow>
      </div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
        Solid arrows = blocking dependency · dashed = epic decomposition · red = cycle (click a solid edge to remove).
      </div>
    </div>
  );
}
