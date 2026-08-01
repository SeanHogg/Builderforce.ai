'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CreationNode, type CreationFlowNode } from './CreationNode';
import type { CreationNodeData, CreationObjectKind } from './types';
import styles from './CreationCanvas.module.css';

const DND_MIME = 'application/x-builderforce-creation-object';

const PALETTE: Array<{ group: string; items: Array<{ kind: CreationObjectKind; label: string; icon: string }> }> = [
  { group: 'Build', items: [{ kind: 'workflow', label: 'Workflow', icon: '⌘' }, { kind: 'website', label: 'Website', icon: '◎' }, { kind: 'chat', label: 'Chat', icon: '●' }, { kind: 'dataset', label: 'Dataset', icon: '▤' }] },
  { group: 'Insights', items: [{ kind: 'dashboard', label: 'Dashboard', icon: '▥' }, { kind: 'evaluation', label: 'Evaluation', icon: '✦' }, { kind: 'roadmap', label: 'Roadmap', icon: '↗' }, { kind: 'note', label: 'Note', icon: '◇' }] },
  { group: 'Work', items: [{ kind: 'project', label: 'Project', icon: '▦' }, { kind: 'task', label: 'Task', icon: '✓' }, { kind: 'mockup', label: 'Mockup', icon: '▣' }, { kind: 'featureSummary', label: 'Feature summary', icon: '★' }] },
  { group: 'People', items: [{ kind: 'staff', label: 'Staff member', icon: '●' }] },
  { group: 'Agents', items: [{ kind: 'agent', label: 'Agent', icon: '✦' }, { kind: 'voice', label: 'Voice', icon: '◖' }] },
];

function newNode(kind: CreationObjectKind, position: { x: number; y: number }): CreationFlowNode {
  const defaults: Record<CreationObjectKind, CreationNodeData> = {
    workflow: { kind, title: 'Untitled workflow', status: 'Ready', resourceId: `workflow:${crypto.randomUUID()}` },
    project: { kind, title: 'BuilderForce launch', status: 'On track', subtitle: 'Product and go-to-market delivery.', resourceId: `project:${crypto.randomUUID()}` },
    website: { kind, title: 'Website concept', status: 'Live', resourceId: `website:${crypto.randomUUID()}` },
    dashboard: { kind, title: 'Performance dashboard', resourceId: `dashboard:${crypto.randomUUID()}` },
    chat: { kind, title: 'Brain', resourceId: `chat:${crypto.randomUUID()}` },
    agent: { kind, title: 'New agent', status: 'Online', model: 'gpt-4o', subtitle: 'Helps the team analyze and improve work.', resourceId: `agent:${crypto.randomUUID()}` },
    staff: { kind, title: 'Teammate', role: 'Contributor', focus: 'Add a current focus from the inspector.', accent: '#3978f6', resourceId: `staff:${crypto.randomUUID()}` },
    evaluation: { kind, title: 'Canvas evaluation', status: 'AI evaluation' },
    dataset: { kind, title: 'Imported dataset.csv', resourceId: `dataset:${crypto.randomUUID()}` },
    voice: { kind, title: 'Voice note', resourceId: `voice:${crypto.randomUUID()}` },
    note: { kind, title: 'Note', subtitle: 'Add context for your collaborators.' },
    roadmap: { kind, title: 'Executive sales roadmap', status: 'Draft' },
    task: { kind, title: 'Build approved mockup', status: 'Ready', role: 'Campaign Strategist' },
    mockup: { kind, title: 'Interactive feature mockup', status: 'Draft' },
    featureSummary: { kind, title: 'Top 10 requested features', status: 'Synthesized' },
  };
  return { id: crypto.randomUUID(), type: 'creation', position, data: defaults[kind] };
}

const INITIAL_NODES: CreationFlowNode[] = [
  { id: 'workflow-campaign', type: 'creation', position: { x: 80, y: 55 }, data: { kind: 'workflow', title: 'Fall campaign workflow', status: 'Ready', resourceId: 'workflow:fall-campaign' } },
  { id: 'website-campaign', type: 'creation', position: { x: 610, y: 45 }, data: { kind: 'website', title: 'Campaign landing page', status: 'Live', resourceId: 'website:campaign-page' } },
  { id: 'dashboard-forecast', type: 'creation', position: { x: 1140, y: 55 }, data: { kind: 'dashboard', title: 'Campaign forecast', resourceId: 'dashboard:campaign-forecast' } },
  { id: 'chat-brain', type: 'creation', position: { x: 80, y: 380 }, data: { kind: 'chat', title: 'Brain', resourceId: 'chat:campaign-session' } },
  { id: 'staff-sarah', type: 'creation', position: { x: 365, y: 455 }, data: { kind: 'staff', title: 'Sarah', role: 'Marketing', focus: 'Defining audience segments and writing email copy.', accent: '#e94b9b', resourceId: 'staff:sarah' } },
  { id: 'staff-jordan', type: 'creation', position: { x: 635, y: 455 }, data: { kind: 'staff', title: 'Jordan', role: 'Design', focus: 'Refining hero section and mobile layout.', accent: '#ff9827', resourceId: 'staff:jordan' } },
  { id: 'agent-strategist', type: 'creation', position: { x: 930, y: 455 }, data: { kind: 'agent', title: 'Campaign Strategist', status: 'Online', model: 'gpt-4o', subtitle: 'Defines strategy, messaging, and audience for high-impact campaigns.', resourceId: 'agent:campaign-strategist' } },
];

const INITIAL_EDGES: Edge[] = [
  { id: 'workflow-website', source: 'workflow-campaign', target: 'website-campaign', label: 'publishes', type: 'smoothstep' },
  { id: 'website-dashboard', source: 'website-campaign', target: 'dashboard-forecast', label: 'measures', type: 'smoothstep' },
];

const nodeTypes: NodeTypes = { creation: CreationNode };

function CanvasInner({ sessionId }: { sessionId: string }) {
  const storageKey = `builderforce:create:${sessionId}`;
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [selectedId, setSelectedId] = useState<string | null>('agent-strategist');
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [prompt, setPrompt] = useState('Will this campaign workflow be effective with this landing page?');
  const [thinking, setThinking] = useState(false);
  const [notice, setNotice] = useState('Session saved');
  const flowRef = useRef<ReactFlowInstance<CreationFlowNode, Edge> | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { nodes?: CreationFlowNode[]; edges?: Edge[] };
        if (parsed.nodes?.length) setNodes(parsed.nodes);
        if (parsed.edges) setEdges(parsed.edges);
      }
    } catch { /* A corrupt draft falls back to the seeded session. */ }
    hydrated.current = true;
  }, [setEdges, setNodes, storageKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    const handle = window.setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify({ nodes, edges }));
      setNotice('Session saved');
    }, 300);
    return () => window.clearTimeout(handle);
  }, [edges, nodes, storageKey]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const scopeLabel = selectedNode ? selectedNode.data.title : 'Entire canvas';

  const updateSelected = useCallback((patch: Partial<CreationNodeData>) => {
    if (!selectedId) return;
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node));
    setNotice('Saving changes…');
  }, [selectedId, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, current));
  }, [setEdges]);

  const onNodeClick: NodeMouseHandler<CreationFlowNode> = useCallback((_event, node) => setSelectedId(node.id), []);

  const addAtCenter = useCallback((kind: CreationObjectKind) => {
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const node = newNode(kind, position);
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
    setNotice(`${node.data.title} added`);
  }, [setNodes]);

  const expandProject = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : nodes.find((node) => node.data.kind === 'project');
    if (!project) {
      setNotice('Add or select a project first');
      return;
    }
    const related: CreationFlowNode[] = [
      { id: `${project.id}:health`, type: 'creation', position: { x: project.position.x + 330, y: project.position.y - 150 }, data: { kind: 'dashboard', title: `${project.data.title} health`, resourceId: `dashboard:${project.id}` } },
      { id: `${project.id}:roadmap`, type: 'creation', position: { x: project.position.x + 330, y: project.position.y + 100 }, data: { kind: 'roadmap', title: `${project.data.title} roadmap`, status: 'Live', resourceId: `roadmap:${project.id}` } },
      { id: `${project.id}:workflow`, type: 'creation', position: { x: project.position.x + 850, y: project.position.y - 120 }, data: { kind: 'workflow', title: 'Delivery workflow', status: 'Ready', resourceId: `workflow:${project.id}` } },
      { id: `${project.id}:task`, type: 'creation', position: { x: project.position.x + 850, y: project.position.y + 150 }, data: { kind: 'task', title: 'Next delivery task', status: 'Ready', role: 'Campaign Strategist', resourceId: `task:${project.id}` } },
    ];
    setNodes((current) => [...current, ...related.filter((candidate) => !current.some((node) => node.id === candidate.id))]);
    setEdges((current) => [...current, ...related.filter((candidate) => !current.some((edge) => edge.source === project.id && edge.target === candidate.id)).map((candidate) => ({ id: `${project.id}->${candidate.id}`, source: project.id, target: candidate.id, type: 'smoothstep' }))]);
    setNotice('Project relationships added to canvas');
  }, [nodes, selectedNode, setEdges, setNodes]);

  const deliverMockup = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'mockup') return;
    const project = nodes.find((node) => node.data.kind === 'project');
    const agent = nodes.find((node) => node.data.kind === 'agent');
    const taskId = `${selectedNode.id}:delivery-task`;
    const task: CreationFlowNode = {
      id: taskId, type: 'creation', position: { x: selectedNode.position.x + 330, y: selectedNode.position.y + 40 },
      data: { kind: 'task', title: `Build ${selectedNode.data.title}`, status: 'Assigned', role: agent?.data.title || 'Available agent', subtitle: project ? `Deliver to ${project.data.title}.` : 'Attach a project when ready.', resourceId: `task:${crypto.randomUUID()}` },
    };
    setNodes((current) => current.some((node) => node.id === taskId) ? current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Assigned' } } : node) : [...current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Assigned' } } : node), task]);
    setEdges((current) => current.some((edge) => edge.target === taskId) ? current : [...current, { id: `${selectedNode.id}->${taskId}`, source: selectedNode.id, target: taskId, type: 'smoothstep', animated: true }]);
    setSelectedId(taskId);
    setNotice('Mockup attached and delivery task assigned');
  }, [nodes, selectedNode, setEdges, setNodes]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(DND_MIME) as CreationObjectKind;
    if (!kind || !flowRef.current) return;
    const node = newNode(kind, flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  }, [setNodes]);

  const evaluateCanvas = useCallback((event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || thinking) return;
    setThinking(true);
    setNotice('Brain is evaluating connected objects…');
    window.setTimeout(() => {
      const request = prompt.toLowerCase();
      if (request.includes('roadmap')) {
        const project = nodes.find((node) => node.data.kind === 'project');
        const roadmap: CreationFlowNode = { id: `roadmap:${crypto.randomUUID()}`, type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'roadmap', title: request.includes('executive') ? 'Executive team roadmap' : 'Sales presentation roadmap', status: 'AI generated', resourceId: project ? `roadmap:${project.id}` : undefined } };
        setNodes((current) => [...current, roadmap]);
        if (project) setEdges((current) => [...current, { id: `${project.id}->${roadmap.id}`, source: project.id, target: roadmap.id, type: 'smoothstep', animated: true }]);
        setSelectedId(roadmap.id); setThinking(false); setPrompt(''); setNotice('Roadmap added to canvas'); return;
      }
      if (request.includes('top 10') || request.includes('requested features')) {
        const summary: CreationFlowNode = { id: `features:${crypto.randomUUID()}`, type: 'creation', position: { x: 500, y: 260 }, data: { kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' } };
        const mockups: CreationFlowNode = { id: `mockups:${crypto.randomUUID()}`, type: 'creation', position: { x: 1040, y: 300 }, data: { kind: 'mockup', title: 'Top 10 feature mockups', status: 'Ready for review', subtitle: 'Ten linked high-fidelity concepts generated from user feedback.' } };
        setNodes((current) => [...current, summary, mockups]);
        setEdges((current) => [...current, { id: `${summary.id}->${mockups.id}`, source: summary.id, target: mockups.id, type: 'smoothstep', animated: true }]);
        setSelectedId(mockups.id); setThinking(false); setPrompt(''); setNotice('Feature summary and mockups added'); return;
      }
      setNodes((current) => {
        if (current.some((node) => node.id === 'evaluation-campaign')) return current;
        return [...current, { id: 'evaluation-campaign', type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' } }];
      });
      setEdges((current) => current.some((edge) => edge.target === 'evaluation-campaign') ? current : [
        ...current,
        { id: 'workflow-evaluation', source: 'workflow-campaign', target: 'evaluation-campaign', type: 'smoothstep', animated: true },
        { id: 'website-evaluation', source: 'website-campaign', target: 'evaluation-campaign', type: 'smoothstep', animated: true },
      ]);
      setSelectedId('evaluation-campaign');
      setThinking(false);
      setPrompt('');
      setNotice('Evaluation added to canvas');
    }, 850);
  }, [nodes, prompt, setEdges, setNodes, thinking]);

  const runWorkflow = useCallback(() => {
    const targetId = selectedNode?.data.kind === 'workflow' ? selectedNode.id : 'workflow-campaign';
    setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running' } } : node));
    setNotice('Workflow running…');
    window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Complete' } } : node));
      setNotice('Workflow completed');
    }, 1400);
  }, [selectedNode, setNodes]);

  const minimapColor = useCallback((node: CreationFlowNode) => {
    const colors: Partial<Record<CreationObjectKind, string>> = { workflow: '#7357ed', website: '#3978f6', dashboard: '#08b59d', agent: '#8a5cf5', staff: '#f09a3e', evaluation: '#6941d7' };
    return colors[node.data.kind] ?? '#9aa8bd';
  }, []);

  return (
    <div className={`${styles.canvasShell} app-full-height`}>
      <div className={styles.sessionBar}>
        <div className={styles.titleBlock}><span className={styles.spark}>✦</span><input aria-label="Session title" defaultValue="Fall campaign launch" /><span className={styles.saved}>{notice}</span></div>
        <div className={styles.sessionActions}>
          <div className={styles.collaborators} aria-label="Active collaborators"><span className={styles.avatarPink}>SC</span><span className={styles.avatarOrange}>JM</span><span className={styles.avatarGreen}>AK</span><button aria-label="Invite collaborator">+</button></div>
          <button className={styles.secondaryButton} onClick={() => setShareOpen((value) => !value)}>Share ▾</button>
          <button className={styles.primaryButton} onClick={runWorkflow}>▶ Run</button>
          {shareOpen && <div className={styles.shareMenu}><strong>Invite collaborators</strong><p>Anyone invited can build with you and ask Brain questions.</p><div><input placeholder="name@company.com" /><button onClick={() => { setShareOpen(false); setNotice('Invitation ready to send'); }}>Invite</button></div><small>Access: Can edit</small></div>}
        </div>
      </div>

      <div className={styles.flowWrap} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        <ReactFlow<CreationFlowNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={() => setSelectedId(null)}
          onInit={(instance) => { flowRef.current = instance; }}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.35}
          maxZoom={1.6}
          defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#7b8aa0', strokeWidth: 1.5 } }}
          deleteKeyCode={['Backspace', 'Delete']}
          selectionOnDrag
          multiSelectionKeyCode={['Meta', 'Control']}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--creation-dot, #c9d8ea)" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap position="bottom-right" nodeColor={minimapColor} maskColor="rgba(244,248,253,.72)" pannable zoomable />
        </ReactFlow>

        <button className={styles.paletteToggle} onClick={() => setPaletteOpen((value) => !value)} aria-label="Toggle object palette">{paletteOpen ? '‹' : '+'}</button>
        {paletteOpen && <aside className={styles.palette}>
          <div className={styles.paletteHeader}><strong>Add to canvas</strong><button onClick={() => setPaletteOpen(false)} aria-label="Close palette">×</button></div>
          <input className={styles.search} placeholder="Search everything…" />
          {PALETTE.map((group) => <section key={group.group}><h4>{group.group}</h4><div className={styles.paletteGrid}>{group.items.map((item) => <button key={item.kind} aria-label={item.label} draggable onDragStart={(event) => { event.dataTransfer.setData(DND_MIME, item.kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addAtCenter(item.kind)}><span>{item.icon}</span>{item.label}</button>)}</div></section>)}
        </aside>}

        {selectedNode && <Inspector node={selectedNode} onChange={updateSelected} onClose={() => setSelectedId(null)} onRun={runWorkflow} onExpandProject={expandProject} onDeliverMockup={deliverMockup} />}

        <form className={styles.composer} onSubmit={evaluateCanvas}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Ask Brain about this canvas" placeholder="Ask, create, or change anything…" rows={1} />
          <div className={styles.composerBottom}><button type="button" className={styles.iconButton} onClick={() => setPaletteOpen(true)} aria-label="Add an object">＋</button><span className={styles.scopeChip}>⌁ {scopeLabel}⌄</span><span className={styles.composerSpacer} /><button type="button" className={styles.iconButton} aria-label="Use voice">⌕</button><button className={styles.sendButton} aria-label="Send to Brain" disabled={thinking || !prompt.trim()}>{thinking ? '•••' : '➤'}</button></div>
        </form>
      </div>
    </div>
  );
}

function Inspector({ node, onChange, onClose, onRun, onExpandProject, onDeliverMockup }: { node: CreationFlowNode; onChange: (patch: Partial<CreationNodeData>) => void; onClose: () => void; onRun: () => void; onExpandProject: () => void; onDeliverMockup: () => void }) {
  const kind = node.data.kind;
  return <aside className={styles.inspector}>
    <header><div><span>{kind === 'agent' ? '✦' : kind === 'website' ? '◎' : kind === 'workflow' ? '⌘' : '◇'}</span><strong>{node.data.title}</strong><small>Live {kind}</small></div><button onClick={onClose} aria-label="Close inspector">×</button></header>
    <div className={styles.inspectorTabs}><button className={styles.activeTab}>Details</button><button>Activity</button></div>
    <div className={styles.inspectorBody}>
      <label>Name<input value={node.data.title} onChange={(event) => onChange({ title: event.target.value })} /></label>
      {kind === 'agent' && <>
        <label>Model<select value={node.data.model || 'gpt-4o'} onChange={(event) => onChange({ model: event.target.value })}><option>gpt-4o</option><option>claude-3.5-sonnet</option><option>Evermind</option></select></label>
        <label>Instructions<textarea value={node.data.subtitle || ''} onChange={(event) => onChange({ subtitle: event.target.value })} rows={5} /></label>
        <label>Tools<div className={styles.inspectorPills}><span>Audience Analyzer</span><span>Copy Optimizer</span><button>+ Add tool</button></div></label>
        <label>Autonomy<select><option>Medium · request approvals</option><option>Low · suggest only</option><option>High · act within policy</option></select></label>
      </>}
      {kind === 'staff' && <><label>Role<input value={node.data.role || ''} onChange={(event) => onChange({ role: event.target.value })} /></label><label>Current focus<textarea value={node.data.focus || ''} onChange={(event) => onChange({ focus: event.target.value })} rows={4} /></label></>}
      {kind === 'website' && <><label>Viewport<select><option>Desktop · 1440</option><option>Tablet · 768</option><option>Mobile · 390</option></select></label><label>Theme<select><option>Autumn campaign</option><option>Builderforce light</option></select></label><button className={styles.fullButton}>Open WYSIWYG editor</button></>}
      {kind === 'workflow' && <><label>Execution target<select><option>BuilderForce.AI</option><option>Campaign Strategist</option></select></label><label>Approval mode<select><option>Required before publish</option><option>Fully autonomous</option></select></label><button className={styles.fullButton} onClick={onRun}>▶ Run workflow</button></>}
      {kind === 'dashboard' && <><label>Date range<select><option>Last 30 days</option><option>Last 7 days</option><option>Quarter to date</option></select></label><button className={styles.fullButton}>Refresh live data</button></>}
      {kind === 'project' && <><label>Project view<select><option>Everything</option><option>Delivery</option><option>Metrics</option><option>Customer feedback</option></select></label><p className={styles.inspectorHint}>Project context is optional. Add its related items to compare work visually or ground Brain in the complete project.</p><button className={styles.fullButton} onClick={onExpandProject}>Add all related items</button></>}
      {kind === 'mockup' && <><label>Delivery project<select><option>BuilderForce launch</option><option>No project</option></select></label><label>Assign agent<select><option>Campaign Strategist</option><option>Web Analyst</option></select></label><button className={styles.fullButton} onClick={onDeliverMockup}>Add to project and assign</button></>}
      {!['agent', 'staff', 'website', 'workflow', 'dashboard', 'project', 'mockup'].includes(kind) && <p className={styles.inspectorHint}>This object is live in the session. Connect it to other objects or ask Brain to transform or evaluate it.</p>}
    </div>
    <footer><span>Resource</span><code>{node.data.resourceId || `session:${node.id}`}</code><button className={styles.fullButton} onClick={() => onChange({ status: 'Saved' })}>Save changes</button></footer>
  </aside>;
}

export function CreationCanvas({ sessionId }: { sessionId: string }) {
  return <ReactFlowProvider><CanvasInner sessionId={sessionId} /></ReactFlowProvider>;
}
