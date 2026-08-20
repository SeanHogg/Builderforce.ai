'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ReactFlow,
  Background,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CANVAS_FIT_MIN_ZOOM, CanvasCommands, useCanvasCleanLayout } from '@/components/canvas/CanvasCommands';
import { Canvas3DView, type Canvas3DMove } from '@/components/canvas/Canvas3DView';
import { Canvas3DControlsProvider, useCanvasThreeD } from '@/components/canvas/canvas3dControls';
import { applyCanvas3DMoves, canvas3dDepthOffset, type Canvas3DDescriptor } from '@/components/canvas/canvas3d';
import { tasksApi, type Task, type DependencyEdge, type DepType } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError } from './pmShared';
import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import { useTaskStatusLabel } from '@/lib/taskStatusLabel';

/**
 * Task dependency / epic-flow graph. Nodes are tasks; solid edges are precedence
 * dependencies (predecessor → successor); dashed edges are epic → child
 * decomposition. Edges that participate in a cycle are flagged red defensively
 * (the API blocks new cycles, but legacy/data drift can still occur).
 *
 * Scope follows the global project selector: a project view is the full editor
 * (add an edge via the inline form; click an edge to delete it); the all-projects
 * (portfolio) view rolls every project's graph up read-only under a per-project
 * heading — so the Flow view is never a dead-end when no single project is picked.
 */

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--success)', shipped: 'var(--success)', in_progress: 'var(--info)',
  in_review: 'var(--violet-bright)', blocked: 'var(--error)', backlog: 'var(--text-muted)',
};

const COL_W = 230;
const ROW_H = 90;

/** Dependency relation types + their short edge badge (FS is the default, unlabelled). */
const DEP_TYPE_META: Array<{ value: DepType; code: string; labelKey: string }> = [
  { value: 'finish_to_start', code: 'FS', labelKey: 'depTypeFinishToStart' },
  { value: 'start_to_start', code: 'SS', labelKey: 'depTypeStartToStart' },
  { value: 'finish_to_finish', code: 'FF', labelKey: 'depTypeFinishToFinish' },
  { value: 'start_to_finish', code: 'SF', labelKey: 'depTypeStartToFinish' },
];
const DEP_TYPE_CODE: Record<string, string> = Object.fromEntries(DEP_TYPE_META.map((o) => [o.value, o.code]));

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

/** The dependency graph for ONE project. `readOnly` hides the editor (rollup use). */
function OneProjectDependencyGraph({ projectId, readOnly }: { projectId: number; readOnly?: boolean }) {
  const t = useTranslations('pm');
  const statusLabel = useTaskStatusLabel();
  // The app's own confirmation, not the browser's: `window.confirm` is blocked in
  // embeds, unstyled, and untranslatable.
  const confirm = useConfirm();
  const tasksQ = usePmData<Task[]>(() => tasksApi.list(projectId), [projectId]);
  const depsQ = usePmData<DependencyEdge[]>(() => tasksApi.dependencies(projectId), [projectId]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [predId, setPredId] = useState('');
  const [succId, setSuccId] = useState('');
  const [depType, setDepType] = useState<DepType>('finish_to_start');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  /** The board's own box — the arrange command lays out for the shape it measures here. */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const threeD = useCanvasThreeD();

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
        borderRadius: 'var(--radius-md)',
        border: `2px solid ${STATUS_COLOR[t.status] ?? 'var(--text-muted)'}`,
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
        style: { stroke: onCycle ? 'var(--error)' : 'var(--coral-bright)', strokeWidth: 2 },
        label: onCycle ? t('depCycle') : d.depType !== 'finish_to_start' ? DEP_TYPE_CODE[d.depType] : undefined,
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
        style: { stroke: 'var(--text-muted)', strokeWidth: 1.5, strokeDasharray: '4 4' },
        markerEnd: { type: MarkerType.Arrow },
      }));
    return { flowNodes, edges: [...epicEdges, ...depEdges] };
  }, [tasks, deps, t]);

  useEffect(() => {
    if (built) { setNodes(built.flowNodes); setEdges(built.edges); }
  }, [built, setNodes, setEdges]);

  const cleanLayout = useCanvasCleanLayout({ boardRef, instanceRef: flowRef, setNodes, edges });

  /**
   * How a task reads in the 3D space.
   *
   * This graph exists to answer "what is blocked behind what", and on a flat board
   * that answer is traced arrow by arrow. Stacked on the dependency axis it is the
   * first thing the eye gets: precedence depth becomes distance, and epic children
   * sit a plane behind their parent. Status is the other axis, for reading the same
   * graph as "where is everything up to".
   */
  const taskById = useMemo(() => new Map((tasks ?? []).map((task) => [String(task.id), task])), [tasks]);
  const describeThreeD = useCallback((node: Node): Canvas3DDescriptor => {
    const task = taskById.get(node.id);
    if (!task) return { label: node.id, group: t('epicStatus.backlog') };
    return {
      label: task.title,
      sublabel: task.key,
      group: t(`epicStatus.${task.status}` as 'epicStatus.backlog'),
      accent: STATUS_COLOR[task.status] ?? STATUS_COLOR.backlog!,
      depthOffset: canvas3dDepthOffset(node),
    };
  }, [statusLabel, taskById]);
  const moveThreeD = useCallback(
    (moves: readonly Canvas3DMove[]) => setNodes((current) => applyCanvas3DMoves(current, moves)),
    [setNodes],
  );

  if (tasksQ.error || depsQ.error) return <PmError message={tasksQ.error ?? depsQ.error ?? 'error'} />;
  if (!tasks || !deps) return <PmEmpty message={t('depLoading')} />;
  if (!tasks.length) return <PmEmpty message={t('noTasksProject')} />;

  const reload = () => { tasksQ.reload(); depsQ.reload(); };

  const addEdge = async () => {
    setFormError(null);
    const pred = Number(predId);
    const succ = Number(succId);
    if (!pred || !succ) { setFormError(t('depPickBoth')); return; }
    setBusy(true);
    try {
      await tasksApi.addDependency(succ, pred, depType);
      setPredId(''); setSuccId('');
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onEdgeClick = async (_: unknown, edge: Edge) => {
    if (readOnly) return;
    const edgeId = (edge.data as { edgeId?: number } | undefined)?.edgeId;
    if (edgeId == null) return; // epic edges aren't deletable here
    if (!(await confirm(t('depRemoveConfirm')))) return;
    try { await tasksApi.removeDependency(edgeId); reload(); } catch { /* surfaced on next load */ }
  };

  const selectStyle: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!readOnly && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Select aria-label={t('ariaPredecessor')} value={predId} onChange={(e) => setPredId(e.target.value)} style={selectStyle}>
            <option value="">{t('depPredecessor')}</option>
            {tasks.map((tk) => <option key={tk.id} value={tk.id}>{tk.key} · {tk.title}</option>)}
          </Select>
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <Select aria-label={t('ariaSuccessor')} value={succId} onChange={(e) => setSuccId(e.target.value)} style={selectStyle}>
            <option value="">{t('depSuccessor')}</option>
            {tasks.map((tk) => <option key={tk.id} value={tk.id}>{tk.key} · {tk.title}</option>)}
          </Select>
          <Select aria-label={t('ariaDepType')} value={depType} onChange={(e) => setDepType(e.target.value as DepType)} style={selectStyle}>
            {DEP_TYPE_META.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
          </Select>
          <button
            type="button"
            onClick={addEdge}
            disabled={busy}
            style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--coral-bright)', color: 'var(--text-on-accent)', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {t('depAddButton')}
          </button>
          {formError && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{formError}</span>}
        </div>
      )}
      <Canvas3DControlsProvider>
        {/* The scene fills this box, so it has to be the box it is positioned
            against — see `.scene` in Canvas3DView.module.css. */}
        <div ref={boardRef} style={{ position: 'relative', height: readOnly ? 360 : 520, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onEdgeClick={onEdgeClick}
            onInit={(instance) => { flowRef.current = instance; }}
            fitView
            fitViewOptions={{ padding: 0.15, minZoom: CANVAS_FIT_MIN_ZOOM }}
            minZoom={CANVAS_FIT_MIN_ZOOM}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border-subtle)" gap={18} />
            <CanvasCommands
              minimapOpen={minimapOpen}
              setMinimapOpen={setMinimapOpen}
              onCleanLayout={cleanLayout}
              minimapNodeColor="var(--coral-bright)"
              minimapMaskColor="rgba(5, 10, 20, .72)"
              {...threeD.commandProps}
            />
          </ReactFlow>
          {threeD.active && <Canvas3DView
            nodes={nodes}
            edges={edges.map((edge) => ({ source: edge.source, target: edge.target }))}
            describe={describeThreeD}
            onMove={moveThreeD}
            onExit={threeD.exit}
          />}
        </div>
      </Canvas3DControlsProvider>
      {!readOnly && (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          {t('depLegend')}
        </div>
      )}
    </div>
  );
}

export function DependencyGraph() {
  const t = useTranslations('pm');
  const { projectId } = usePmScope();
  // Optional: present in the app shell, absent in embed (which scopes explicitly).
  const scope = useOptionalProjectScope();

  if (projectId != null) return <OneProjectDependencyGraph projectId={projectId} />;

  // All-projects rollup: a read-only graph per project under its heading.
  const projects = scope?.projects ?? [];
  if (projects.length === 0) return <PmEmpty message={t('noEpicsAnywhere')} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('depAllProjectsCaption')}</div>
      {projects.map((p) => (
        <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>{p.name}</h3>
          <OneProjectDependencyGraph projectId={p.id} readOnly />
        </div>
      ))}
    </div>
  );
}
