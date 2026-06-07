'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
import type { Project } from '@/lib/types';
import { BuilderNode, type BuilderNodeData } from './BuilderNode';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NODE_GROUPS, NODE_KINDS, NODE_KIND_MAP } from './nodeKinds';
import {
  INTEGRATIONS, INTEGRATION_CATEGORIES, integrationAccent, integrationIcon, presetConfig,
  type Integration,
} from './integrations';

/** dataTransfer MIME for palette → canvas drag-and-drop. */
const DND_MIME = 'application/x-wf-node';
type DndPayload = { kind?: WorkflowNodeKind; integrationId?: string };

const nodeTypes: NodeTypes = { builder: BuilderNode };

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--coral-bright, #f4726e)',
  color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '7px 12px', fontSize: 12.5, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer',
};
const fieldStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 12.5, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-deep)', color: 'var(--text-primary)',
};
const groupLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: 5,
};
function paletteItemStyle(accent: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '6px 8px', marginBottom: 4, fontSize: 12, fontWeight: 600,
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${accent}`,
    borderRadius: 7, cursor: 'grab',
  };
}

type XY = { x: number; y: number };

/** Staggered fallback position when a node is added by click (no drop point). */
function staggerPos(index: number): XY {
  return { x: 120 + (index % 4) * 60, y: 80 + (index % 6) * 70 };
}

function makeNode(kind: WorkflowNodeKind, position: XY): Node<BuilderNodeData> {
  const meta = NODE_KIND_MAP[kind];
  return {
    id: crypto.randomUUID(),
    type: 'builder',
    position,
    data: { kind, label: meta.label, config: { ...meta.defaultConfig } },
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

/** Encode a run target as the `<select>` option value (`host:<id>` / `cloud:<ref>`). */
function runTargetToValue(t: WorkflowRunTarget | null): string {
  if (!t) return '';
  if (t.runtime === 'cloud') return t.cloudAgentRef ? `cloud:${t.cloudAgentRef}` : '';
  return t.agentHostId ? `host:${t.agentHostId}` : '';
}

/** Decode a `<select>` option value back into a run target. */
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
}

export function WorkflowBuilder({ definitionId, initialProjectId = null }: Props) {
  const router = useRouter();
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
  const [paletteSearch, setPaletteSearch] = useState('');

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: crypto.randomUUID() }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => setNodes((nds) => [...nds, makeNode(kind, staggerPos(nds.length))]),
    [setNodes],
  );

  const addIntegration = useCallback(
    (integ: Integration) => setNodes((nds) => [...nds, makeIntegrationNode(integ, staggerPos(nds.length))]),
    [setNodes],
  );

  // Drag-and-drop: palette items carry a JSON payload; the canvas drops them at
  // the cursor's flow coordinates.
  const onPaletteDragStart = useCallback((e: React.DragEvent, payload: DndPayload) => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DND_MIME);
      if (!raw) return;
      let payload: DndPayload;
      try { payload = JSON.parse(raw) as DndPayload; } catch { return; }
      const position = rfRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY }) ?? { x: 0, y: 0 };
      const integ = payload.integrationId ? INTEGRATIONS.find((i) => i.id === payload.integrationId) : undefined;
      const node = integ ? makeIntegrationNode(integ, position) : payload.kind ? makeNode(payload.kind, position) : null;
      if (node) setNodes((nds) => [...nds, node]);
    },
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
        setStatus('Saved.');
        refreshTriggers(defId);
        return defId;
      }
      const created = await workflowDefinitions.create({ name: nameVal, definition: graph, ...runTargetFields });
      setDefId(created.id);
      router.replace(`/workflows/builder?id=${created.id}`);
      setStatus('Saved.');
      refreshTriggers(created.id);
      return created.id;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [defId, name, toGraph, router, runTargetFields, refreshTriggers]);

  const run = useCallback(async () => {
    if (!runTarget) { setStatus('Select a run target (agentHost or cloud agent).'); return; }
    if (nodes.length === 0) { setStatus('Add at least one node first.'); return; }
    setBusy(true);
    setStatus(null);
    try {
      const id = await save();             // ensure the latest graph + target is persisted
      if (!id) return;
      const { workflowId } = await workflowDefinitions.run(id, runTarget);
      router.push(`/workflows?run=${workflowId}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }, [runTarget, nodes.length, save, router]);

  // Save (if needed), then download the definition as YAML.
  const exportYaml = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const id = await save();
      if (!id) return;
      const yaml = await workflowDefinitions.exportYaml(id);
      const url = URL.createObjectURL(new Blob([yaml], { type: 'application/yaml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(name.trim() || 'workflow').replace(/[^a-z0-9-_]+/gi, '_')}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Export failed');
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
        router.push(`/workflows/builder?id=${created.id}`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Import failed');
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  if (loading) {
    return <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>Loading workflow…</div>;
  }

  const q = paletteSearch.trim().toLowerCase();
  const filteredIntegrations = q
    ? INTEGRATIONS.filter(
        (i) => i.label.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.category.includes(q),
      )
    : INTEGRATIONS;
  const sortedCategories = INTEGRATION_CATEGORIES.slice().sort((a, b) => a.order - b.order);

  return (
    <div className="app-full-height" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...fieldStyle, fontWeight: 700, fontSize: 14, minWidth: 220, flex: 1 }}
          placeholder="Workflow name"
        />
        <select
          value={runTargetToValue(runTarget)}
          onChange={(e) => setRunTarget(valueToRunTarget(e.target.value))}
          style={fieldStyle}
          title="Run on a self-hosted agentHost or a cloud agent"
        >
          <option value="">Select run target…</option>
          {runTargets.hosts.length > 0 && (
            <optgroup label="Self-hosted agentHosts">
              {runTargets.hosts.map((h) => <option key={`host:${h.id}`} value={`host:${h.id}`}>{h.name}</option>)}
            </optgroup>
          )}
          {runTargets.cloudAgents.length > 0 && (
            <optgroup label="Cloud agents">
              {runTargets.cloudAgents.map((a) => <option key={`cloud:${a.ref}`} value={`cloud:${a.ref}`}>{a.name}</option>)}
            </optgroup>
          )}
        </select>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
          style={fieldStyle}
          title="Bind this workflow to a project, or leave it tenant-wide (independent)"
        >
          <option value="">No project (tenant-wide)</option>
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="button" style={btnSubtle} disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" style={btnSubtle} disabled={busy} onClick={() => void exportYaml()} title="Download as YAML">Export</button>
        <button type="button" style={btnSubtle} disabled={busy} onClick={() => fileInputRef.current?.click()} title="Import a YAML/JSON workflow">Import</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,.json"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importYaml(f); e.target.value = ''; }}
        />
        <button type="button" style={btnPrimary} disabled={busy} onClick={() => void run()}>▶ Run</button>
        {status && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{status}</span>}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Palette */}
        <div style={{ width: 210, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', padding: 12 }}>
          <input
            value={paletteSearch}
            onChange={(e) => setPaletteSearch(e.target.value)}
            placeholder="Search integrations…"
            style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box', marginBottom: 8, fontSize: 12 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>Drag onto the canvas, or click to add.</div>

          {/* Core node kinds */}
          {NODE_GROUPS.map((group) => {
            const items = NODE_KINDS.filter((m) => m.group === group);
            if (!items.length) return null;
            return (
              <div key={group} style={{ marginBottom: 12 }}>
                <div style={groupLabelStyle}>{group}</div>
                {items.map((m) => (
                  <button
                    key={m.kind}
                    type="button"
                    draggable
                    onDragStart={(e) => onPaletteDragStart(e, { kind: m.kind })}
                    onClick={() => addNode(m.kind)}
                    title={m.blurb}
                    style={paletteItemStyle(m.accent)}
                  >
                    <span>{m.icon}</span> {m.label}
                  </button>
                ))}
              </div>
            );
          })}

          {/* Integrations — MCP servers, LLM platforms, data-collection sources */}
          {sortedCategories.map((cat) => {
            const items = filteredIntegrations.filter((i) => i.category === cat.id);
            if (!items.length) return null;
            return (
              <div key={cat.id} style={{ marginBottom: 12 }}>
                <div style={groupLabelStyle}>{cat.icon} {cat.label}</div>
                {items.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    draggable
                    onDragStart={(e) => onPaletteDragStart(e, { integrationId: i.id })}
                    onClick={() => addIntegration(i)}
                    title={i.description}
                    style={paletteItemStyle(integrationAccent(i.category))}
                  >
                    <span>{integrationIcon(i)}</span> {i.label}
                  </button>
                ))}
              </div>
            );
          })}
          {filteredIntegrations.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No integrations match “{paletteSearch}”.</div>
          )}
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          style={{ flex: 1, minWidth: 0, position: 'relative' }}
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
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
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border-subtle)" gap={18} />
            <Controls />
            <MiniMap pannable zoomable style={{ background: 'var(--bg-deep)' }} />
          </ReactFlow>
          {nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                Drag nodes from the palette onto the canvas.<br />Wire them together, then Save &amp; Run.
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
