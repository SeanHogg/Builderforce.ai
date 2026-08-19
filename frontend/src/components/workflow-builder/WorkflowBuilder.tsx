'use client';

import { Select } from '@/components/Select';
import { useConfirm } from '@/components/ConfirmProvider';
import { Icon } from '@/components/ui/Icon';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ReactFlow,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  workflowDefinitions,
  type WorkflowDefinitionGraph,
  type WorkflowNodeKind,
  type WorkflowRunTarget,
  type WorkflowRunTargets,
  type WorkflowTriggerInfo,
} from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import { downloadText } from '@/lib/download';
import type { Project } from '@/lib/types';
import { BuilderNode, configSummary, type BuilderNodeData } from './BuilderNode';
import { NodeConfigPanel } from './NodeConfigPanel';
import { EvermindBuildPanel } from './EvermindBuildPanel';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { WorkflowRunHistoryPanel } from '@/components/WorkflowRunHistoryPanel';
import { WorkflowNodePicker } from './WorkflowNodePicker';
import { NODE_GROUP_KEYS, NODE_KIND_MAP, nodeKindLabel, type NodeGroup, type NodeKindMeta } from './nodeKinds';
import { hasBuildNodes, loadTemplateGraph, EVERMIND_BUILD_TEMPLATES } from '@/lib/evermindBuild';
import { presetConfig, type Integration } from './integrations';
import { CANVAS_FIT_MIN_ZOOM, CanvasCommands, useCanvasCleanLayout } from '@/components/canvas/CanvasCommands';
import { Canvas3DView, type Canvas3DMove } from '@/components/canvas/Canvas3DView';
import { Canvas3DControlsProvider, useCanvasThreeD } from '@/components/canvas/canvas3dControls';
import { applyCanvas3DMoves, canvas3dDepthOffset, type Canvas3DDescriptor } from '@/components/canvas/canvas3d';

const nodeTypes: NodeTypes = { builder: BuilderNode };

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '7px 12px', fontSize: 12.5, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const fieldStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12.5, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)',
};
type XY = { x: number; y: number };

/** Staggered fallback position when a node is added by click (no drop point). */
function staggerPos(index: number): XY {
  return { x: 120 + (index % 4) * 60, y: 80 + (index % 6) * 70 };
}

/**
 * A dropped node is named in the AUTHOR'S language.
 *
 * The label is workflow data a person then edits, not UI chrome, so it is
 * resolved once at creation rather than re-translated on every render — an
 * author who renames a step must not have that rename reverted, and a
 * definition shared between two locales must not silently rewrite itself.
 */
function makeNode(kind: WorkflowNodeKind, position: XY, name: (meta: NodeKindMeta) => string): Node<BuilderNodeData> {
  const meta = NODE_KIND_MAP[kind];
  return {
    id: crypto.randomUUID(),
    type: 'builder',
    position,
    data: { kind, label: name(meta), config: { ...meta.defaultConfig } },
  };
}

/** Build a node from an integration preset (LLM provider, MCP tool, or trigger). */
function makeIntegrationNode(integ: Integration, position: XY): Node<BuilderNodeData> {
  return {
    id: crypto.randomUUID(),
    type: 'builder',
    position,
    data: { kind: integ.kind, label: integ.label, config: presetConfig(integ) },
  };
}

/** Encode a run target as the `<Select>` option value (`host:<id>` / `cloud:<ref>`). */
function runTargetToValue(t: WorkflowRunTarget | null): string {
  if (!t) return '';
  if (t.runtime === 'cloud') return t.cloudAgentRef ? `cloud:${t.cloudAgentRef}` : '';
  return t.agentHostId ? `host:${t.agentHostId}` : '';
}

/** Decode a `<Select>` option value back into a run target. */
function valueToRunTarget(v: string): WorkflowRunTarget | null {
  if (v.startsWith('host:')) return { runtime: 'host', agentHostId: Number(v.slice(5)) };
  if (v.startsWith('cloud:')) return { runtime: 'cloud', cloudAgentRef: v.slice(6) };
  return null;
}

interface Props {
  /** Existing definition id to load + edit; omitted for a new workflow. */
  definitionId?: string | null;
  /** Pre-bind a new workflow to this project (from /workflows?projectId=…). */
  initialProjectId?: number | null;
  /** Render inside an isolated Canvas focus surface without changing routes. */
  embedded?: boolean;
  onSaved?: (definitionId: string, name: string) => void;
  onRunStarted?: (workflowId: number | string) => void;
}

export function WorkflowBuilder({ definitionId, initialProjectId = null, embedded = false, onSaved, onRunStarted }: Props) {
  const router = useRouter();
  const t = useTranslations('evermindBuild');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BuilderNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('Untitled workflow');
  const [defId, setDefId] = useState<string | null>(definitionId ?? null);
  const [runTargets, setRunTargets] = useState<WorkflowRunTargets>({ hosts: [], cloudAgents: [] });
  const [runTarget, setRunTarget] = useState<WorkflowRunTarget | null>(null);
  const [projectId, setProjectId] = useState<number | null>(initialProjectId);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [triggerInfo, setTriggerInfo] = useState<Record<string, WorkflowTriggerInfo>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!definitionId);
  const [buildOpen, setBuildOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyInitialRunId, setHistoryInitialRunId] = useState<string | null>(null);

  useEffect(() => { workflowDefinitions.runTargets().then(setRunTargets).catch(() => {}); }, []);
  // Projects power the binding selector — a workflow runs under a project, or is
  // tenant-wide (no project). The binding is the source of truth for scope.
  useEffect(() => { fetchProjects().then(setProjectList).catch(() => {}); }, []);

  // Load an existing definition into the canvas.
  useEffect(() => {
    if (!definitionId) return;
    setLoading(true);
    workflowDefinitions
      .get(definitionId)
      .then((d) => {
        setName(d.name);
        setDefId(d.id);
        if (d.runTargetRuntime === 'cloud') {
          setRunTarget({ runtime: 'cloud', cloudAgentRef: d.runTargetCloudAgentRef ?? null });
        } else if (d.runTargetAgentHostId) {
          setRunTarget({ runtime: 'host', agentHostId: d.runTargetAgentHostId });
        }
        setProjectId(d.projectId ?? null);
        setNodes(
          d.definition.nodes.map((n) => ({
            id: n.id,
            type: 'builder',
            position: n.position,
            data: { kind: n.kind, label: n.label, config: n.config ?? {} },
          })),
        );
        setEdges(d.definition.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
        workflowDefinitions
          .triggers(d.id)
          .then((list) => setTriggerInfo(Object.fromEntries(list.map((t) => [t.nodeId, t]))))
          .catch(() => {});
      })
      .catch((e: Error) => setStatus(e.message))
      .finally(() => setLoading(false));
  }, [definitionId, setNodes, setEdges]);

  const rfRef = useRef<ReactFlowInstance<Node<BuilderNodeData>, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const addNodeButtonRef = useRef<HTMLButtonElement>(null);
  const [nodePickerAnchor, setNodePickerAnchor] = useState<XY | null>(null);

  const cleanLayout = useCanvasCleanLayout({ boardRef: canvasRef, instanceRef: rfRef, setNodes, edges });

  const threeD = useCanvasThreeD();
  /**
   * The one place a node family is named for a reader.
   *
   * The palette headings and the 3D group badge are the same seven families, so
   * they read from one translation rather than each shipping its own copy of the
   * catalog's internal English.
   */
  const nodeGroupLabel = useCallback(
    (group: NodeGroup) => t(`nodeGroup.${NODE_GROUP_KEYS[group]}` as 'nodeGroup.trigger'),
    [t],
  );
  /**
   * How a step reads in the 3D space.
   *
   * A workflow IS a dependency flow, so the depth axis is the graph's own subject:
   * stacked by it, "what runs after what" is distance rather than a line to follow,
   * and a branch that rejoins three steps later reads at a glance. The node-kind
   * catalog already owns each step's icon, accent and family, so the space uses
   * exactly the vocabulary the palette and the flat node do.
   */
  const describeThreeD = useCallback((node: Node<BuilderNodeData>): Canvas3DDescriptor => {
    const meta = NODE_KIND_MAP[node.data.kind];
    return {
      label: node.data.label || (meta ? nodeKindLabel(meta, t) : node.data.kind),
      sublabel: configSummary(node.data.kind, node.data.config ?? {}),
      group: nodeGroupLabel(meta?.group ?? 'Integrations'),
      icon: meta?.icon,
      accent: meta?.accent,
      depthOffset: canvas3dDepthOffset(node),
    };
  }, [nodeGroupLabel]);
  const moveThreeD = useCallback(
    (moves: readonly Canvas3DMove[]) => setNodes((current) => applyCanvas3DMoves(current, moves)),
    [setNodes],
  );

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: crypto.randomUUID() }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => setNodes((nds) => [...nds, makeNode(kind, staggerPos(nds.length), (meta) => nodeKindLabel(meta, t))]),
    [setNodes, t],
  );

  const addIntegration = useCallback(
    (integ: Integration) => setNodes((nds) => [...nds, makeIntegrationNode(integ, staggerPos(nds.length))]),
    [setNodes],
  );

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<BuilderNodeData>) =>
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
      ),
    [setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId((cur) => (cur === nodeId ? null : cur));
    },
    [setNodes, setEdges],
  );

  const toGraph = useCallback(
    (): WorkflowDefinitionGraph => ({
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind,
        label: n.data.label,
        position: n.position,
        config: n.data.config ?? {},
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    }),
    [nodes, edges],
  );

  // Persisted run-target fields derived from the current selection — saved so
  // scheduled / webhook / rss / inbound-email runs know where to execute.
  const runTargetFields = useMemo(
    () => ({
      runTargetRuntime: runTarget?.runtime ?? ('host' as const),
      runTargetAgentHostId: runTarget?.runtime === 'host' ? runTarget.agentHostId ?? null : null,
      runTargetCloudAgentRef: runTarget?.runtime === 'cloud' ? runTarget.cloudAgentRef ?? null : null,
      // The project binding is the source of truth for scope: bound ⇒ project,
      // unbound ⇒ tenant-wide. The server derives execution_scope identically.
      projectId,
      executionScope: (projectId != null ? 'project' : 'global') as 'project' | 'global',
    }),
    [runTarget, projectId],
  );

  // Load the materialized triggers' activation state (webhook URLs, next runs)
  // so the inspector can show each trigger node how it fires.
  const refreshTriggers = useCallback((id: string) => {
    workflowDefinitions
      .triggers(id)
      .then((list) => setTriggerInfo(Object.fromEntries(list.map((t) => [t.nodeId, t]))))
      .catch(() => {});
  }, []);

  const save = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    setStatus(null);
    try {
      const graph = toGraph();
      const nameVal = name.trim() || 'Untitled workflow';
      if (defId) {
        await workflowDefinitions.update(defId, { name: nameVal, definition: graph, ...runTargetFields });
        setStatus(t('statusSaved'));
        refreshTriggers(defId);
        onSaved?.(defId, nameVal);
        return defId;
      }
      const created = await workflowDefinitions.create({ name: nameVal, definition: graph, ...runTargetFields });
      setDefId(created.id);
      if (!embedded) router.replace(`/workflows/builder?id=${created.id}`);
      setStatus(t('statusSaved'));
      refreshTriggers(created.id);
      onSaved?.(created.id, nameVal);
      return created.id;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('statusSaveFailed'));
      return null;
    } finally {
      setBusy(false);
    }
  }, [defId, embedded, name, onSaved, refreshTriggers, router, runTargetFields, toGraph]);

  const run = useCallback(async () => {
    if (!runTarget) { setStatus(t('statusSelectRunTarget')); return; }
    if (nodes.length === 0) { setStatus(t('statusAddNode')); return; }
    setBusy(true);
    setStatus(null);
    try {
      const id = await save();             // ensure the latest graph + target is persisted
      if (!id) return;
      const { workflowId } = await workflowDefinitions.run(id, runTarget);
      onRunStarted?.(workflowId);
      // Stay on the canvas and show the result in the History panel (matches
      // Make: running surfaces status in the editor's own sidebar) rather than
      // navigating away — `/workflows?run=` never had a consumer for the param.
      setHistoryInitialRunId(workflowId);
      setHistoryOpen(true);
      setStatus(t('statusRunStarted', { id: workflowId }));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('statusRunFailed'));
    } finally {
      setBusy(false);
    }
  }, [nodes.length, onRunStarted, runTarget, save, t]);

  // Load a one-click Evermind BUILD template onto the canvas (replaces the graph)
  // as an editable, wired step chain — then the user runs it with "🧠 Build".
  const loadTemplate = useCallback(
    async (id: 'train-llm' | 'teach-code') => {
      if (nodes.length > 0 && !(await confirm({ message: t('replaceConfirm'), destructive: false }))) return;
      setBusy(true);
      setStatus(null);
      try {
        const g = await loadTemplateGraph(id);
        setNodes(g.nodes.map((n) => ({ id: n.id, type: 'builder', position: n.position, data: { kind: n.kind, label: n.label, config: n.config } })));
        setEdges(g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
        setSelectedId(null);
        if (!name.trim() || name === 'Untitled workflow') {
          setName(id === 'train-llm' ? t('templateTrainLlm') : t('templateTeachCode'));
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : t('templateLoadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [nodes.length, name, setNodes, setEdges, t],
  );

  const hasBuild = useMemo(() => hasBuildNodes(nodes.map((n) => ({ kind: n.data.kind }))), [nodes]);

  // Save (if needed), then download the definition as YAML.
  const exportYaml = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const id = await save();
      if (!id) return;
      const yaml = await workflowDefinitions.exportYaml(id);
      downloadText(yaml, `${(name.trim() || 'workflow').replace(/[^a-z0-9-_]+/gi, '_')}.yaml`, 'application/yaml');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('statusExportFailed'));
    } finally {
      setBusy(false);
    }
  }, [save, name]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importYaml = useCallback(
    async (file: File) => {
      setBusy(true);
      setStatus(null);
      try {
        const text = await file.text();
        const created = await workflowDefinitions.importYaml(file.name.replace(/\.ya?ml$|\.json$/i, ''), text);
        if (!embedded) {
          router.push(`/workflows/builder?id=${created.id}`);
        } else {
          const detail = await workflowDefinitions.get(created.id);
          setDefId(detail.id);
          setName(detail.name);
          setProjectId(detail.projectId ?? null);
          setRunTarget(detail.runTargetRuntime === 'cloud'
            ? { runtime: 'cloud', cloudAgentRef: detail.runTargetCloudAgentRef ?? null }
            : detail.runTargetAgentHostId ? { runtime: 'host', agentHostId: detail.runTargetAgentHostId } : null);
          setNodes(detail.definition.nodes.map((node) => ({ id: node.id, type: 'builder', position: node.position, data: { kind: node.kind, label: node.label, config: node.config ?? {} } })));
          setEdges(detail.definition.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })));
          onSaved?.(detail.id, detail.name);
          setStatus(t('statusSaved'));
        }
      } catch (e) {
        setStatus(e instanceof Error ? e.message : t('statusImportFailed'));
      } finally {
        setBusy(false);
      }
    },
    [embedded, onSaved, router, setEdges, setNodes, t],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  if (loading) {
    return <div style={{ padding: 24, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loadingWorkflow')}</div>;
  }

  return (
    <div className="app-full-height" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <button
          type="button"
          ref={addNodeButtonRef}
          style={btnPrimary}
          onClick={() => {
            const rect = addNodeButtonRef.current?.getBoundingClientRect();
            setNodePickerAnchor(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 16, y: 60 });
          }}
          title={t('addNodeTitle')}
        ><Icon name="plus" size={14} /> {t('addNode')}</button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...fieldStyle, fontWeight: 700, fontSize: 'var(--font-size-small)', minWidth: 220, flex: 1 }}
          placeholder={t('workflowNamePlaceholder')}
        />
        <Select
          value={runTargetToValue(runTarget)}
          onChange={(e) => setRunTarget(valueToRunTarget(e.target.value))}
          style={fieldStyle}
          title={t('runTargetTitle')}
        >
          <option value="">{t('selectRunTarget')}</option>
          {runTargets.hosts.length > 0 && (
            <optgroup label={t('selfHostedAgents')}>
              {runTargets.hosts.map((h) => <option key={`host:${h.id}`} value={`host:${h.id}`}>{h.name}</option>)}
            </optgroup>
          )}
          {runTargets.cloudAgents.length > 0 && (
            <optgroup label={t('cloudAgents')}>
              {runTargets.cloudAgents.map((a) => <option key={`cloud:${a.ref}`} value={`cloud:${a.ref}`}>{a.name}</option>)}
            </optgroup>
          )}
        </Select>
        <Select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={fieldStyle}
          title={t('projectBindTitle')}
        >
          <option value="">{t('noProject')}</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select
          value=""
          onChange={(e) => { const v = e.target.value; if (v) void loadTemplate(v as 'train-llm' | 'teach-code'); }}
          style={fieldStyle}
          title={t('templatesTitle')}
        >
          <option value="">{t('templatePlaceholder')}</option>
          {EVERMIND_BUILD_TEMPLATES.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>{t(tpl.nameKey)}</option>
          ))}
        </Select>
        <button type="button" style={btnSubtle} disabled={busy} onClick={() => void save()}>{busy ? tc('saving') : tc('save')}</button>
        <button type="button" style={btnSubtle} disabled={busy} onClick={() => void exportYaml()} title={t('exportTitle')}>{t('exportLabel')}</button>
        <button type="button" style={btnSubtle} disabled={busy} onClick={() => fileInputRef.current?.click()} title={t('importTitle')}>{t('importLabel')}</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,.json"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importYaml(f); e.target.value = ''; }}
        />
        {hasBuild && (
          <button type="button" style={btnPrimary} disabled={busy} onClick={() => setBuildOpen(true)} title={t('builderBuildTitle')}><Icon source="🧠" size="1em" /> {t('builderBuild')}</button>
        )}
        {defId && (
          <button type="button" style={btnSubtle} onClick={() => setHistoryOpen(true)} title={t('historyTitle')}><Icon source="📊" size="1em" /> {t('historyLabel')}</button>
        )}
        <button type="button" style={hasBuild ? btnSubtle : btnPrimary} disabled={busy} onClick={() => void run()}><Icon source="▶" size="1em" /> {t('builderRun')}</button>
        {status && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{status}</span>}
      </div>

      {nodePickerAnchor && (
        <WorkflowNodePicker
          anchor={nodePickerAnchor}
          onPickKind={(kind) => { addNode(kind); setNodePickerAnchor(null); }}
          onPickIntegration={(integ) => { addIntegration(integ); setNodePickerAnchor(null); }}
          onClose={() => setNodePickerAnchor(null)}
        />
      )}

      <EvermindBuildPanel
        open={buildOpen}
        onClose={() => setBuildOpen(false)}
        graph={toGraph()}
        workflowName={name.trim() || 'Evermind build'}
        projectId={projectId}
      />

      {defId && (
        <SlideOutPanel
          open={historyOpen}
          onClose={() => { setHistoryOpen(false); setHistoryInitialRunId(null); }}
          title={t('historyLabel')}
          width="wide"
          widthStorageKey="workflow-history"
        >
          <WorkflowRunHistoryPanel definitionId={defId} definitionName={name.trim() || t('workflowNamePlaceholder')} initialRunId={historyInitialRunId} />
        </SlideOutPanel>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Canvas */}
        <div ref={canvasRef} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <Canvas3DControlsProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfRef.current = inst; }}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
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
              minimapStyle={{ background: 'var(--bg-deep)' }}
              {...threeD.commandProps}
            />
          </ReactFlow>
          {threeD.active && <Canvas3DView
            nodes={nodes}
            edges={edges.map((edge) => ({ source: edge.source, target: edge.target }))}
            describe={describeThreeD}
            selectedIds={selectedId ? [selectedId] : []}
            onSelect={setSelectedId}
            onMove={moveThreeD}
            onExit={threeD.exit}
          />}
          </Canvas3DControlsProvider>
          {nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('canvasHintLine1')}<br />{t('canvasHintLine2')}
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        {selectedNode && (
          <div style={{ width: 268, borderLeft: '1px solid var(--border-subtle)', padding: 14 }}>
            <NodeConfigPanel
              node={selectedNode}
              onChange={updateNodeData}
              onDelete={deleteNode}
              triggerInfo={triggerInfo[selectedNode.id]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
