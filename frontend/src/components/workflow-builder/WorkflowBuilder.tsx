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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  agentHosts,
  workflowDefinitions,
  type AgentHost,
  type WorkflowDefinitionGraph,
  type WorkflowNodeKind,
} from '@/lib/builderforceApi';
import { BuilderNode, type BuilderNodeData } from './BuilderNode';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NODE_GROUPS, NODE_KINDS, NODE_KIND_MAP } from './nodeKinds';

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

function makeNode(kind: WorkflowNodeKind, index: number): Node<BuilderNodeData> {
  const meta = NODE_KIND_MAP[kind];
  return {
    id: crypto.randomUUID(),
    type: 'builder',
    // Stagger new nodes so they don't stack exactly on top of each other.
    position: { x: 120 + (index % 4) * 60, y: 80 + (index % 6) * 70 },
    data: { kind, label: meta.label, config: { ...meta.defaultConfig } },
  };
}

interface Props {
  /** Existing definition id to load + edit; omitted for a new workflow. */
  definitionId?: string | null;
}

export function WorkflowBuilder({ definitionId }: Props) {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<BuilderNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('Untitled workflow');
  const [defId, setDefId] = useState<string | null>(definitionId ?? null);
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [agentHostId, setAgentHostId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!definitionId);

  useEffect(() => { agentHosts.list().then(setAgentHostList).catch(() => {}); }, []);

  // Load an existing definition into the canvas.
  useEffect(() => {
    if (!definitionId) return;
    setLoading(true);
    workflowDefinitions
      .get(definitionId)
      .then((d) => {
        setName(d.name);
        setDefId(d.id);
        setNodes(
          d.definition.nodes.map((n) => ({
            id: n.id,
            type: 'builder',
            position: n.position,
            data: { kind: n.kind, label: n.label, config: n.config ?? {} },
          })),
        );
        setEdges(d.definition.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
      })
      .catch((e: Error) => setStatus(e.message))
      .finally(() => setLoading(false));
  }, [definitionId, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, id: crypto.randomUUID() }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: WorkflowNodeKind) => setNodes((nds) => [...nds, makeNode(kind, nds.length)]),
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

  const save = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    setStatus(null);
    try {
      const graph = toGraph();
      if (defId) {
        await workflowDefinitions.update(defId, { name: name.trim() || 'Untitled workflow', definition: graph });
        setStatus('Saved.');
        return defId;
      }
      const created = await workflowDefinitions.create({ name: name.trim() || 'Untitled workflow', definition: graph });
      setDefId(created.id);
      router.replace(`/workflows/builder?id=${created.id}`);
      setStatus('Saved.');
      return created.id;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, [defId, name, toGraph, router]);

  const run = useCallback(async () => {
    if (!agentHostId) { setStatus('Select a agentHost to run on.'); return; }
    if (nodes.length === 0) { setStatus('Add at least one node first.'); return; }
    setBusy(true);
    setStatus(null);
    try {
      const id = await save();             // ensure the latest graph is persisted
      if (!id) return;
      const { workflowId } = await workflowDefinitions.run(id, Number(agentHostId));
      router.push(`/workflows?run=${workflowId}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }, [agentHostId, nodes.length, save, router]);

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
        <select value={agentHostId} onChange={(e) => setAgentHostId(e.target.value ? Number(e.target.value) : '')} style={fieldStyle} title="Run on agentHost">
          <option value="">Select agentHost…</option>
          {agentHostList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        <div style={{ width: 184, borderRight: '1px solid var(--border-subtle)', overflowY: 'auto', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Nodes</div>
          {NODE_GROUPS.map((group) => (
            <div key={group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>{group}</div>
              {NODE_KINDS.filter((m) => m.group === group).map((m) => (
                <button
                  key={m.kind}
                  type="button"
                  onClick={() => addNode(m.kind)}
                  title={m.blurb}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                    padding: '6px 8px', marginBottom: 4, fontSize: 12, fontWeight: 600,
                    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${m.accent}`,
                    borderRadius: 7, cursor: 'pointer',
                  }}
                >
                  <span>{m.icon}</span> {m.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
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
                Click nodes in the palette to start building.<br />Wire them together, then Save &amp; Run.
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        {selectedNode && (
          <div style={{ width: 268, borderLeft: '1px solid var(--border-subtle)', padding: 14 }}>
            <NodeConfigPanel node={selectedNode} onChange={updateNodeData} onDelete={deleteNode} />
          </div>
        )}
      </div>
    </div>
  );
}
