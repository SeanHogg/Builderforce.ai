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
import { agileMetricsApi, ceremonySessionsApi, creationSessionsApi, projectAgents, runtimeApi, tasksApi, workflows, type CreationSessionActivity, type CreationSessionComment, type CreationSessionDetail, type CreationSessionSummary } from '@/lib/builderforceApi';
import { creationGraphFromSnapshot, creationStorageKey, readLocalCreationSession, type LocalCreationSnapshot } from '@/lib/creationSessions';
import { runCreationCanvasAi } from '@/lib/creationCanvasAi';
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { ProjectEvermindPanel } from '@/components/ide/ProjectEvermindPanel';
import { EvermindValidationProvider } from '@/components/ide/EvermindValidationContext';
import { getProjectEvermindHead } from '@/lib/projectEvermindApi';
import { isAwaitingApprovalExecution } from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import { computeProjectHealth } from '@/lib/projectHealth';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, createDefaultCreationData } from './creationObjectRegistry';

const DND_MIME = 'application/x-builderforce-creation-object';

function newNode(kind: CreationObjectKind, position: { x: number; y: number }): CreationFlowNode {
  return { id: crypto.randomUUID(), type: 'creation', position, data: createDefaultCreationData(kind) };
}

const SEED = {
  workflow: '00000000-0000-4000-8000-000000000001', website: '00000000-0000-4000-8000-000000000002',
  dashboard: '00000000-0000-4000-8000-000000000003', chat: '00000000-0000-4000-8000-000000000004',
  sarah: '00000000-0000-4000-8000-000000000005', jordan: '00000000-0000-4000-8000-000000000006',
  agent: '00000000-0000-4000-8000-000000000007', workflowWebsite: '00000000-0000-4000-8000-000000000008',
  websiteDashboard: '00000000-0000-4000-8000-000000000009',
};

const INITIAL_NODES: CreationFlowNode[] = [
  { id: SEED.workflow, type: 'creation', position: { x: 80, y: 55 }, data: { kind: 'workflow', title: 'Fall campaign workflow', status: 'Ready', resourceId: 'workflow:fall-campaign' } },
  { id: SEED.website, type: 'creation', position: { x: 610, y: 45 }, data: { kind: 'website', title: 'Campaign landing page', status: 'Live', resourceId: 'website:campaign-page' } },
  { id: SEED.dashboard, type: 'creation', position: { x: 1140, y: 55 }, data: { kind: 'dashboard', title: 'Campaign forecast', resourceId: 'dashboard:campaign-forecast' } },
  { id: SEED.chat, type: 'creation', position: { x: 80, y: 380 }, data: { kind: 'chat', title: 'Brain', resourceId: 'chat:campaign-session' } },
  { id: SEED.sarah, type: 'creation', position: { x: 365, y: 455 }, data: { kind: 'staff', title: 'Sarah', role: 'Marketing', focus: 'Defining audience segments and writing email copy.', accent: '#e94b9b', resourceId: 'staff:sarah' } },
  { id: SEED.jordan, type: 'creation', position: { x: 635, y: 455 }, data: { kind: 'staff', title: 'Jordan', role: 'Design', focus: 'Refining hero section and mobile layout.', accent: '#ff9827', resourceId: 'staff:jordan' } },
  { id: SEED.agent, type: 'creation', position: { x: 930, y: 455 }, data: { kind: 'agent', title: 'Campaign Strategist', status: 'Online', model: 'gpt-4o', subtitle: 'Defines strategy, messaging, and audience for high-impact campaigns.', resourceId: 'agent:campaign-strategist' } },
];

const INITIAL_EDGES: Edge[] = [
  { id: SEED.workflowWebsite, source: SEED.workflow, target: SEED.website, label: 'publishes', type: 'smoothstep' },
  { id: SEED.websiteDashboard, source: SEED.website, target: SEED.dashboard, label: 'measures', type: 'smoothstep' },
];

const nodeTypes: NodeTypes = { creation: CreationNode };

function flowFromSession(detail: CreationSessionDetail): { nodes: CreationFlowNode[]; edges: Edge[] } {
  return {
    nodes: detail.objects.map((object) => ({
      id: object.id, type: 'creation',
      position: { x: Number(object.canvasData?.x ?? 0), y: Number(object.canvasData?.y ?? 0) },
      data: {
        kind: object.kind as CreationObjectKind,
        title: object.kind,
        ...(object.resourceType && object.resourceId ? { resourceId: `${object.resourceType}:${object.resourceId}` } : {}),
        ...(object.content ?? {}),
      } as CreationNodeData,
    })),
    edges: detail.connections.map((edge) => ({
      id: edge.id, source: edge.sourceObjectId, target: edge.targetObjectId,
      type: edge.kind || 'smoothstep', label: edge.label ?? undefined, animated: !!edge.metadata?.animated,
    })),
  };
}

function CanvasInner({ sessionId, persistence, initialFocusId }: { sessionId: string; persistence: 'local' | 'server'; initialFocusId?: string | null }) {
  const storageKey = creationStorageKey(sessionId);
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [selectedId, setSelectedId] = useState<string | null>(persistence === 'local' ? null : SEED.agent);
  const [title, setTitle] = useState('Untitled session');
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [prompt, setPrompt] = useState('Will this campaign workflow be effective with this landing page?');
  const [thinking, setThinking] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [notice, setNotice] = useState('Session saved');
  const [members, setMembers] = useState<Array<{ userId: string; displayName: string | null; role: string }>>([]);
  const [sessionRole, setSessionRole] = useState<CreationSessionSummary['role']>('owner');
  const canEdit = persistence === 'local' || sessionRole === 'editor' || sessionRole === 'runner' || sessionRole === 'owner';
  const canRun = persistence === 'local' || sessionRole === 'runner' || sessionRole === 'owner';
  const flowRef = useRef<ReactFlowInstance<CreationFlowNode, Edge> | null>(null);
  const hydrated = useRef(false);
  const revision = useRef(1);
  const lastSavedGraph = useRef('');
  const currentGraph = useRef('');
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (localStorage.getItem('builderforce:create-tour-complete') !== '1') setTourStep(1);
  }, []);

  useEffect(() => {
    try {
      if (persistence === 'local') {
        const saved = readLocalCreationSession(sessionId);
        if (saved) {
          setTitle(saved.title);
          setNodes(saved.nodes);
          setEdges(saved.edges);
        }
        hydrated.current = true;
        return;
      }
      void creationSessionsApi.get(sessionId).then((detail) => {
        const { nodes: loadedNodes, edges: loadedEdges } = flowFromSession(detail);
        setTitle(detail.session.title);
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setMembers(detail.members);
        setSessionRole(detail.role);
        revision.current = detail.session.canvasRevision ?? detail.session.revision ?? 1;
        lastSavedGraph.current = JSON.stringify({ nodes: loadedNodes, edges: loadedEdges });
        currentGraph.current = lastSavedGraph.current;
        hydrated.current = true;
        setNotice('Session saved');
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load session'));
    } catch { hydrated.current = true; }
  }, [persistence, sessionId, setEdges, setNodes]);

  useEffect(() => { currentGraph.current = JSON.stringify({ nodes, edges }); }, [edges, nodes]);

  useEffect(() => {
    if (!initialFocusId || !nodes.some((node) => node.id === initialFocusId)) return;
    setSelectedId(initialFocusId);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [{ id: initialFocusId }], padding: 0.45, duration: 350 }), 0);
  }, [initialFocusId, nodes]);

  useEffect(() => {
    if (!hydrated.current || !canEdit) return;
    const handle = window.setTimeout(() => {
      const serialized = JSON.stringify({ nodes, edges });
      if (serialized === lastSavedGraph.current) return;
      if (persistence === 'local') {
        const prior = readLocalCreationSession(sessionId);
        const snapshot: LocalCreationSnapshot = { version: 1, title, initialPrompt: prior?.initialPrompt, nodes, edges, updatedAt: new Date().toISOString() };
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
        lastSavedGraph.current = serialized;
        setNotice('Saved on this device');
        return;
      }
      setNotice('Saving changes…');
      saveInFlight.current = true;
      const graph = creationGraphFromSnapshot({ nodes, edges });
      void creationSessionsApi.saveGraph(sessionId, { ...graph, expectedRevision: revision.current }).then((saved) => {
        revision.current = saved.revision;
        lastSavedGraph.current = serialized;
        setNotice('Session saved');
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Save failed'))
        .finally(() => { saveInFlight.current = false; });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canEdit, edges, nodes, persistence, sessionId, storageKey, title]);

  useEffect(() => {
    if (persistence !== 'server') return;
    let stopped = false;
    const reconcile = async () => {
      try {
        const presence = await creationSessionsApi.presence(sessionId, revision.current);
        if (stopped) return;
        setMembers(presence.members);
        if (presence.revision <= revision.current || saveInFlight.current || currentGraph.current !== lastSavedGraph.current) return;
        const detail = await creationSessionsApi.get(sessionId);
        if (stopped) return;
        const remoteRevision = detail.session.canvasRevision ?? detail.session.revision ?? 1;
        if (remoteRevision <= revision.current) return;
        const remote = flowFromSession(detail);
        setNodes(remote.nodes);
        setEdges(remote.edges);
        setTitle(detail.session.title);
        revision.current = remoteRevision;
        lastSavedGraph.current = JSON.stringify(remote);
        currentGraph.current = lastSavedGraph.current;
        setNotice('Updated by a collaborator');
      } catch { /* Presence and polling are best-effort; local edits continue. */ }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 8_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [persistence, sessionId, setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const scopeLabel = selectedNode ? selectedNode.data.title : 'Entire canvas';

  const updateSelected = useCallback((patch: Partial<CreationNodeData>) => {
    if (!selectedId || !canEdit) return;
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node));
    setNotice('Saving changes…');
  }, [canEdit, selectedId, setNodes]);

  const importDataset = useCallback(async (file: File) => {
    if (!selectedId) return;
    try {
      const text = await file.text();
      const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
      const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 501);
      const split = (line: string) => line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''));
      const columns = split(lines[0] ?? '').filter(Boolean).slice(0, 24);
      if (!columns.length) throw new Error('No columns found');
      const rows = lines.slice(1).map((line) => Object.fromEntries(columns.map((column, index) => [column, split(line)[index] ?? ''])));
      setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, title: file.name, columns, rows, rowCount: Math.max(rows.length, lines.length - 1), status: 'Imported', subtitle: `${rows.length} preview rows loaded` } } : node));
      setNotice(`${file.name} imported`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Dataset import failed');
    }
  }, [selectedId, setNodes]);

  const visualizeDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    const columns = Array.isArray(selectedNode.data.columns) ? selectedNode.data.columns.map(String) : [];
    const rows = Array.isArray(selectedNode.data.rows) ? selectedNode.data.rows as Array<Record<string, unknown>> : [];
    if (!columns.length || !rows.length) { setNotice('Import data before visualizing it'); return; }
    const numeric = columns.find((column) => rows.some((row) => Number.isFinite(Number(row[column]))));
    const category = columns.find((column) => column !== numeric) ?? columns[0]!;
    let labels: string[];
    let values: number[];
    if (numeric) {
      labels = rows.slice(0, 6).map((row, index) => String(row[category] ?? `Row ${index + 1}`));
      values = rows.slice(0, 6).map((row) => Number(row[numeric]) || 0);
    } else {
      const counts = new Map<string, number>();
      rows.forEach((row) => { const key = String(row[category] ?? 'Unknown'); counts.set(key, (counts.get(key) ?? 0) + 1); });
      const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      labels = entries.map(([label]) => label); values = entries.map(([, value]) => value);
    }
    const dashboard = newNode('dashboard', { x: selectedNode.position.x + 440, y: selectedNode.position.y });
    dashboard.data = { ...dashboard.data, title: `${selectedNode.data.title} visualization`, status: 'Live', chartLabels: labels, chartValues: values, subtitle: numeric ? `${numeric} by ${category}` : `Count by ${category}` };
    setNodes((current) => [...current, dashboard]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: dashboard.id, type: 'smoothstep', label: 'visualizes', animated: true }]);
    setSelectedId(dashboard.id);
    setNotice('Dashboard visualization added');
  }, [selectedNode, setEdges, setNodes]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, current));
  }, [setEdges]);

  const onNodeClick: NodeMouseHandler<CreationFlowNode> = useCallback((_event, node) => setSelectedId(node.id), []);

  const addAtCenter = useCallback((kind: CreationObjectKind) => {
    if (!canEdit) { setNotice('Your session role does not allow editing'); return; }
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const node = newNode(kind, position);
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
    setNotice(`${node.data.title} added`);
  }, [canEdit, setNodes]);

  const expandProject = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : nodes.find((node) => node.data.kind === 'project');
    if (!project) {
      setNotice('Add or select a project first');
      return;
    }
    const projectId = project.data.resourceId?.startsWith('project:') ? Number(project.data.resourceId.slice('project:'.length)) : NaN;
    if (persistence === 'server' && Number.isInteger(projectId) && projectId > 0) {
      setNotice('Loading project relationships…');
      void Promise.all([
        tasksApi.list(projectId).catch(() => []),
        workflows.list({ projectId }).catch(() => []),
        projectAgents.list(projectId).catch(() => []),
      ]).then(([tasks, projectWorkflows, agents]) => {
        const related: CreationFlowNode[] = [
          ...tasks.slice(0, 12).map((task, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 390 + (index % 3) * 300, y: project.position.y - 180 + Math.floor(index / 3) * 190 }, data: { kind: 'task', title: task.title, status: task.status, subtitle: task.description ?? undefined, resourceId: `task:${task.id}` } })),
          ...projectWorkflows.slice(0, 6).map((workflow, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 390 + index * 320, y: project.position.y + 650 }, data: { kind: 'workflow', title: workflow.description || `${workflow.workflowType} workflow`, status: workflow.status, resourceId: `workflow:${workflow.id}` } })),
          ...agents.slice(0, 6).map((agent, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x - 50 + index * 290, y: project.position.y + 900 }, data: { kind: 'agent', title: agent.name, status: 'Available', role: agent.role, resourceId: `agent:${agent.agentRef}` } })),
        ];
        setNodes((current) => {
          const known = new Set(current.map((node) => node.data.resourceId).filter(Boolean));
          return [...current, ...related.filter((node) => !known.has(node.data.resourceId))];
        });
        setEdges((current) => [...current, ...related.map((node) => ({ id: crypto.randomUUID(), source: project.id, target: node.id, type: 'smoothstep', label: node.data.kind }))]);
        setNotice(`${related.length} related project items added`);
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not expand project'));
      return;
    }
    const related: CreationFlowNode[] = [
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y - 150 }, data: { kind: 'dashboard', title: `${project.data.title} health`, resourceId: `dashboard:${project.id}` } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y + 100 }, data: { kind: 'roadmap', title: `${project.data.title} roadmap`, status: 'Live', resourceId: `roadmap:${project.id}` } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y - 120 }, data: { kind: 'workflow', title: 'Delivery workflow', status: 'Ready', resourceId: `workflow:${project.id}` } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y + 150 }, data: { kind: 'task', title: 'Next delivery task', status: 'Ready', role: 'Campaign Strategist', resourceId: `task:${project.id}` } },
    ];
    setNodes((current) => [...current, ...related.filter((candidate) => !current.some((node) => node.id === candidate.id))]);
    setEdges((current) => [...current, ...related.filter((candidate) => !current.some((edge) => edge.source === project.id && edge.target === candidate.id)).map((candidate) => ({ id: crypto.randomUUID(), source: project.id, target: candidate.id, type: 'smoothstep' }))]);
    setNotice('Project relationships added to canvas');
  }, [nodes, persistence, selectedNode, setEdges, setNodes]);

  const compareProjects = useCallback(() => {
    const projectNodes = nodes.filter((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || '')).slice(0, 6);
    if (projectNodes.length < 2) { setNotice('Add at least two saved projects to compare'); return; }
    if (persistence !== 'server') { setNotice('Save this session to load current project evidence'); return; }
    setNotice('Loading fresh project evidence…');
    void fetchProjects().then(async (available) => {
      const byId = new Map(available.map((project) => [project.id, project]));
      const evidence = await Promise.all(projectNodes.map(async (node) => {
        const projectId = Number(node.data.resourceId!.slice('project:'.length));
        const project = byId.get(projectId);
        if (!project) throw new Error(`Project ${projectId} is no longer accessible`);
        const [velocity, tasks] = await Promise.all([
          agileMetricsApi.derivedVelocity(projectId).catch(() => null),
          tasksApi.list(projectId).catch(() => []),
        ]);
        const health = computeProjectHealth(project);
        return {
          projectId, name: project.name, status: project.status || 'active', progress: health.progressPct,
          health: health.healthScore, healthTier: health.tier, open: health.open, blocked: health.blocked,
          overdue: health.overdue, velocity: velocity?.averageVelocity ?? null,
          features: tasks.filter((task) => !['done', 'closed', 'cancelled'].includes(task.status)).slice(0, 5).map((task) => task.title),
        };
      }));
      const comparison = newNode('projectComparison', { x: Math.max(...projectNodes.map((node) => node.position.x)) + 430, y: Math.min(...projectNodes.map((node) => node.position.y)) });
      comparison.data = {
        ...comparison.data, title: `${evidence.map((project) => project.name).join(' vs ')}`, status: 'Live evidence', projects: evidence,
        fetchedAt: new Date().toISOString(), sources: evidence.flatMap((project) => [
          { label: `${project.name} project metrics`, resource: `/api/projects`, projectId: project.projectId },
          { label: `${project.name} velocity`, resource: `/api/agile/velocity/derived?projectId=${project.projectId}`, projectId: project.projectId },
          { label: `${project.name} feature/task evidence`, resource: `/api/tasks?projectId=${project.projectId}`, projectId: project.projectId },
        ]),
      };
      setNodes((current) => [...current, comparison]);
      setEdges((current) => [...current, ...projectNodes.map((project) => ({ id: crypto.randomUUID(), source: project.id, target: comparison.id, label: 'compared in', type: 'smoothstep', animated: true }))]);
      setSelectedId(comparison.id);
      setNotice('Evidence-backed project comparison added');
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not compare projects'));
  }, [nodes, persistence, setEdges, setNodes]);

  const deliverMockup = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'mockup') return;
    const project = nodes.find((node) => node.data.kind === 'project');
    const agent = nodes.find((node) => node.data.kind === 'agent');
    const projectId = project?.data.resourceId?.startsWith('project:') ? Number(project.data.resourceId.slice('project:'.length)) : NaN;
    const addTaskNode = (resourceId: string, status: string) => {
      const taskId = crypto.randomUUID();
      const task: CreationFlowNode = {
        id: taskId, type: 'creation', position: { x: selectedNode.position.x + 330, y: selectedNode.position.y + 40 },
        data: { kind: 'task', title: `Build ${selectedNode.data.title}`, status, role: agent?.data.title || 'Available agent', subtitle: project ? `Deliver to ${project.data.title}.` : 'Attach a project when ready.', resourceId },
      };
      setNodes((current) => [...current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status } } : node), task]);
      setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: taskId, type: 'smoothstep', animated: true }]);
      setSelectedId(taskId);
    };
    if (persistence === 'server' && Number.isInteger(projectId) && projectId > 0) {
      setNotice('Creating delivery task…');
      const agentRef = agent?.data.resourceId?.startsWith('agent:') ? agent.data.resourceId.slice('agent:'.length) : undefined;
      void tasksApi.create({
        projectId,
        title: `Build ${selectedNode.data.title}`,
        description: `${selectedNode.data.subtitle || 'Implement the approved canvas mockup.'}\n\nSource creation session: ${sessionId}\nSource canvas object: ${selectedNode.id}`,
        priority: 'high',
        ...(agentRef ? { assignedAgentRef: agentRef } : {}),
      }).then(async (created) => {
        addTaskNode(`task:${created.id}`, agentRef ? 'Assigned' : 'Ready');
        if (agentRef) {
          const execution = await runtimeApi.submitExecution({ taskId: created.id, sessionId });
          setNotice(isAwaitingApprovalExecution(execution) ? 'Delivery task created; agent run is awaiting approval' : 'Delivery task created and agent started');
        } else {
          setNotice('Mockup delivered to the project as a task');
        }
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not create delivery task'));
      return;
    }
    addTaskNode(`draft-task:${crypto.randomUUID()}`, 'Draft');
    setNotice(persistence === 'local' ? 'Draft delivery task added; save to deliver it' : 'Add a real project to deliver this task');
  }, [nodes, persistence, selectedNode, sessionId, setEdges, setNodes]);

  const attachEvermindProject = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const project = nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || ''));
    if (!project) { setNotice('Add a saved project to the canvas first'); return; }
    const projectId = Number(project.data.resourceId!.slice('project:'.length));
    updateSelected({ resourceId: `evermind:${projectId}`, projectId, status: 'Loading…' });
    setEdges((current) => current.some((edge) => edge.source === project.id && edge.target === selectedNode.id) ? current : [...current, { id: crypto.randomUUID(), source: project.id, target: selectedNode.id, label: 'owns model', type: 'smoothstep' }]);
    void getProjectEvermindHead(projectId).then((head) => {
      updateSelected({ title: head.name || selectedNode.data.title, status: head.seeded ? `v${head.version} · ${head.mode}` : 'Ready to seed', evermindVersion: head.version, contributions: head.contributions, inferenceEnabled: head.inferenceEnabled, teacherModel: head.teacherModel || undefined });
      setNotice('Evermind attached to project');
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load Evermind'));
  }, [nodes, selectedNode, setEdges, updateSelected]);

  const expandEvermindPipeline = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const specs: Array<{ kind: CreationObjectKind; title: string; status: string; x: number; y: number; label: string }> = [
      { kind: 'dataset', title: `${selectedNode.data.title} training corpus`, status: 'Add data', x: -430, y: -20, label: 'trains on' },
      { kind: 'workflow', title: 'Tokenizer build', status: 'Ready', x: -20, y: 240, label: 'tokenizes' },
      { kind: 'workflow', title: 'Evermind tuning run', status: 'Ready', x: 390, y: 240, label: 'tunes' },
      { kind: 'evaluation', title: 'Model quality gate', status: 'Awaiting model', x: 800, y: 15, label: 'evaluates' },
      { kind: 'dashboard', title: 'Training telemetry', status: 'Live', x: 800, y: 300, label: 'measures' },
    ];
    const created = specs.map((spec) => {
      const node = newNode(spec.kind, { x: selectedNode.position.x + spec.x, y: selectedNode.position.y + spec.y });
      node.data = { ...node.data, title: spec.title, status: spec.status, modelPipelineFor: selectedNode.id };
      return { node, label: spec.label };
    });
    setNodes((current) => [...current, ...created.map(({ node }) => node)]);
    setEdges((current) => [...current, ...created.map(({ node, label }) => ({ id: crypto.randomUUID(), source: node.data.kind === 'dataset' ? node.id : selectedNode.id, target: node.data.kind === 'dataset' ? selectedNode.id : node.id, label, type: 'smoothstep', animated: true }))]);
    setNotice('Evermind creation and training pipeline added');
  }, [selectedNode, setEdges, setNodes]);

  const startStandup = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'standup') return;
    const people = nodes.filter((node) => node.data.kind === 'staff' || node.data.kind === 'agent').slice(0, 25);
    if (!people.length) { setNotice('Add staff members or agents to the canvas first'); return; }
    const participants = people.map((node) => ({
      kind: node.data.kind === 'agent' ? 'agent' : 'human',
      ref: node.data.resourceId?.split(':').slice(1).join(':') || node.id,
      name: node.data.title,
      focus: node.data.focus || node.data.subtitle || 'No current focus recorded',
    }));
    const applyStandup = (resourceId?: string) => {
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: resourceId ? 'Live' : 'Draft', participants, resourceId: resourceId || node.data.resourceId, summary: `${participants.length} participants gathered. Brain will ask each person for progress, blockers, and next actions, then create follow-up work on this canvas.` } } : node));
      setEdges((current) => [...current, ...people.filter((person) => !current.some((edge) => edge.source === person.id && edge.target === selectedNode.id)).map((person) => ({ id: crypto.randomUUID(), source: person.id, target: selectedNode.id, label: 'joins', type: 'smoothstep' }))]);
    };
    const project = nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || ''));
    const projectId = project ? Number(project.data.resourceId!.slice('project:'.length)) : null;
    if (persistence === 'server' && projectId) {
      setNotice('Starting canonical stand-up…');
      void ceremonySessionsApi.start(projectId, 'standup', participants.map(({ kind, ref, name }) => ({ kind, ref, name }))).then((result) => {
        const ceremonyId = result.session?.id;
        applyStandup(ceremonyId ? `ceremony:${ceremonyId}` : undefined);
        setNotice(ceremonyId ? 'Live stand-up started' : 'Stand-up frame prepared');
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not start stand-up'));
      return;
    }
    applyStandup();
    setNotice(persistence === 'local' ? 'Draft stand-up gathered; save to start it live' : 'Add a project to start a live stand-up');
  }, [nodes, persistence, selectedNode, setEdges, setNodes]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (!canEdit) { setNotice('Your session role does not allow editing'); return; }
    const kind = event.dataTransfer.getData(DND_MIME) as CreationObjectKind;
    if (!kind || !flowRef.current) return;
    const node = newNode(kind, flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  }, [canEdit, setNodes]);

  const canvasActions = useMemo<BrainAction[]>(() => [{
    name: 'canvas_read_snapshot',
    description: 'Read every object and relationship currently visible on the creation canvas.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => ({
      objects: nodes.map((node) => ({ id: node.id, kind: node.data.kind, title: node.data.title, status: node.data.status, content: node.data.subtitle })),
      connections: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label })),
    }),
  }, {
    name: 'canvas_add_object',
    description: 'Add a visual object to the canvas. Use this whenever the user asks to create a website, workflow, chart, roadmap, mockup, task, agent, note, or other canvas artifact.',
    parameters: {
      type: 'object', required: ['kind', 'title'], additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: CREATION_OBJECT_REGISTRY.map((definition) => definition.kind) },
        title: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      const args = raw as { kind?: CreationObjectKind; title?: string; subtitle?: string; status?: string; x?: number; y?: number };
      const allowed = new Set(CREATION_OBJECT_REGISTRY.map((definition) => definition.kind));
      if (!args.kind || !allowed.has(args.kind)) return { error: 'Unsupported canvas object kind' };
      const node = newNode(args.kind, { x: Number(args.x ?? 520), y: Number(args.y ?? 280) });
      node.data = { ...node.data, title: String(args.title || node.data.title).slice(0, 160), subtitle: args.subtitle?.slice(0, 2_000), status: args.status?.slice(0, 80) };
      setNodes((current) => [...current, node]);
      setSelectedId(node.id);
      return { ok: true, object: { id: node.id, kind: node.data.kind, title: node.data.title } };
    },
  }, {
    name: 'canvas_update_object',
    description: 'Update the title, explanatory content, or status of an existing canvas object.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; title?: string; subtitle?: string; status?: string };
      if (!args.objectId || !nodes.some((node) => node.id === args.objectId)) return { error: 'Object not found' };
      setNodes((current) => current.map((node) => node.id === args.objectId ? { ...node, data: { ...node.data, ...(args.title ? { title: args.title.slice(0, 160) } : {}), ...(args.subtitle ? { subtitle: args.subtitle.slice(0, 2_000) } : {}), ...(args.status ? { status: args.status.slice(0, 80) } : {}) } } : node));
      return { ok: true, objectId: args.objectId };
    },
  }, {
    name: 'canvas_connect_objects',
    description: 'Draw a labeled relationship between two existing canvas objects.',
    parameters: { type: 'object', required: ['sourceId', 'targetId'], additionalProperties: false, properties: { sourceId: { type: 'string' }, targetId: { type: 'string' }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      const args = raw as { sourceId?: string; targetId?: string; label?: string };
      if (!args.sourceId || !args.targetId || !nodes.some((node) => node.id === args.sourceId) || !nodes.some((node) => node.id === args.targetId)) return { error: 'Source or target object not found' };
      const edge = { id: crypto.randomUUID(), source: args.sourceId, target: args.targetId, label: args.label?.slice(0, 120), type: 'smoothstep', animated: true } satisfies Edge;
      setEdges((current) => [...current, edge]);
      return { ok: true, connectionId: edge.id };
    },
  }], [edges, nodes, setEdges, setNodes]);

  const evaluateCanvas = useCallback((event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || thinking) return;
    setThinking(true);
    setNotice('Brain is evaluating connected objects…');
    if (process.env.NODE_ENV !== 'test') {
      const request = prompt.trim();
      const snapshot = JSON.stringify({
        sessionId, selectedObjectId: selectedId,
        objects: nodes.map((node) => ({ id: node.id, kind: node.data.kind, title: node.data.title, status: node.data.status, content: node.data.subtitle, position: node.position })),
        connections: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label })),
      });
      setPrompt('');
      void runCreationCanvasAi({ prompt: request, canvasSnapshot: snapshot, persistence, canvasActions }).then((answer) => {
        if (answer.trim()) {
          const chat = nodes.find((node) => node.data.kind === 'chat');
          if (chat) setNodes((current) => current.map((node) => node.id === chat.id ? { ...node, data: { ...node.data, aiResponse: answer.trim() } } : node));
          else {
            const responseNode = newNode('chat', { x: 120, y: 120 });
            responseNode.data = { ...responseNode.data, title: 'Brain', subtitle: request, aiResponse: answer.trim() };
            setNodes((current) => [...current, responseNode]);
          }
        }
        setThinking(false);
        setNotice('Brain finished updating the canvas');
      }).catch((error) => {
        setThinking(false);
        setNotice(error instanceof Error ? error.message : 'Brain could not complete this request');
      });
      return;
    }
    window.setTimeout(() => {
      const request = prompt.toLowerCase();
      if (request.includes('roadmap')) {
        const project = nodes.find((node) => node.data.kind === 'project');
        const roadmap: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'roadmap', title: request.includes('executive') ? 'Executive team roadmap' : 'Sales presentation roadmap', status: 'AI generated', resourceId: project ? `roadmap:${project.id}` : undefined } };
        setNodes((current) => [...current, roadmap]);
        if (project) setEdges((current) => [...current, { id: crypto.randomUUID(), source: project.id, target: roadmap.id, type: 'smoothstep', animated: true }]);
        setSelectedId(roadmap.id); setThinking(false); setPrompt(''); setNotice('Roadmap added to canvas'); return;
      }
      if (request.includes('top 10') || request.includes('requested features')) {
        const summary: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 500, y: 260 }, data: { kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' } };
        const mockups: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 300 }, data: { kind: 'mockup', title: 'Top 10 feature mockups', status: 'Ready for review', subtitle: 'Ten linked high-fidelity concepts generated from user feedback.' } };
        setNodes((current) => [...current, summary, mockups]);
        setEdges((current) => [...current, { id: crypto.randomUUID(), source: summary.id, target: mockups.id, type: 'smoothstep', animated: true }]);
        setSelectedId(mockups.id); setThinking(false); setPrompt(''); setNotice('Feature summary and mockups added'); return;
      }
      const evaluationId = crypto.randomUUID();
      setNodes((current) => [...current, { id: evaluationId, type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' } }]);
      const workflow = nodes.find((node) => node.data.kind === 'workflow');
      const website = nodes.find((node) => node.data.kind === 'website');
      setEdges((current) => [...current, ...[workflow, website].filter((node): node is CreationFlowNode => !!node).map((node) => ({ id: crypto.randomUUID(), source: node.id, target: evaluationId, type: 'smoothstep', animated: true }))]);
      setSelectedId(evaluationId);
      setThinking(false);
      setPrompt('');
      setNotice('Evaluation added to canvas');
    }, 850);
  }, [canvasActions, edges, nodes, persistence, prompt, selectedId, sessionId, setEdges, setNodes, thinking]);

  const runWorkflow = useCallback(() => {
    if (!canRun) { setNotice('Runner or owner access is required'); return; }
    const targetId = selectedNode?.data.kind === 'workflow' ? selectedNode.id : nodes.find((node) => node.data.kind === 'workflow')?.id;
    if (!targetId) { setNotice('Add a workflow to run it'); return; }
    setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running' } } : node));
    setNotice('Workflow running…');
    window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Complete' } } : node));
      setNotice('Workflow completed');
    }, 1400);
  }, [canRun, nodes, selectedNode, setNodes]);

  const minimapColor = useCallback((node: CreationFlowNode) => {
    const colors: Partial<Record<CreationObjectKind, string>> = { workflow: '#7357ed', website: '#3978f6', dashboard: '#08b59d', agent: '#8a5cf5', staff: '#f09a3e', evaluation: '#6941d7', evermind: '#df4fa5', projectComparison: '#0d8f82' };
    return colors[node.data.kind] ?? '#9aa8bd';
  }, []);

  return (
    <div className={`${styles.canvasShell} app-full-height`}>
      <div className={styles.sessionBar}>
        <div className={styles.titleBlock}><span className={styles.spark}>✦</span><input aria-label="Session title" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (persistence === 'server') void creationSessionsApi.update(sessionId, { title }).then(() => setNotice('Session saved')).catch(() => setNotice('Title save failed')); }} /><span className={styles.saved}>{notice}</span></div>
        <div className={styles.sessionActions}>
          <div className={styles.collaborators} aria-label="Active collaborators">
            {(persistence === 'local' ? [{ userId: 'local', displayName: 'You', role: 'owner' }] : members).slice(0, 4).map((member, index) => <span key={member.userId} title={`${member.displayName || 'Collaborator'} · ${member.role}`} className={[styles.avatarPink, styles.avatarOrange, styles.avatarGreen][index % 3]}>{(member.displayName || 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>)}
            <button aria-label="Invite collaborator" onClick={() => setShareOpen(true)}>+</button>
          </div>
          <button className={styles.secondaryButton} onClick={() => setShareOpen((value) => !value)}>Share ▾</button>
          {persistence === 'local' && <button className={styles.primaryButton} onClick={() => { window.location.href = `/login?next=${encodeURIComponent(`/create/${sessionId}`)}`; }}>Save & collaborate</button>}
          <button className={styles.primaryButton} disabled={!canRun} onClick={runWorkflow}>▶ Run</button>
          {shareOpen && <div className={styles.shareMenu}><strong>{persistence === 'local' ? 'Save to invite people' : 'Invite collaborators'}</strong><p>{persistence === 'local' ? 'Your work is safe on this device. Create a free account when you want live collaboration or delivery.' : 'Anyone invited can build with you and ask Brain questions.'}</p>{persistence === 'local' ? <button onClick={() => { window.location.href = `/login?next=${encodeURIComponent(`/create/${sessionId}`)}`; }}>Save this session</button> : <div><input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" /><button disabled={!inviteEmail.trim()} onClick={() => { void creationSessionsApi.invite(sessionId, { email: inviteEmail.trim() }).then(() => { setShareOpen(false); setInviteEmail(''); setNotice('Collaborator invited'); }).catch((error) => setNotice(error instanceof Error ? error.message : 'Invite failed')); }}>Invite</button></div>}<small>Access: {persistence === 'local' ? 'Private on this device' : 'Can edit'}</small></div>}
        </div>
      </div>

      <div className={styles.flowWrap} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        {tourStep > 0 && <div style={{ position: 'absolute', zIndex: 30, top: 18, left: '50%', transform: 'translateX(-50%)', width: 'min(430px, calc(100% - 32px))', padding: 16, borderRadius: 14, background: 'var(--bg-elevated, white)', boxShadow: '0 14px 44px rgba(25,40,70,.22)', border: '1px solid var(--border-subtle)' }}>
          <strong>{tourStep === 1 ? 'Everything is an object' : tourStep === 2 ? 'Brain understands the whole canvas' : 'Save only when you need to'}</strong>
          <p style={{ margin: '7px 0 12px', color: 'var(--text-secondary)', fontSize: 13 }}>{tourStep === 1 ? 'Drag workflows, sites, data, agents, people, and project context from the palette.' : tourStep === 2 ? 'Select one object for a focused question, or click the background to evaluate the complete session.' : 'Anonymous work stays on this device. Sign in later to collaborate, sync, and deliver into projects.'}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><small>{tourStep} of 3</small><button className={styles.primaryButton} onClick={() => { if (tourStep < 3) setTourStep((step) => step + 1); else { localStorage.setItem('builderforce:create-tour-complete', '1'); setTourStep(0); } }}>{tourStep < 3 ? 'Next' : 'Start creating'}</button></div>
        </div>}
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
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
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
          {CREATION_PALETTE_GROUPS.map((group) => <section key={group.group}><h4>{group.group}</h4><div className={styles.paletteGrid}>{group.items.map((item) => <button key={item.kind} aria-label={item.label} disabled={!canEdit} draggable={canEdit} onDragStart={(event) => { event.dataTransfer.setData(DND_MIME, item.kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addAtCenter(item.kind)}><span>{item.icon}</span>{item.label}</button>)}</div></section>)}
        </aside>}

        {selectedNode && <Inspector node={selectedNode} sessionId={sessionId} persistence={persistence} role={sessionRole} editable={canEdit} members={members} onChange={updateSelected} onClose={() => setSelectedId(null)} onRun={runWorkflow} onExpandProject={expandProject} onCompareProjects={compareProjects} onDeliverMockup={deliverMockup} onImportDataset={importDataset} onVisualizeDataset={visualizeDataset} onAttachEvermindProject={attachEvermindProject} onExpandEvermindPipeline={expandEvermindPipeline} onStartStandup={startStandup} />}

        <form className={styles.composer} onSubmit={evaluateCanvas}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Ask Brain about this canvas" placeholder="Ask, create, or change anything…" rows={1} />
          <div className={styles.composerBottom}><button type="button" className={styles.iconButton} onClick={() => setPaletteOpen(true)} aria-label="Add an object">＋</button><span className={styles.scopeChip}>⌁ {scopeLabel}⌄</span><span className={styles.composerSpacer} /><button type="button" className={styles.iconButton} aria-label="Use voice">⌕</button><button className={styles.sendButton} aria-label="Send to Brain" disabled={thinking || !prompt.trim()}>{thinking ? '•••' : '➤'}</button></div>
        </form>
      </div>
    </div>
  );
}

function Inspector({ node, sessionId, persistence, role, editable, members, onChange, onClose, onRun, onExpandProject, onCompareProjects, onDeliverMockup, onImportDataset, onVisualizeDataset, onAttachEvermindProject, onExpandEvermindPipeline, onStartStandup }: { node: CreationFlowNode; sessionId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; editable: boolean; members: Array<{ userId: string; displayName: string | null; role: string }>; onChange: (patch: Partial<CreationNodeData>) => void; onClose: () => void; onRun: () => void; onExpandProject: () => void; onCompareProjects: () => void; onDeliverMockup: () => void; onImportDataset: (file: File) => void | Promise<void>; onVisualizeDataset: () => void; onAttachEvermindProject: () => void; onExpandEvermindPipeline: () => void; onStartStandup: () => void }) {
  const kind = node.data.kind;
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  return <aside className={styles.inspector}>
    <header><div><span>{kind === 'agent' ? '✦' : kind === 'website' ? '◎' : kind === 'workflow' ? '⌘' : '◇'}</span><strong>{node.data.title}</strong><small>Live {kind}</small></div><button onClick={onClose} aria-label="Close inspector">×</button></header>
    <div className={styles.inspectorTabs}><button className={tab === 'details' ? styles.activeTab : ''} onClick={() => setTab('details')}>Details</button><button className={tab === 'activity' ? styles.activeTab : ''} onClick={() => setTab('activity')}>Activity</button></div>
    <div className={styles.inspectorBody}>
      {tab === 'details' ? <fieldset className={styles.inspectorFields} disabled={!editable}>
      <label>Name<input value={node.data.title} onChange={(event) => onChange({ title: event.target.value })} /></label>
      {kind === 'agent' && <>
        <label>Model<select value={node.data.model || 'gpt-4o'} onChange={(event) => onChange({ model: event.target.value })}><option>gpt-4o</option><option>claude-3.5-sonnet</option><option>Evermind</option></select></label>
        <label>Instructions<textarea value={node.data.subtitle || ''} onChange={(event) => onChange({ subtitle: event.target.value })} rows={5} /></label>
        <label>Tools<div className={styles.inspectorPills}><span>Audience Analyzer</span><span>Copy Optimizer</span><button>+ Add tool</button></div></label>
        <label>Autonomy<select><option>Medium · request approvals</option><option>Low · suggest only</option><option>High · act within policy</option></select></label>
      </>}
      {kind === 'staff' && <><label>Role<input value={node.data.role || ''} onChange={(event) => onChange({ role: event.target.value })} /></label><label>Current focus<textarea value={node.data.focus || ''} onChange={(event) => onChange({ focus: event.target.value })} rows={4} /></label></>}
      {kind === 'website' && <><label>Headline<input value={typeof node.data.websiteHeadline === 'string' ? node.data.websiteHeadline : 'Fall in love with every look'} onChange={(event) => onChange({ websiteHeadline: event.target.value })} /></label><label>Supporting copy<textarea rows={3} value={typeof node.data.websiteBody === 'string' ? node.data.websiteBody : 'New arrivals for the season ahead.'} onChange={(event) => onChange({ websiteBody: event.target.value })} /></label><label>Call to action<input value={typeof node.data.websiteCta === 'string' ? node.data.websiteCta : 'Shop the collection'} onChange={(event) => onChange({ websiteCta: event.target.value })} /></label><label>Accent color<input type="color" value={typeof node.data.websiteAccent === 'string' ? node.data.websiteAccent : '#3978f6'} onChange={(event) => onChange({ websiteAccent: event.target.value })} /></label><label>Viewport<select value={typeof node.data.viewport === 'string' ? node.data.viewport : 'desktop'} onChange={(event) => onChange({ viewport: event.target.value })}><option value="desktop">Desktop · 1440</option><option value="tablet">Tablet · 768</option><option value="mobile">Mobile · 390</option></select></label><p className={styles.inspectorHint}>Changes render live in the interactive prototype on the canvas.</p></>}
      {kind === 'workflow' && <><label>Execution target<select><option>BuilderForce.AI</option><option>Campaign Strategist</option></select></label><label>Approval mode<select><option>Required before publish</option><option>Fully autonomous</option></select></label><button className={styles.fullButton} onClick={onRun}>▶ Run workflow</button></>}
      {kind === 'dashboard' && <><label>Date range<select><option>Last 30 days</option><option>Last 7 days</option><option>Quarter to date</option></select></label><button className={styles.fullButton}>Refresh live data</button></>}
      {kind === 'dataset' && <><label>Import CSV or TSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportDataset(file); }} /></label><p className={styles.inspectorHint}>A safe preview of up to 500 rows is stored with this session. Connect it to a dashboard or ask Brain to analyze it.</p><button className={styles.fullButton} onClick={onVisualizeDataset}>Create visualization</button></>}
      {kind === 'project' && <><label>Project view<select><option>Everything</option><option>Delivery</option><option>Metrics</option><option>Customer feedback</option></select></label><p className={styles.inspectorHint}>Project context is optional. Add its related items to compare work visually or ground Brain in the complete project.</p><button className={styles.fullButton} onClick={onExpandProject}>Add all related items</button><button className={styles.fullButton} onClick={onCompareProjects}>Compare projects on canvas</button></>}
      {kind === 'projectComparison' && <><p className={styles.inspectorHint}>This comparison retains the source endpoints and fetch timestamp used for every project. Refresh to compare current delivery, velocity, and feature evidence.</p><button className={styles.fullButton} onClick={onCompareProjects}>Refresh project comparison</button><SourceList sources={node.data.sources} /></>}
      {kind === 'mockup' && <><label>Delivery project<select><option>BuilderForce launch</option><option>No project</option></select></label><label>Assign agent<select><option>Campaign Strategist</option><option>Web Analyst</option></select></label><button className={styles.fullButton} onClick={onDeliverMockup}>Add to project and assign</button></>}
      {kind === 'evermind' && <EvermindInspector node={node} persistence={persistence} onAttach={onAttachEvermindProject} onExpand={onExpandEvermindPipeline} />}
      {kind === 'standup' && <><p className={styles.inspectorHint}>Gather every Staff Member and Agent currently on the canvas. With a saved Project, this starts the canonical stand-up ceremony and keeps its resource link in the session.</p><button className={styles.fullButton} onClick={onStartStandup}>Gather and start stand-up</button></>}
      {!['agent', 'staff', 'website', 'workflow', 'dashboard', 'project', 'mockup', 'evermind', 'standup'].includes(kind) && <p className={styles.inspectorHint}>This object is live in the session. Connect it to other objects or ask Brain to transform or evaluate it.</p>}
      </fieldset> : <ActivityInspector sessionId={sessionId} objectId={node.id} persistence={persistence} role={role} members={members} />}
    </div>
    <footer><span>Resource · {role}</span><code>{node.data.resourceId || `session:${node.id}`}</code><button className={styles.fullButton} disabled={!editable} onClick={() => onChange({ status: 'Saved' })}>Save changes</button></footer>
  </aside>;
}

function SourceList({ sources }: { sources: unknown }) {
  if (!Array.isArray(sources) || !sources.length) return null;
  return <div className={styles.sourceList}><strong>Evidence sources</strong>{sources.map((source, index) => { const item = source as { label?: string; resource?: string }; return <div key={`${item.resource}-${index}`}><span>{index + 1}</span><p><b>{item.label || 'Source'}</b><code>{item.resource || 'Canonical API'}</code></p></div>; })}</div>;
}

function EvermindInspector({ node, persistence, onAttach, onExpand }: { node: CreationFlowNode; persistence: 'local' | 'server'; onAttach: () => void; onExpand: () => void }) {
  const rawProjectId = node.data.resourceId?.startsWith('evermind:') ? node.data.resourceId.slice('evermind:'.length) : '';
  const projectId = /^\d+$/.test(rawProjectId) ? Number(rawProjectId) : null;
  return <>
    <p className={styles.inspectorHint}>Evermind is now a canvas-native model object. Build its data and training flow visually, then operate the same production console here.</p>
    <button className={styles.fullButton} onClick={onExpand}>Add creation & training pipeline</button>
    {persistence === 'local' && <p className={styles.inspectorHint}>This blueprint works without an account. Save the session when you want to run training, store versions, or deploy inference.</p>}
    {persistence === 'server' && projectId == null && <button className={styles.fullButton} onClick={onAttach}>Use project on canvas</button>}
    {persistence === 'server' && projectId != null && <div className={styles.evermindConsoleHost}><EvermindValidationProvider><ProjectEvermindPanel projectId={projectId} /></EvermindValidationProvider></div>}
  </>;
}

function ActivityInspector({ sessionId, objectId, persistence, role, members }: { sessionId: string; objectId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; members: Array<{ userId: string; displayName: string | null; role: string }> }) {
  const [comments, setComments] = useState<CreationSessionComment[]>([]);
  const [activity, setActivity] = useState<CreationSessionActivity[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(persistence === 'local' ? 'Save this session to collaborate.' : 'Loading activity…');
  const canComment = role !== 'viewer';

  const reload = useCallback(async () => {
    if (persistence !== 'server') return;
    try {
      const [commentResult, activityResult] = await Promise.all([
        creationSessionsApi.comments.list(sessionId, objectId),
        creationSessionsApi.activity(sessionId, 50),
      ]);
      setComments(commentResult.comments);
      setActivity(activityResult.activity.filter((item) => !item.objectId || item.objectId === objectId));
      setStatus(commentResult.comments.length || activityResult.activity.length ? '' : 'No activity on this object yet.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load activity');
    }
  }, [objectId, persistence, sessionId]);

  useEffect(() => { void reload(); }, [reload]);

  const submit = () => {
    const body = draft.trim();
    if (!body || persistence !== 'server' || !canComment) return;
    const normalized = body.toLowerCase();
    const mentions = members.filter((member) => member.displayName && normalized.includes(`@${member.displayName.toLowerCase()}`)).map((member) => member.userId);
    setStatus('Posting comment…');
    void creationSessionsApi.comments.create(sessionId, { body, objectId, mentions }).then(() => {
      setDraft('');
      setStatus('Comment posted');
      void reload();
    }).catch((error) => setStatus(error instanceof Error ? error.message : 'Could not post comment'));
  };

  const resolve = (comment: CreationSessionComment) => {
    void creationSessionsApi.comments.resolve(sessionId, comment.id, !comment.resolvedAt).then(() => void reload())
      .catch((error) => setStatus(error instanceof Error ? error.message : 'Could not update comment'));
  };

  if (persistence === 'local') return <div className={styles.activityEmpty}><strong>Collaboration starts when you save</strong><p>Your canvas remains editable on this device. Sign in to add comments, mentions, shared activity, and collaborators.</p></div>;

  return <div className={styles.activityPanel}>
    <section className={styles.commentComposer}>
      <label>Comment on this object<textarea rows={3} value={draft} disabled={!canComment} onChange={(event) => setDraft(event.target.value)} placeholder={canComment ? 'Write a comment or @mention a collaborator…' : 'View-only access'} /></label>
      <button className={styles.fullButton} disabled={!canComment || !draft.trim()} onClick={submit}>Post comment</button>
    </section>
    {status && <p className={styles.inspectorHint}>{status}</p>}
    <section className={styles.commentList} aria-label="Object comments">
      {comments.map((comment) => <article key={comment.id} className={comment.resolvedAt ? styles.commentResolved : ''}>
        <header><b>{comment.authorName || 'Collaborator'}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></header>
        <p>{comment.body}</p>
        {canComment && <button onClick={() => resolve(comment)}>{comment.resolvedAt ? 'Reopen' : 'Resolve'}</button>}
      </article>)}
    </section>
    <section className={styles.activityList} aria-label="Object activity">
      <h4>Recent activity</h4>
      {activity.filter((item) => item.kind === 'event').map((item) => <div key={item.id}><span>•</span><p><b>{item.actorName || 'BuilderForce'}</b> {item.type.replaceAll('.', ' ')}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
    </section>
  </div>;
}

export function CreationCanvas({ sessionId, persistence = 'server', initialFocusId }: { sessionId: string; persistence?: 'local' | 'server'; initialFocusId?: string | null }) {
  return <ReactFlowProvider><CanvasInner sessionId={sessionId} persistence={persistence} initialFocusId={initialFocusId} /></ReactFlowProvider>;
}
