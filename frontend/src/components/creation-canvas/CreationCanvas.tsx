'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { agileMetricsApi, ceremonySessionsApi, creationSessionsApi, runtimeApi, specsApi, tasksApi, taskSpecsApi, toolsApi, workflowDefinitions, type CreationSessionActivity, type CreationSessionComment, type CreationSessionDetail, type CreationSessionInvitation, type CreationSessionSummary, type CreationSnapshotSummary, type CreationTemplate as ServerCreationTemplate, type CreationTimelineMessage } from '@/lib/builderforceApi';
import { creationGraphFromSnapshot, creationStorageKey, readLocalCreationSession, type LocalCreationSnapshot } from '@/lib/creationSessions';
import { runCreationCanvasAi } from '@/lib/creationCanvasAi';
import type { BrainAction, BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline } from '@seanhogg/builderforce-brain-ui';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { ChatTicketsPanel } from '@/components/brain/ChatTicketsPanel';
import { ProjectEvermindPanel } from '@/components/ide/ProjectEvermindPanel';
import { EvermindValidationProvider } from '@/components/ide/EvermindValidationContext';
import { getProjectEvermindContributions, getProjectEvermindHead, recallProjectEvermind, teachProjectEvermindFromText } from '@/lib/projectEvermindApi';
import { isAwaitingApprovalExecution } from '@/lib/builderforceApi';
import { fetchProjects } from '@/lib/api';
import { computeProjectHealth } from '@/lib/projectHealth';
import { updateAgent } from '@/lib/api';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, createDefaultCreationData, creationObjectDefinition, sanitizeCreationObjectPatch, type CreationObjectGroup } from './creationObjectRegistry';
import { CREATION_TEMPLATES, type CreationTemplate } from './creationTemplates';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { CREATION_CONNECTION_KINDS, type CreationConnectionKind } from '@builderforce/creation-canvas-contract';
import { downloadJson, downloadText, toCsv } from '@/lib/download';
import { exportCsv, exportDocx, exportPptx } from '@/lib/exportApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import { parseCSV } from '@/lib/importHelpers';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';
import { VoiceConfigPanel } from '@/components/ide/VoiceConfigPanel';
import { VoiceOutput } from '@/components/ide/VoiceOutput';
import { useVoiceStudio } from '@/lib/voiceStudio';
import { CopyButton } from '@/components/CopyButton';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildCreationCanvasDiagnosticsReport } from '@/lib/creationCanvasDiagnostics';
import { arrangeCanvasNodes, canvasArrangementTargets, canvasNodeDimensions, type CanvasArrangement } from './creationCanvasLayout';
import { isBrainAutoApprove, setBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useConfirm } from '@/components/ConfirmProvider';
import { useLlmModels } from '@/lib/useLlmModels';
import type { ChatModelSelection } from '@/components/ChatInput';

const DND_MIME = 'application/x-builderforce-creation-object';
const PALETTE_COLLAPSE_STORAGE_KEY = 'builderforce:create:palette-collapsed-groups';
const INSPECTOR_WIDTH_STORAGE_KEY = 'builderforce:create:inspector-width';
const INSPECTOR_DEFAULT_WIDTH = 270;
const INSPECTOR_MIN_WIDTH = 270;
const INSPECTOR_WIDE_WIDTH = 520;
const INSPECTOR_MAX_WIDTH = 720;
const ACCOUNT_REQUIRED_OBJECT_ACTIONS = new Set(['publish', 'deliver', 'assign', 'authenticate', 'execute', 'record', 'generate', 'train', 'start', 'compare']);
const PALETTE_GROUP_ICONS: Record<CreationObjectGroup, string> = {
  Build: '✦', Data: '▦', Knowledge: '▤', Insights: '↗', Work: '✓', People: '●', Agents: '✧', Models: '◉', Collaborate: '◇', Integrations: '⌘',
};
type ProposedCanvasChange =
  | { id: string; type: 'object.add'; label: string; node: CreationFlowNode }
  | { id: string; type: 'object.update'; label: string; objectId: string; patch: Partial<CreationNodeData> }
  | { id: string; type: 'object.delete'; label: string; objectId: string }
  | { id: string; type: 'object.layout'; label: string; objectId: string; position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean; locked?: boolean }
  | { id: string; type: 'object.action'; label: string; objectId: string; action: string }
  | { id: string; type: 'connection.add'; label: string; edge: Edge }
  | { id: string; type: 'connection.update'; label: string; connectionId: string; patch: { label?: string; kind?: CreationConnectionKind } }
  | { id: string; type: 'connection.delete'; label: string; connectionId: string };
type MergeItem = { key: string; source: CreationFlowNode; target: CreationFlowNode | null; choice: 'branch' | 'parent' };
type MergeReview = { parentId: string; parentRevision: number; parentNodes: CreationFlowNode[]; parentEdges: Edge[]; items: MergeItem[] };
type FramePreset = { id: string; name: string; data: CreationNodeData };
type CanvasTimelineMessage = Pick<CreationTimelineMessage, 'clientMessageId' | 'messageRole' | 'body' | 'createdAt'> & { id?: number };
type BrowserSpeechRecognition = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void };
type AccountGate = { title: string; description: string; action: string };

export function shouldAcquireCanvasObjectLock(
  persistence: 'local' | 'server',
  selectedId: string | null,
  canEdit: boolean,
  persistedObjectIds: ReadonlySet<string>,
): boolean {
  return persistence === 'server' && !!selectedId && canEdit && persistedObjectIds.has(selectedId);
}

export async function persistCanonicalProjectPrd(
  node: CreationFlowNode,
  createSpec: typeof specsApi.create = specsApi.create,
): Promise<CreationFlowNode> {
  const projectId = Number(node.data.sourceProjectId);
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('The reviewed PRD has no canonical project');
  const markdown = String(node.data.markdown || node.data.content || '').trim();
  if (!markdown) throw new Error('The reviewed PRD has no authored content');
  const requestedStatus = String(node.data.status || 'draft');
  const status = (['draft', 'ready', 'in_progress', 'complete'].includes(requestedStatus) ? requestedStatus : 'draft') as 'draft' | 'ready' | 'in_progress' | 'complete';
  const saved = await createSpec({ projectId, goal: node.data.title, prd: markdown, status, kind: 'feature' });
  const { canonicalPrdPending: _pending, ...data } = node.data;
  return { ...node, data: { ...data, resourceId: `spec:${saved.id}`, status: saved.status } };
}

function newNode(kind: CreationObjectKind, position: { x: number; y: number }): CreationFlowNode {
  return { id: crypto.randomUUID(), type: 'creation', position, data: createDefaultCreationData(kind) };
}

export function associateBrainWithArtifacts(current: Edge[], brainId: string, artifactIds: Iterable<string>, label = 'Brain context'): Edge[] {
  if (!brainId) return current;
  const next = [...current];
  for (const artifactId of artifactIds) {
    if (!artifactId || artifactId === brainId || next.some((edge) => edge.source === brainId && edge.target === artifactId)) continue;
    next.push({ id: crypto.randomUUID(), source: brainId, target: artifactId, type: 'smoothstep', label, data: { connectionKind: 'reference' } });
  }
  return next;
}

function safeDownloadName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'creation';
}

function artifactMarkdown(data: CreationNodeData): string {
  if (data.kind === 'chat' && Array.isArray(data.messages)) {
    const transcript = data.messages.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const message = value as Record<string, unknown>;
      if (typeof message.content !== 'string' || !message.content.trim()) return [];
      const speaker = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Brain' : 'System';
      return [`## ${speaker}\n\n${message.content}`];
    });
    if (transcript.length) return `# ${data.title}\n\n${transcript.join('\n\n')}`;
  }
  const authored = [data.markdown, data.aiResponse, data.content, data.subtitle].find((value) => typeof value === 'string' && value.trim());
  return typeof authored === 'string' ? authored : `# ${data.title}\n\n${data.status ? `Status: ${data.status}\n` : ''}`;
}

function artifactCsv(data: CreationNodeData): string | null {
  const rawRows = Array.isArray(data.rows) ? data.rows : [];
  const rawColumns = Array.isArray(data.columns) ? data.columns : [];
  const columns = rawColumns.map((column) => typeof column === 'string' ? column : String((column as { name?: unknown; key?: unknown })?.name ?? (column as { key?: unknown })?.key ?? 'Column'));
  if (!columns.length && rawRows[0] && typeof rawRows[0] === 'object' && !Array.isArray(rawRows[0])) columns.push(...Object.keys(rawRows[0] as Record<string, unknown>));
  if (!columns.length) return null;
  const rows = rawRows.map((row) => Array.isArray(row)
    ? row.map((value) => value == null || ['string', 'number'].includes(typeof value) ? value as string | number | null : JSON.stringify(value))
    : columns.map((column) => {
      const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : '';
      return value == null || ['string', 'number'].includes(typeof value) ? value as string | number | null : JSON.stringify(value);
    }));
  return toCsv(columns, rows);
}

const SEED = {
  workflow: '00000000-0000-4000-8000-000000000001', website: '00000000-0000-4000-8000-000000000002',
  dashboard: '00000000-0000-4000-8000-000000000003', chat: '00000000-0000-4000-8000-000000000004',
  sarah: '00000000-0000-4000-8000-000000000005', jordan: '00000000-0000-4000-8000-000000000006',
  agent: '00000000-0000-4000-8000-000000000007', workflowWebsite: '00000000-0000-4000-8000-000000000008',
  websiteDashboard: '00000000-0000-4000-8000-000000000009',
};

const INITIAL_NODES: CreationFlowNode[] = [
  { id: SEED.workflow, type: 'creation', position: { x: 80, y: 55 }, data: { kind: 'workflow', title: 'Fall campaign workflow', status: 'Ready' } },
  { id: SEED.website, type: 'creation', position: { x: 610, y: 45 }, data: { kind: 'website', title: 'Campaign landing page', status: 'Draft' } },
  { id: SEED.dashboard, type: 'creation', position: { x: 1140, y: 55 }, data: { kind: 'dashboard', title: 'Campaign forecast' } },
  { id: SEED.chat, type: 'creation', position: { x: 80, y: 380 }, data: { kind: 'chat', title: 'Brain' } },
  { id: SEED.sarah, type: 'creation', position: { x: 365, y: 455 }, data: { kind: 'staff', title: 'Sarah', role: 'Marketing', focus: 'Defining audience segments and writing email copy.', accent: '#e94b9b' } },
  { id: SEED.jordan, type: 'creation', position: { x: 635, y: 455 }, data: { kind: 'staff', title: 'Jordan', role: 'Design', focus: 'Refining hero section and mobile layout.', accent: '#ff9827' } },
  { id: SEED.agent, type: 'creation', position: { x: 930, y: 455 }, data: { kind: 'agent', title: 'Campaign Strategist', status: 'Draft', model: 'gpt-4o', subtitle: 'Defines strategy, messaging, and audience for high-impact campaigns.' } },
];

const INITIAL_EDGES: Edge[] = [
  { id: SEED.workflowWebsite, source: SEED.workflow, target: SEED.website, label: 'publishes', type: 'smoothstep', data: { connectionKind: 'control' } },
  { id: SEED.websiteDashboard, source: SEED.website, target: SEED.dashboard, label: 'measures', type: 'smoothstep', data: { connectionKind: 'data' } },
];

function flowFromSession(detail: CreationSessionDetail): { nodes: CreationFlowNode[]; edges: Edge[] } {
  return {
    nodes: detail.objects.map((object) => ({
      id: object.id, type: 'creation',
      position: { x: Number(object.canvasData?.x ?? 0), y: Number(object.canvasData?.y ?? 0) },
      draggable: object.content?.placementLocked !== true,
      hidden: object.content?.placementHidden === true,
      ...((Number(object.canvasData?.w) > 0 || Number(object.canvasData?.h) > 0) ? { style: { width: Number(object.canvasData?.w) || undefined, height: Number(object.canvasData?.h) || undefined } } : {}),
      data: {
        kind: object.kind as CreationObjectKind,
        title: object.kind,
        ...(object.resourceType && object.resourceId ? { resourceId: `${object.resourceType}:${object.resourceId}` } : {}),
        ...(object.content ?? {}),
      } as CreationNodeData,
    })),
    edges: detail.connections.map((edge) => ({
      id: edge.id, source: edge.sourceObjectId, target: edge.targetObjectId,
      type: typeof edge.metadata?.rendererType === 'string' ? edge.metadata.rendererType : 'smoothstep', label: edge.label ?? undefined, animated: !!edge.metadata?.animated,
      data: { connectionKind: edge.kind || 'reference' },
    })),
  };
}

function mergeCollaboratorGraph(local: { nodes: CreationFlowNode[]; edges: Edge[] }, remote: { nodes: CreationFlowNode[]; edges: Edge[] }) {
  const nodes = new Map(remote.nodes.map((node) => [node.id, node]));
  local.nodes.forEach((node) => nodes.set(node.id, node));
  const edges = new Map(remote.edges.map((edge) => [edge.id, edge]));
  local.edges.forEach((edge) => edges.set(edge.id, edge));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function flowFromSnapshotGraph(graph: { objects: Array<{ id: string; kind: string; resourceType?: string | null; resourceId?: string | null; canvasData: Record<string, unknown>; content: Record<string, unknown> }>; connections: Array<{ id: string; sourceObjectId: string; targetObjectId: string; kind?: string; label?: string | null; metadata?: Record<string, unknown> }> }) {
  const nodes: CreationFlowNode[] = graph.objects.map((object) => ({
    id: object.id, type: 'creation', position: { x: Number(object.canvasData?.x ?? 0), y: Number(object.canvasData?.y ?? 0) }, draggable: object.content?.placementLocked !== true, hidden: object.content?.placementHidden === true,
    ...((Number(object.canvasData?.w) > 0 || Number(object.canvasData?.h) > 0) ? { style: { width: Number(object.canvasData?.w) || undefined, height: Number(object.canvasData?.h) || undefined } } : {}),
    data: { kind: object.kind as CreationObjectKind, title: object.kind, ...(object.resourceType && object.resourceId ? { resourceId: `${object.resourceType}:${object.resourceId}` } : {}), ...(object.content ?? {}) } as CreationNodeData,
  }));
  const edges: Edge[] = graph.connections.map((edge) => ({ id: edge.id, source: edge.sourceObjectId, target: edge.targetObjectId, type: typeof edge.metadata?.rendererType === 'string' ? edge.metadata.rendererType : 'smoothstep', label: edge.label ?? undefined, animated: !!edge.metadata?.animated, data: { connectionKind: edge.kind || 'reference' } }));
  return { nodes, edges };
}

function CanvasInner({ sessionId, persistence, initialFocusId, initialShareOpen = false, initialPresent = false }: { sessionId: string; persistence: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialPresent?: boolean }) {
  const t = useTranslations('creationCanvas');
  const confirm = useConfirm();
  const storageKey = creationStorageKey(sessionId);
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(persistence === 'local' ? INITIAL_NODES : []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persistence === 'local' ? INITIAL_EDGES : []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scopeMode, setScopeMode] = useState<'auto' | 'canvas' | 'selection' | 'connected' | 'frame'>('auto');
  const [connectionKind, setConnectionKind] = useState<CreationConnectionKind>('reference');
  const [title, setTitle] = useState('Untitled session');
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(initialShareOpen);
  const [accountGate, setAccountGate] = useState<AccountGate | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [collapsedPaletteGroups, setCollapsedPaletteGroups] = useState<Set<CreationObjectGroup>>(new Set());
  const [palettePreferencesReady, setPalettePreferencesReady] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PALETTE_COLLAPSE_STORAGE_KEY) || '[]') as unknown;
      const allowed = new Set(CREATION_PALETTE_GROUPS.map((group) => group.group));
      setCollapsedPaletteGroups(new Set(Array.isArray(saved) ? saved.filter((group): group is CreationObjectGroup => typeof group === 'string' && allowed.has(group as CreationObjectGroup)) : []));
    } catch { setCollapsedPaletteGroups(new Set()); }
    setPalettePreferencesReady(true);
  }, []);
  const [presentMode, setPresentMode] = useState(initialPresent);
  const [drawingMode, setDrawingMode] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [branchParentId, setBranchParentId] = useState<string | null>(null);
  const [mergeReview, setMergeReview] = useState<MergeReview | null>(null);
  const [workflowFocus, setWorkflowFocus] = useState<{ nodeId: string; definitionId: string | null } | null>(null);
  const [framePresets, setFramePresets] = useState<FramePreset[]>([]);
  const [serverTemplates, setServerTemplates] = useState<ServerCreationTemplate[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CreationSessionSummary['role']>('editor');
  const [prompt, setPrompt] = useState('');
  const [thinking, setThinking] = useState(false);
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({ mode: 'auto' });
  const llmModels = useLlmModels();
  const canvasModelChoices = useMemo(() => [
    ...llmModels.tenantModels.map((model) => ({ id: model.ref, label: `${model.name} — configured` })),
    ...llmModels.fundingSurface.byo.models.map((model) => ({ id: model.id, label: `${model.id} — BYO ${model.vendor}` })),
    ...llmModels.models.map((id) => ({ id, label: `${id} — plan` })),
    ...llmModels.premiumModels.map((model) => ({ id: model.id, label: `${model.id} — paid` })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index), [llmModels]);
  const [tourStep, setTourStep] = useState(0);
  const [notice, setNotice] = useState('Session saved');
  const [loadingSession, setLoadingSession] = useState(persistence === 'server');
  const [realtimeState, setRealtimeState] = useState<'local' | 'connecting' | 'online' | 'reconnecting' | 'offline'>(persistence === 'local' ? 'local' : 'connecting');
  const [members, setMembers] = useState<CreationSessionDetail['members']>([]);
  const [allMembers, setAllMembers] = useState<CreationSessionDetail['members']>([]);
  const [pendingInvitations, setPendingInvitations] = useState<CreationSessionInvitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<CreationSnapshotSummary[]>([]);
  const [timeline, setTimeline] = useState<CanvasTimelineMessage[]>([]);
  const [brainTrace, setBrainTrace] = useState<BrainTraceEvent[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [proposedChanges, setProposedChanges] = useState<ProposedCanvasChange[]>([]);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<Set<string>>(new Set());
  const [autoApply, setAutoApply] = useState(false);
  const [autoApplyPending, setAutoApplyPending] = useState(false);
  const [pendingBrainActions, setPendingBrainActions] = useState<Array<{ objectId: string; action: string }>>([]);
  const [sessionRole, setSessionRole] = useState<CreationSessionSummary['role']>('owner');
  const [lockBlocked, setLockBlocked] = useState(false);
  // Locks are server records. A freshly added Canvas node exists in React state
  // before the debounced graph save creates its database row, so attempting to
  // lock it immediately produces a misleading 404. Track confirmed server IDs
  // and start the lease only after persistence succeeds.
  const [persistedObjectIds, setPersistedObjectIds] = useState<Set<string>>(new Set());
  const [datasetRowLimit, setDatasetRowLimit] = useState(500);
  const canEdit = persistence === 'local' || sessionRole === 'editor' || sessionRole === 'runner' || sessionRole === 'owner';
  const canRun = persistence === 'local' || sessionRole === 'runner' || sessionRole === 'owner';
  const requireAccount = useCallback((action: string, title: string, description: string) => {
    setAccountGate({ action, title, description });
    trackActivity('creation_account_gate_shown', { sessionId, metadata: { clientSurface: 'web', action } });
  }, [sessionId]);
  useEffect(() => {
    if (!palettePreferencesReady) return;
    try { localStorage.setItem(PALETTE_COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedPaletteGroups])); } catch { /* storage can be unavailable in hardened contexts */ }
  }, [collapsedPaletteGroups, palettePreferencesReady]);
  const flowRef = useRef<ReactFlowInstance<CreationFlowNode, Edge> | null>(null);
  const hydrated = useRef(false);
  const revision = useRef(1);
  const lastSavedGraph = useRef('');
  const currentGraph = useRef('');
  const saveInFlight = useRef(false);
  const pendingSave = useRef<{ serialized: string; key: string } | null>(null);
  const viewportRef = useRef({ x: 0, y: 0, zoom: 1 });
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const pendingViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const flowWrapRef = useRef<HTMLDivElement | null>(null);
  const paletteSearchRef = useRef<HTMLInputElement | null>(null);
  const proposalBuffer = useRef<ProposedCanvasChange[]>([]);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const historyBaseline = useRef<string | null>(null);
  const historyApplying = useRef(false);
  const drawingPoints = useRef<Array<{ x: number; y: number }>>([]);
  const canvasClipboard = useRef<{ nodes: CreationFlowNode[]; edges: Edge[] } | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const initialPromptSubmitted = useRef(false);
  const autoApplyRef = useRef(false);

  useEffect(() => {
    const enabled = isBrainAutoApprove();
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
  }, []);

  const setAutoApplyMode = useCallback((enabled: boolean) => {
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
    setBrainAutoApprove(enabled);
  }, []);

  const memoryStorageKey = useMemo(() => {
    const chat = nodes.find((node) => node.data.kind === 'chat');
    const canonicalId = chat?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
    return `brain.memoryEnabled:${canonicalId || `canvas:${sessionId}`}`;
  }, [nodes, sessionId]);

  useEffect(() => {
    try { setMemoryEnabled(localStorage.getItem(memoryStorageKey) !== '0'); } catch { setMemoryEnabled(true); }
  }, [memoryStorageKey]);

  const setMemoryMode = useCallback((enabled: boolean) => {
    setMemoryEnabled(enabled);
    try { localStorage.setItem(memoryStorageKey, enabled ? '1' : '0'); } catch { /* storage may be unavailable */ }
  }, [memoryStorageKey]);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    // The palette starts open on wide screens. Focusing its search field makes
    // every Add affordance useful even when opening it is otherwise a no-op.
    window.requestAnimationFrame(() => paletteSearchRef.current?.focus());
  }, []);

  const tourStorageKey = `builderforce:create-tour-complete:${currentUserId || (persistence === 'local' ? 'guest' : 'pending')}`;

  useEffect(() => {
    if (persistence === 'server' && !currentUserId) return;
    if (localStorage.getItem(tourStorageKey) !== '1') setTourStep(1);
    try { setFramePresets(JSON.parse(localStorage.getItem('builderforce:create-frame-presets') || '[]') as FramePreset[]); } catch { setFramePresets([]); }
  }, [currentUserId, persistence, tourStorageKey]);

  useEffect(() => {
    if (persistence !== 'server') return;
    void creationSessionsApi.quotas().then((quota) => {
      if (quota.limits.datasetRows === -1) setDatasetRowLimit(1_000_000);
      else setDatasetRowLimit(Math.max(1, quota.limits.datasetRows));
    }).catch(() => undefined);
  }, [persistence]);

  useEffect(() => {
    if (!templateOpen || persistence !== 'server') return;
    void creationSessionsApi.templates.list().then((result) => setServerTemplates(result.templates)).catch(() => setServerTemplates([]));
  }, [persistence, templateOpen]);

  useEffect(() => {
    if (!shareOpen || persistence !== 'server' || sessionRole !== 'owner') return;
    void creationSessionsApi.invitations.list(sessionId)
      .then((result) => setPendingInvitations(result.invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)))
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Invitations could not be loaded'));
  }, [persistence, sessionId, sessionRole, shareOpen]);

  useEffect(() => {
    try {
      if (persistence === 'local') {
        const saved = readLocalCreationSession(sessionId);
        if (saved) {
          setTitle(saved.title);
          setNodes(saved.nodes);
          setEdges(saved.edges);
          setTimeline((saved.timeline ?? []).map((message) => ({ clientMessageId: message.clientMessageId, messageRole: message.role, body: message.body, createdAt: message.createdAt })));
          if (saved.viewport) { viewportRef.current = saved.viewport; pendingViewport.current = saved.viewport; void flowRef.current?.setViewport(saved.viewport); }
        }
        hydrated.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: 'web', persistence: 'local' } });
        return;
      }
      void Promise.all([creationSessionsApi.get(sessionId), creationSessionsApi.timeline.list(sessionId)]).then(([detail, transcript]) => {
        const { nodes: loadedNodes, edges: loadedEdges } = flowFromSession(detail);
        setTitle(detail.session.title);
        setBranchParentId(detail.session.branchParentSessionId ?? null);
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        setPersistedObjectIds(new Set(loadedNodes.map((node) => node.id)));
        setMembers(detail.members);
        setAllMembers(detail.members);
        setCurrentUserId(detail.currentUserId || null);
        const personalSelection = detail.members.find((member) => member.userId === detail.currentUserId)?.selection?.filter((id) => loadedNodes.some((node) => node.id === id)) ?? [];
        setSelectedIds(personalSelection);
        setSelectedId(personalSelection.length === 1 ? personalSelection[0] : null);
        setSessionRole(detail.role);
        setTimeline(transcript.messages);
        const restoredViewport = detail.personalViewport && typeof detail.personalViewport.x === 'number' && typeof detail.personalViewport.y === 'number' && typeof detail.personalViewport.zoom === 'number'
          ? { x: detail.personalViewport.x, y: detail.personalViewport.y, zoom: detail.personalViewport.zoom }
          : null;
        if (restoredViewport) {
          viewportRef.current = restoredViewport;
          pendingViewport.current = restoredViewport;
          void flowRef.current?.setViewport(restoredViewport);
        }
        revision.current = detail.session.canvasRevision ?? detail.session.revision ?? 1;
        lastSavedGraph.current = JSON.stringify({ nodes: loadedNodes, edges: loadedEdges });
        currentGraph.current = lastSavedGraph.current;
        hydrated.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: 'web', objectKinds: [...new Set(loadedNodes.map((node) => node.data.kind))] } });
        setNotice('Session saved');
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load session')).finally(() => setLoadingSession(false));
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
        const snapshot: LocalCreationSnapshot = { version: 1, title, initialPrompt: prior?.initialPrompt, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, createdAt: message.createdAt })), nodes, edges, viewport: viewportRef.current, updatedAt: new Date().toISOString() };
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
        lastSavedGraph.current = serialized;
        setNotice('Saved on this device');
        return;
      }
      setNotice('Saving changes…');
      saveInFlight.current = true;
      const graph = creationGraphFromSnapshot({ nodes, edges });
      if (!pendingSave.current || pendingSave.current.serialized !== serialized) pendingSave.current = { serialized, key: crypto.randomUUID() };
      const saveAttempt = pendingSave.current;
      void creationSessionsApi.applyCommands(sessionId, revision.current, saveAttempt.key, [{ type: 'graph.replace', ...graph, viewport: viewportRef.current }]).then((saved) => {
        revision.current = saved.revision;
        lastSavedGraph.current = serialized;
        setPersistedObjectIds(new Set(graph.objects.map((object) => object.id)));
        if (pendingSave.current?.key === saveAttempt.key) pendingSave.current = null;
        setNotice('Session saved');
      }).catch(async (error) => {
        if (error instanceof Error && error.message === 'Session changed') {
          try {
            const detail = await creationSessionsApi.get(sessionId);
            const remote = flowFromSession(detail);
            const merged = mergeCollaboratorGraph({ nodes, edges }, remote);
            revision.current = detail.session.canvasRevision ?? detail.session.revision ?? revision.current;
            lastSavedGraph.current = JSON.stringify(remote);
            setNodes(merged.nodes);
            setEdges(merged.edges);
            setPersistedObjectIds(new Set(remote.nodes.map((node) => node.id)));
            pendingSave.current = null;
            setNotice('Concurrent changes merged; saving again…');
            return;
          } catch { /* Fall through to the original conflict message. */ }
        }
        setNotice(error instanceof Error ? error.message : 'Save failed');
      })
        .finally(() => { saveInFlight.current = false; });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [canEdit, edges, nodes, persistence, sessionId, storageKey, title]);

  useEffect(() => {
    if (persistence !== 'local' || !hydrated.current) return;
    const handle = window.setTimeout(() => {
      const prior = readLocalCreationSession(sessionId); if (!prior) return;
      const snapshot: LocalCreationSnapshot = { ...prior, title, nodes, edges, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, createdAt: message.createdAt })), viewport: viewportRef.current, updatedAt: new Date().toISOString() };
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [edges, nodes, persistence, sessionId, storageKey, timeline, title]);

  useEffect(() => {
    if (persistence !== 'server') return;
    let stopped = false;
    const reconcile = async () => {
      try {
        const presence = await creationSessionsApi.presence(sessionId, { revision: revision.current, viewport: viewportRef.current, cursor: cursorRef.current, selection: selectedIds, typing: thinking, followingUserId });
        if (stopped) return;
        setMembers(presence.members);
        const followed = presence.members.find((member) => member.userId === followingUserId && member.viewport && typeof member.viewport.x === 'number' && typeof member.viewport.y === 'number' && typeof member.viewport.zoom === 'number');
        if (followed?.viewport) void flowRef.current?.setViewport({ x: Number(followed.viewport.x), y: Number(followed.viewport.y), zoom: Number(followed.viewport.zoom) }, { duration: 350 });
        if (presence.currentUserId) setCurrentUserId(presence.currentUserId);
        if (presence.revision <= revision.current || saveInFlight.current || currentGraph.current !== lastSavedGraph.current) return;
        const detail = await creationSessionsApi.get(sessionId);
        if (stopped) return;
        const remoteRevision = detail.session.canvasRevision ?? detail.session.revision ?? 1;
        if (remoteRevision <= revision.current) return;
        const remote = flowFromSession(detail);
        setNodes(remote.nodes);
        setEdges(remote.edges);
        setPersistedObjectIds(new Set(remote.nodes.map((node) => node.id)));
        setTitle(detail.session.title);
        setAllMembers(detail.members);
        revision.current = remoteRevision;
        lastSavedGraph.current = JSON.stringify(remote);
        currentGraph.current = lastSavedGraph.current;
        setNotice('Updated by a collaborator');
      } catch { /* Presence and polling are best-effort; local edits continue. */ }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 8_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [followingUserId, persistence, selectedIds, sessionId, setEdges, setNodes, thinking]);

  useEffect(() => {
    if (persistence !== 'server') return;
    const liveUrl = creationSessionsApi.liveUrl(sessionId);
    if (!liveUrl) { setRealtimeState('offline'); return; }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryMs = 1_000;
    const syncRevision = async (hint?: number) => {
      if (stopped || saveInFlight.current || currentGraph.current !== lastSavedGraph.current) return;
      try {
        const caughtUp = await creationSessionsApi.events(sessionId, revision.current);
        const remoteRevision = Math.max(Number(hint || 0), Number(caughtUp.revision || 0));
        if (remoteRevision <= revision.current) return;
        const detail = await creationSessionsApi.get(sessionId);
        if (stopped) return;
        const remote = flowFromSession(detail);
        setNodes(remote.nodes);
        setEdges(remote.edges);
        setPersistedObjectIds(new Set(remote.nodes.map((node) => node.id)));
        setTitle(detail.session.title);
        setAllMembers(detail.members);
        revision.current = detail.session.canvasRevision ?? detail.session.revision ?? remoteRevision;
        lastSavedGraph.current = JSON.stringify(remote);
        currentGraph.current = lastSavedGraph.current;
        setNotice('Updated live by a collaborator');
      } catch { /* The presence reconciliation remains a durable fallback. */ }
    };
    const connect = () => {
      if (stopped) return;
      setRealtimeState(retryMs > 1_000 ? 'reconnecting' : 'connecting');
      try { socket = new WebSocket(liveUrl); } catch { socket = null; }
      if (!socket) {
        setRealtimeState('reconnecting');
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(15_000, retryMs * 2);
        return;
      }
      socket.onopen = () => { setRealtimeState('online'); retryMs = 1_000; void syncRevision(); };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as { type?: string; revision?: number; lastId?: number };
          if (frame.type === 'canvas.changed') void syncRevision(frame.revision);
          if (frame.type === 'timeline.changed') void creationSessionsApi.timeline.list(sessionId).then((result) => setTimeline(result.messages)).catch(() => undefined);
        } catch { /* Ignore malformed relay frames. */ }
      };
      socket.onclose = () => {
        socket = null;
        if (!stopped) {
          setRealtimeState(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'reconnecting');
          retryTimer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(15_000, retryMs * 2);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [persistence, sessionId, setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const effectiveSelectedIds = useMemo(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);
  const resolvedScopeMode = scopeMode === 'auto'
    ? selectedNode?.data.kind === 'frame' ? 'frame' : effectiveSelectedIds.length ? 'selection' : 'canvas'
    : scopeMode;
  const scopedNodeIds = useMemo(() => {
    if (resolvedScopeMode === 'canvas') return new Set(nodes.map((node) => node.id));
    const selected = new Set(effectiveSelectedIds);
    if (resolvedScopeMode === 'connected') {
      edges.forEach((edge) => {
        if (selected.has(edge.source)) selected.add(edge.target);
        if (selected.has(edge.target)) selected.add(edge.source);
      });
    }
    if (resolvedScopeMode === 'frame' && selectedNode?.data.kind === 'frame') {
      const { width, height } = canvasNodeDimensions(selectedNode);
      nodes.forEach((node) => {
        if (node.id !== selectedNode.id && node.position.x >= selectedNode.position.x && node.position.y >= selectedNode.position.y && node.position.x <= selectedNode.position.x + width && node.position.y <= selectedNode.position.y + height) selected.add(node.id);
      });
    }
    return selected;
  }, [edges, effectiveSelectedIds, nodes, resolvedScopeMode, selectedNode]);
  const scopeLabel = resolvedScopeMode === 'canvas' ? t('entireCanvas')
    : resolvedScopeMode === 'connected' ? `Connected objects (${scopedNodeIds.size})`
      : resolvedScopeMode === 'frame' ? `Current frame: ${selectedNode?.data.title || 'Frame'}`
        : effectiveSelectedIds.length > 1 ? `${effectiveSelectedIds.length} selected objects`
          : selectedNode ? `Selected: ${selectedNode.data.title}` : t('entireCanvas');
  const scopedNodes = useMemo(() => nodes.filter((node) => scopedNodeIds.has(node.id)), [nodes, scopedNodeIds]);
  const scopedEdges = useMemo(() => edges.filter((edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target)), [edges, scopedNodeIds]);
  const evermindProjectId = useMemo(() => {
    const candidates = [...scopedNodes, ...nodes.filter((node) => !scopedNodeIds.has(node.id))];
    for (const node of candidates) {
      if (node.data.kind === 'project') {
        const canonical = node.data.resourceId?.match(/^project:(\d+)$/)?.[1];
        const numeric = canonical ? Number(canonical) : Number(node.data.projectId);
        if (Number.isInteger(numeric) && numeric > 0) return numeric;
      }
      const source = Number(node.data.sourceProjectId);
      if (Number.isInteger(source) && source > 0) return source;
    }
    return null;
  }, [nodes, scopedNodeIds, scopedNodes]);

  const updateSelected = useCallback((patch: Partial<CreationNodeData>) => {
    if (!selectedId || !canEdit || lockBlocked) return;
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node));
    setNotice('Saving changes…');
  }, [canEdit, lockBlocked, selectedId, setNodes]);

  const updateWebsiteViewport = useCallback((viewport: 'desktop' | 'tablet' | 'mobile') => {
    if (!selectedId || !canEdit || lockBlocked) return;
    const preset = viewport === 'mobile' ? { width: 340, height: 620 } : viewport === 'tablet' ? { width: 520, height: 560 } : { width: 720, height: 460 };
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, style: { ...node.style, ...preset }, data: { ...node.data, viewport } } : node));
    setNotice(`Website viewport changed to ${viewport}`);
  }, [canEdit, lockBlocked, selectedId, setNodes]);

  const appendTimeline = useCallback((role: 'user' | 'assistant' | 'system', body: string, metadata?: { scope?: string; objectIds?: string[]; model?: string; error?: boolean }, clientMessageId = crypto.randomUUID()) => {
    const message: CanvasTimelineMessage = { clientMessageId, messageRole: role, body, createdAt: new Date().toISOString() };
    setTimeline((current) => current.some((item) => item.clientMessageId === clientMessageId) ? current : [...current, message]);
    if (persistence === 'server') void creationSessionsApi.timeline.append(sessionId, { clientMessageId, role, body, metadata }).then((saved) => {
      setTimeline((current) => current.map((item) => item.clientMessageId === clientMessageId ? saved : item));
    }).catch((error) => setNotice(error instanceof Error ? `Conversation save failed: ${error.message}` : 'Conversation save failed'));
    return clientMessageId;
  }, [persistence, sessionId]);

  const startVoiceInput = useCallback(() => {
    const browserWindow = window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) { setNotice('Voice input is not supported by this browser'); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US'; recognition.interimResults = false;
    setNotice('Listening…');
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript?.trim(); if (transcript) setPrompt((current) => current ? `${current} ${transcript}` : transcript); };
    recognition.onerror = () => setNotice('Voice input could not be captured');
    recognition.onend = () => setNotice('Voice input ready');
    recognition.start();
  }, []);

  useEffect(() => {
    const messages = timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt }));
    setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, messages, ...(brainTrace.length ? { trace: brainTrace } : {}), aiResponse: [...timeline].reverse().find((message) => message.messageRole === 'assistant')?.body || node.data.aiResponse } } : node));
  }, [brainTrace, setNodes, timeline]);

  useEffect(() => {
    if (!shouldAcquireCanvasObjectLock(persistence, selectedId, canEdit, persistedObjectIds)) { setLockBlocked(false); return; }
    const lockedObjectId = selectedId!;
    let stopped = false;
    const acquire = async (action: 'acquire' | 'renew') => {
      try {
        await creationSessionsApi.lock(sessionId, lockedObjectId, action);
        if (!stopped) setLockBlocked(false);
      } catch (error) {
        if (!stopped) { setLockBlocked(true); setNotice(error instanceof Error ? error.message : 'This object is being edited by another collaborator'); }
      }
    };
    void acquire('acquire');
    const timer = window.setInterval(() => void acquire('renew'), 45_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void creationSessionsApi.lock(sessionId, lockedObjectId, 'release').catch(() => undefined);
    };
  }, [canEdit, persistedObjectIds, persistence, selectedId, sessionId]);

  const importDataset = useCallback(async (file: File) => {
    if (!selectedId) return;
    try {
      const text = await file.text();
      const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
      const allLines = text.split(/\r?\n/).filter((line) => line.trim());
      const parsed = delimiter === ',' ? parseCSV(text) : {
        headers: (allLines[0] ?? '').split('\t').map((value) => value.trim()),
        rows: allLines.slice(1).map((line) => Object.fromEntries((allLines[0] ?? '').split('\t').map((column, index) => [column.trim(), line.split('\t')[index]?.trim() ?? '']))),
      };
      if (parsed.rows.length > datasetRowLimit) throw new Error(`This plan supports up to ${datasetRowLimit.toLocaleString()} dataset rows per Canvas import.`);
      const columns = parsed.headers.filter(Boolean).slice(0, 24);
      if (!columns.length) throw new Error('No columns found');
      const rows = parsed.rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])));
      setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, title: file.name, columns, rows, sampleRows: rows.slice(0, 25), rowCount: rows.length, status: 'Imported', subtitle: `${rows.length} preview rows loaded` } } : node));
      setNotice(`${file.name} imported`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Dataset import failed');
    }
  }, [datasetRowLimit, selectedId, setNodes]);

  useEffect(() => {
    if (!hydrated.current || historyApplying.current) return;
    const next = JSON.stringify({ nodes, edges });
    const handle = window.setTimeout(() => {
      if (historyBaseline.current == null) historyBaseline.current = next;
      else if (historyBaseline.current !== next) {
        undoStack.current = [...undoStack.current.slice(-49), historyBaseline.current];
        historyBaseline.current = next;
        redoStack.current = [];
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [edges, nodes]);

  const restoreGraphState = useCallback((serialized: string) => {
    const graph = JSON.parse(serialized) as { nodes: CreationFlowNode[]; edges: Edge[] };
    historyApplying.current = true;
    historyBaseline.current = serialized;
    setNodes(graph.nodes); setEdges(graph.edges);
    window.setTimeout(() => { historyApplying.current = false; }, 0);
  }, [setEdges, setNodes]);

  const undo = useCallback(() => {
    const prior = undoStack.current.pop(); if (!prior) { setNotice('Nothing to undo'); return; }
    redoStack.current.push(JSON.stringify({ nodes, edges })); restoreGraphState(prior); setNotice('Canvas change undone');
  }, [edges, nodes, restoreGraphState]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop(); if (!next) { setNotice('Nothing to redo'); return; }
    undoStack.current.push(JSON.stringify({ nodes, edges })); restoreGraphState(next); setNotice('Canvas change redone');
  }, [edges, nodes, restoreGraphState]);

  const selectionIds = useCallback(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);
  const duplicateSelection = useCallback(() => {
    if (!canEdit) return;
    const ids = new Set(selectionIds());
    if (!ids.size) { setNotice('Select one or more objects to duplicate'); return; }
    const idMap = new Map<string, string>();
    const copies = nodes.filter((node) => ids.has(node.id)).map((node) => {
      const id = crypto.randomUUID(); idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 36, y: node.position.y + 36 }, selected: true, data: { ...node.data, title: `${node.data.title} copy`, resourceId: undefined } };
    });
    const copiedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current, ...copiedEdges]);
    const nextIds = copies.map((node) => node.id); setSelectedIds(nextIds); setSelectedId(nextIds.length === 1 ? nextIds[0] : null);
    setNotice(`${copies.length} object${copies.length === 1 ? '' : 's'} duplicated`);
  }, [canEdit, edges, nodes, selectionIds, setEdges, setNodes]);

  const copySelection = useCallback(() => {
    const ids = new Set(selectionIds());
    if (!ids.size) { setNotice('Select one or more objects to copy'); return; }
    canvasClipboard.current = {
      nodes: nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node, data: { ...node.data } })),
      edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ ...edge })),
    };
    setNotice(`${ids.size} object${ids.size === 1 ? '' : 's'} copied`);
  }, [edges, nodes, selectionIds]);

  const pasteSelection = useCallback(() => {
    if (!canEdit || !canvasClipboard.current) return;
    const idMap = new Map<string, string>();
    const pasted = canvasClipboard.current.nodes.map((node) => {
      const id = crypto.randomUUID(); idMap.set(node.id, id);
      return { ...node, id, position: { x: node.position.x + 48, y: node.position.y + 48 }, selected: true, data: { ...node.data, resourceId: undefined } };
    });
    const pastedEdges = canvasClipboard.current.edges.map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pasted]); setEdges((current) => [...current, ...pastedEdges]);
    const ids = pasted.map((node) => node.id); setSelectedIds(ids); setSelectedId(ids.length === 1 ? ids[0] : null); setNotice(`${ids.length} object${ids.length === 1 ? '' : 's'} pasted`);
  }, [canEdit, setEdges, setNodes]);

  const alignSelection = useCallback(() => {
    const ids = new Set(selectionIds());
    if (!canEdit || ids.size < 2) { setNotice('Select at least two objects to align'); return; }
    const left = Math.min(...nodes.filter((node) => ids.has(node.id)).map((node) => node.position.x));
    setNodes((current) => current.map((node) => ids.has(node.id) && node.data.placementLocked !== true ? { ...node, position: { ...node.position, x: left } } : node));
    setNotice(`${ids.size} objects aligned left`);
  }, [canEdit, nodes, selectionIds, setNodes]);

  const frameSelection = useCallback(() => {
    const ids = new Set(selectionIds());
    const chosen = nodes.filter((node) => ids.has(node.id));
    if (!canEdit || chosen.length < 2) { setNotice('Select at least two objects to create a frame'); return; }
    const left = Math.min(...chosen.map((node) => node.position.x)) - 40;
    const top = Math.min(...chosen.map((node) => node.position.y)) - 70;
    const right = Math.max(...chosen.map((node) => node.position.x + canvasNodeDimensions(node).width)) + 40;
    const bottom = Math.max(...chosen.map((node) => node.position.y + canvasNodeDimensions(node).height)) + 40;
    const frame = newNode('frame', { x: left, y: top }); frame.style = { width: right - left, height: bottom - top }; frame.zIndex = -1;
    frame.data = { ...frame.data, title: 'Grouped objects', framePurpose: 'Organize this related work' };
    setNodes((current) => [frame, ...current.map((node) => ({ ...node, selected: false }))]); setSelectedIds([frame.id]); setSelectedId(frame.id); setScopeMode('frame'); setNotice(`${chosen.length} objects framed`);
  }, [canEdit, nodes, selectionIds, setNodes]);

  const togglePlacementLock = useCallback(() => {
    const ids = new Set(selectionIds()); if (!canEdit || !ids.size) return;
    const shouldLock = nodes.some((node) => ids.has(node.id) && node.data.placementLocked !== true);
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, draggable: !shouldLock, data: { ...node.data, placementLocked: shouldLock } } : node));
    setNotice(shouldLock ? 'Object placement locked' : 'Object placement unlocked');
  }, [canEdit, nodes, selectionIds, setNodes]);

  const toggleHidden = useCallback(() => {
    const ids = new Set(selectionIds()); if (!canEdit || !ids.size) return;
    const shouldHide = nodes.some((node) => ids.has(node.id) && node.data.placementHidden !== true);
    setNodes((current) => current.map((node) => ids.has(node.id) ? { ...node, hidden: shouldHide, data: { ...node.data, placementHidden: shouldHide } } : node));
    if (shouldHide) { setSelectedId(null); setSelectedIds([]); }
    setNotice(shouldHide ? 'Objects hidden from the canvas' : 'Objects shown on the canvas');
  }, [canEdit, nodes, selectionIds, setNodes]);

  const focusSelection = useCallback(() => {
    const ids = selectionIds(); if (!ids.length) return;
    void flowRef.current?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.28, duration: 350 });
  }, [selectionIds]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      const ids = new Set(selectionIds());
      if ((event.key === 'Delete' || event.key === 'Backspace') && ids.size && canEdit) {
        event.preventDefault(); setNodes((current) => current.filter((node) => !ids.has(node.id))); setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target))); setSelectedId(null); setSelectedIds([]);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return; }
      if (event.key === 'Escape') { setSelectedId(null); setSelectedIds([]); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); return; }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && ids.size && canEdit) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1; const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0; const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        setNodes((current) => current.map((node) => ids.has(node.id) && node.data.placementLocked !== true ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node));
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [canEdit, copySelection, duplicateSelection, pasteSelection, redo, selectionIds, setEdges, setNodes, undo]);

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
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep', data: { connectionKind }, label: connectionKind, markerEnd: { type: MarkerType.ArrowClosed } }, current));
    trackActivity('creation_connection_added', { sessionId, metadata: { clientSurface: 'web', connectionKind } });
  }, [connectionKind, sessionId, setEdges]);

  const onNodeClick: NodeMouseHandler<CreationFlowNode> = useCallback((_event, node) => { setSelectedId(node.id); if (!node.selected) setSelectedIds([node.id]); }, []);
  // XYFlow subscribes to this callback through its Zustand store. An inline
  // callback is a new subscription every render; immediately writing a fresh
  // `[]` back to React from that subscription can create an update-depth loop
  // on a newly hydrated local Session. Keep the subscriber stable and preserve
  // state identity when the semantic selection did not change.
  const onSelectionChange = useCallback(({ nodes: chosen }: { nodes: CreationFlowNode[] }) => {
    const ids = chosen.map((node) => node.id);
    setSelectedIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
    const nextId = ids.length === 1 ? ids[0]! : null;
    setSelectedId((current) => current === nextId ? current : nextId);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedId((current) => current == null ? current : null);
    setSelectedIds((current) => current.length ? [] : current);
  }, []);
  const onCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!flowRef.current) return;
    const point = flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (persistence === 'server') cursorRef.current = point;
    if (drawingMode && drawingPoints.current.length) drawingPoints.current.push(point);
  }, [drawingMode, persistence]);
  const onCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingMode || !canEdit || !flowRef.current || !(event.target as HTMLElement).classList.contains('react-flow__pane')) return;
    drawingPoints.current = [flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })];
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [canEdit, drawingMode]);
  const onCanvasPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingMode || drawingPoints.current.length < 2) return;
    const points = drawingPoints.current.splice(0);
    const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
    const minX = Math.min(...xs); const minY = Math.min(...ys); const width = Math.max(40, Math.max(...xs) - minX); const height = Math.max(40, Math.max(...ys) - minY);
    const node = newNode('drawing', { x: minX - 8, y: minY - 8 });
    node.style = { width: width + 16, height: height + 58 };
    node.data = { ...node.data, title: 'Canvas sketch', points: points.map((point) => ({ x: point.x - minX + 8, y: point.y - minY + 8 })), drawingWidth: width + 16, drawingHeight: height + 16, stroke: '#5b5ce2', strokeWidth: 3 };
    setNodes((current) => [...current, node]); setSelectedId(node.id); setDrawingMode(false); setNotice('Sketch added');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, [drawingMode, setNodes]);
  const onViewportChange = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    viewportRef.current = viewport;
    if (persistence !== 'local' || !hydrated.current) return;
    const prior = readLocalCreationSession(sessionId);
    const snapshot: LocalCreationSnapshot = { version: 1, title, initialPrompt: prior?.initialPrompt, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, createdAt: message.createdAt })), nodes, edges, viewport, updatedAt: new Date().toISOString() };
    localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, [edges, nodes, persistence, sessionId, storageKey, timeline, title]);

  const addAtCenter = useCallback((kind: CreationObjectKind) => {
    if (!canEdit) { setNotice('Your session role does not allow editing'); return; }
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const node = newNode(kind, position);
    if (kind === 'chat') node.data = { ...node.data, messages: timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt })) };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id); setSelectedIds([node.id]);
    setNotice(`${node.data.title} added`);
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: 'web', objectKinds: [kind] } });
  }, [canEdit, sessionId, setNodes, timeline]);

  const applyTemplate = useCallback((template: CreationTemplate) => {
    if (!canEdit) return;
    const center = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 260 };
    const created = template.objects.map((item) => { const node = newNode(item.kind, { x: center.x + item.x - 520, y: center.y + item.y - 180 }); if (item.title) node.data = { ...node.data, title: item.title }; return node; });
    const createdEdges = (template.connections ?? []).map((edge) => ({ id: crypto.randomUUID(), source: created[edge.source].id, target: created[edge.target].id, type: 'smoothstep', label: edge.label }));
    setNodes((current) => [...current, ...created]); setEdges((current) => [...current, ...createdEdges]); setTemplateOpen(false); setNotice(`${template.name} added from Marketplace`);
    trackActivity('creation_object_pack_added', { sessionId, metadata: { clientSurface: 'web', templateId: template.id, objectKinds: template.objects.map((item) => item.kind) } });
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: created.map(({ id }) => ({ id })), padding: .2, duration: 400 }), 0);
  }, [canEdit, sessionId, setEdges, setNodes]);

  const addFramePreset = useCallback((preset: FramePreset) => {
    if (!canEdit) return;
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 260 };
    const node = newNode('frame', position); node.data = { ...preset.data, title: preset.name };
    setNodes((current) => [...current, node]); setSelectedId(node.id); setTemplateOpen(false); setNotice(`${preset.name} frame added`);
  }, [canEdit, setNodes]);

  const saveFramePreset = useCallback(() => {
    if (selectedNode?.data.kind !== 'frame') return;
    const preset: FramePreset = { id: crypto.randomUUID(), name: selectedNode.data.title, data: { ...selectedNode.data } };
    if (persistence === 'server') {
      const graph = creationGraphFromSnapshot({ nodes: [{ ...selectedNode, id: crypto.randomUUID(), position: { x: 80, y: 80 } }], edges: [] });
      void creationSessionsApi.templates.create({ name: preset.name, description: 'Reusable Canvas frame', category: 'Frame', visibility: 'private', graph }).then(() => {
        setNotice('Reusable frame saved to your account template library');
        return creationSessionsApi.templates.list();
      }).then((result) => setServerTemplates(result.templates)).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not save template'));
      return;
    }
    setFramePresets((current) => { const next = [...current.filter((item) => item.name !== preset.name), preset].slice(-20); localStorage.setItem('builderforce:create-frame-presets', JSON.stringify(next)); return next; });
    setNotice('Reusable frame saved to your template library');
  }, [persistence, selectedNode]);

  const applyServerTemplate = useCallback((template: ServerCreationTemplate) => {
    if (persistence !== 'server' || !canEdit) return;
    setNotice(`Adding ${template.name}…`);
    void creationSessionsApi.templates.apply(sessionId, template.id, revision.current).then(async (result) => {
      revision.current = result.revision;
      const detail = await creationSessionsApi.get(sessionId);
      const flow = flowFromSession(detail);
      setNodes(flow.nodes); setEdges(flow.edges); setPersistedObjectIds(new Set(flow.nodes.map((node) => node.id))); setTemplateOpen(false); setNotice(`${template.name} added`);
      window.setTimeout(() => void flowRef.current?.fitView({ nodes: result.objectIds.map((id) => ({ id })), padding: .2, duration: 400 }), 0);
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not apply template'));
  }, [canEdit, persistence, sessionId, setEdges, setNodes]);

  const createBranch = useCallback(() => {
    if (persistence !== 'server') { requireAccount('branch', 'Create an account to branch this canvas', 'Branches need durable version history so you can compare and merge safely without losing your local work.'); return; }
    setNotice('Creating an independent branch…');
    void creationSessionsApi.branch(sessionId, `${title} — branch`).then(async ({ session }) => {
      window.location.href = `/create/${session.id}`;
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not create branch'));
  }, [persistence, requireAccount, sessionId, title]);

  const prepareMerge = useCallback(() => {
    if (!branchParentId || persistence !== 'server') return;
    setNotice('Comparing branch with its parent…');
    void creationSessionsApi.get(branchParentId).then((detail) => {
      const parent = flowFromSession(detail);
      const unused = new Set(parent.nodes.map((node) => node.id));
      const items = nodes.map((source, index): MergeItem => {
        const target = parent.nodes.find((candidate) => unused.has(candidate.id) && candidate.data.kind === source.data.kind && ((source.data.resourceId && candidate.data.resourceId === source.data.resourceId) || candidate.data.title === source.data.title)) ?? null;
        if (target) unused.delete(target.id);
        return { key: `${source.data.kind}:${source.data.resourceId || source.data.title}:${index}`, source, target, choice: 'branch' };
      });
      setMergeReview({ parentId: branchParentId, parentRevision: detail.session.canvasRevision, parentNodes: parent.nodes, parentEdges: parent.edges, items });
      setNotice(`${items.length} object decisions ready for review`);
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not compare branch'));
  }, [branchParentId, nodes, persistence]);

  const applyMerge = useCallback(() => {
    if (!mergeReview) return;
    const consumedTargets = new Set(mergeReview.items.map((item) => item.target?.id).filter((id): id is string => !!id));
    const idMap = new Map<string, string>();
    const merged = mergeReview.items.map((item) => {
      const id = item.target?.id ?? crypto.randomUUID(); idMap.set(item.source.id, id);
      return item.choice === 'parent' && item.target ? item.target : { ...item.source, id };
    });
    mergeReview.parentNodes.filter((node) => !consumedTargets.has(node.id)).forEach((node) => merged.push(node));
    const branchEdges = edges.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target)).map((edge) => ({ ...edge, id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }));
    const parentOnly = new Set(merged.filter((node) => !consumedTargets.has(node.id)).map((node) => node.id));
    const retainedEdges = mergeReview.parentEdges.filter((edge) => parentOnly.has(edge.source) || parentOnly.has(edge.target));
    const graph = creationGraphFromSnapshot({ nodes: merged, edges: [...retainedEdges, ...branchEdges] });
    setNotice('Applying reviewed merge…');
    void creationSessionsApi.saveGraph(mergeReview.parentId, { ...graph, expectedRevision: mergeReview.parentRevision }).then(() => { window.location.href = `/create/${mergeReview.parentId}`; }).catch((error) => setNotice(error instanceof Error ? error.message : 'Merge could not be applied'));
  }, [edges, mergeReview]);

  const expandProject = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : nodes.find((node) => node.data.kind === 'project');
    if (!project) {
      setNotice('Add or select a project first');
      return;
    }
    const projectId = project.data.resourceId?.startsWith('project:') ? Number(project.data.resourceId.slice('project:'.length)) : NaN;
    if (persistence === 'server' && Number.isInteger(projectId) && projectId > 0) {
      setNotice('Loading project relationships…');
      const lens = ['delivery', 'metrics', 'customer-feedback'].includes(String(project.data.projectLens))
        ? project.data.projectLens as 'delivery' | 'metrics' | 'customer-feedback'
        : 'everything';
      void creationSessionsApi.expandProject(sessionId, projectId, lens).then(async (expanded) => {
        const taskDetails = new Map<string, CreationNodeData>();
        await Promise.all(expanded.resources.filter((item) => item.kind === 'task' && item.resourceType === 'task').map(async (item) => {
          const taskId = Number(item.resourceId);
          if (!Number.isInteger(taskId) || taskId <= 0) return;
          try {
            const [task, specs] = await Promise.all([tasksApi.get(taskId), taskSpecsApi.list(taskId).catch(() => [])]);
            const primaryPrd = specs.find((spec) => spec.isPrimary) ?? specs[0];
            const agentNode = expanded.resources.find((resource) => resource.kind === 'agent' && String(resource.resourceId) === String(task.assignedAgentRef));
            taskDetails.set(String(item.resourceId), {
              kind: 'task', title: task.title, taskKey: task.key, status: task.status,
              content: task.description || undefined, priority: task.priority,
              agentRef: task.assignedAgentRef || undefined,
              assignee: agentNode?.title || task.assignedAgentRef || (task.assignedUserId ? 'Assigned teammate' : undefined),
              prdTitle: primaryPrd?.goal || undefined, prdStatus: primaryPrd?.status || undefined,
              prdSummary: primaryPrd?.prd?.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 240) || undefined,
              prdCount: specs.length,
            });
          } catch { /* Keep the relationship card available when task detail is inaccessible. */ }
        }));
        const related: CreationFlowNode[] = [
          ...expanded.resources.slice(0, 24).map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation',
            position: { x: project.position.x + 390 + (index % 3) * 300, y: project.position.y - 180 + Math.floor(index / 3) * 190 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, subtitle: item.subtitle ?? undefined, ...(item.kind === 'task' ? taskDetails.get(String(item.resourceId)) : undefined), resourceId: `${item.resourceType}:${item.resourceId}`, workflowExecutable: item.workflowExecutable, resourceSubtype: item.resourceSubtype },
          })),
          ...expanded.generated.map((item, index): CreationFlowNode => ({
            id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 390 + index * 370, y: project.position.y - 430 },
            data: { kind: item.kind as CreationObjectKind, title: item.title, status: item.status, sourceProjectId: projectId, expansionKey: item.key },
          })),
        ];
        const knownResources = new Set(nodes.map((node) => node.data.resourceId).filter(Boolean));
        const knownNative = new Set(nodes.map((node) => String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        const additions = related.filter((node) => node.data.resourceId ? !knownResources.has(node.data.resourceId) : !knownNative.has(String(node.data.expansionKey || `${node.data.kind}:${node.data.title}`)));
        setNodes((current) => [...current, ...additions]);
        setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: project.id, target: node.id, type: 'smoothstep', label: node.data.kind }))]);
        setNotice(additions.length ? `${additions.length} related project items added` : 'This project lens is already expanded');
        trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: 'web', projectId } });
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not expand project'));
      return;
    }
    const related: CreationFlowNode[] = [
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y - 150 }, data: { kind: 'dashboard', title: `${project.data.title} health` } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 330, y: project.position.y + 100 }, data: { kind: 'roadmap', title: `${project.data.title} roadmap`, status: 'Live' } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y - 120 }, data: { kind: 'workflow', title: 'Delivery workflow', status: 'Ready' } },
      { id: crypto.randomUUID(), type: 'creation', position: { x: project.position.x + 850, y: project.position.y + 150 }, data: { kind: 'task', title: 'Next delivery task', status: 'Ready', role: 'Campaign Strategist' } },
    ];
    const additions = related.filter((candidate) => !nodes.some((node) => node.data.kind === candidate.data.kind && node.data.title === candidate.data.title));
    setNodes((current) => [...current, ...additions]);
    setEdges((current) => [...current, ...additions.map((candidate) => ({ id: crypto.randomUUID(), source: project.id, target: candidate.id, type: 'smoothstep' }))]);
    setNotice('Project relationships added to canvas');
    trackActivity('creation_project_expanded', { sessionId, metadata: { clientSurface: 'web', projectId: Number.isInteger(projectId) ? projectId : undefined } });
  }, [nodes, persistence, selectedNode, sessionId, setEdges, setNodes]);

  const compareProjects = useCallback(() => {
    if (persistence !== 'server') { requireAccount('compare', 'Create an account to compare projects', 'Project comparisons use live tenant projects, delivery metrics, feature evidence, and saved source references.'); return; }
    const projectNodes = nodes.filter((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || '')).slice(0, 6);
    if (projectNodes.length < 2) { setNotice('Add at least two saved projects to compare'); return; }
    setNotice('Loading fresh project evidence…');
    void fetchProjects().then(async (available) => {
      const byId = new Map(available.map((project) => [project.id, project]));
      const evidence = await Promise.all(projectNodes.map(async (node) => {
        const projectId = Number(node.data.resourceId!.slice('project:'.length));
        const project = byId.get(projectId);
        if (!project) throw new Error(`Project ${projectId} is no longer accessible`);
        const [velocity, tasks, quality] = await Promise.all([
          agileMetricsApi.derivedVelocity(projectId).catch(() => null),
          tasksApi.list(projectId).catch(() => []),
          toolsApi.projectScore(projectId).catch(() => null),
        ]);
        const health = computeProjectHealth(project);
        const diagnostics = quality?.diagnostics.map((diagnostic) => ({
          toolId: diagnostic.toolId, name: diagnostic.name, icon: diagnostic.icon,
          score: diagnostic.score, scoreLabel: diagnostic.scoreLabel, headline: diagnostic.headline,
          gapCount: diagnostic.gapCount, remediation: diagnostic.remediation,
          recommendations: diagnostic.result.recommendations,
        })) ?? [];
        return {
          projectId, name: project.name, status: project.status || 'active', progress: health.progressPct,
          health: health.healthScore, healthTier: health.tier, open: health.open, blocked: health.blocked,
          overdue: health.overdue, velocity: velocity?.averageVelocity ?? null,
          qualityScore: quality?.result.score ?? null, qualityLabel: quality?.result.scoreLabel ?? null,
          qualityHeadline: quality?.result.headline ?? 'No quality diagnostics have been run', diagnostics,
          diagnosticCount: diagnostics.length, gapCount: diagnostics.reduce((total, diagnostic) => total + diagnostic.gapCount, 0),
          recommendations: diagnostics.flatMap((diagnostic) => diagnostic.recommendations.map((recommendation) => ({ ...recommendation, diagnostic: diagnostic.name, score: diagnostic.score }))).slice(0, 6),
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
          { label: `${project.name} quality diagnostics`, resource: `/api/tools/projects/${project.projectId}/score`, projectId: project.projectId },
        ]),
      };
      setNodes((current) => [...current.map((node) => {
        const projectId = node.data.resourceId?.match(/^project:(\d+)$/)?.[1];
        const project = projectId ? evidence.find((candidate) => candidate.projectId === Number(projectId)) : null;
        return project ? { ...node, data: { ...node.data, ...project, qualityUpdatedAt: comparison.data.fetchedAt } } : node;
      }), comparison]);
      setEdges((current) => [...current, ...projectNodes.map((project) => ({ id: crypto.randomUUID(), source: project.id, target: comparison.id, label: 'compared in', type: 'smoothstep', animated: true }))]);
      setSelectedId(comparison.id);
      setNotice('Evidence-backed project comparison added');
      trackActivity('creation_projects_compared', { sessionId, metadata: { clientSurface: 'web', projectCount: projectNodes.length } });
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not compare projects'));
  }, [nodes, persistence, requireAccount, setEdges, setNodes]);

  const loadProjectQuality = useCallback(() => {
    const project = selectedNode?.data.kind === 'project' ? selectedNode : null;
    const projectId = project?.data.resourceId?.match(/^project:(\d+)$/)?.[1];
    if (!project || !projectId) {
      if (persistence === 'local') requireAccount('diagnostics', 'Create an account to load project quality', 'Quality diagnostics are saved against a canonical project and include current results, gaps, and remediation recommendations.');
      else setNotice('Attach a saved project before loading quality diagnostics');
      return;
    }
    setNotice('Loading project quality diagnostics…');
    void toolsApi.projectScore(Number(projectId)).then((quality) => {
      const diagnostics = quality.diagnostics.map((diagnostic) => ({
        toolId: diagnostic.toolId, name: diagnostic.name, icon: diagnostic.icon,
        score: diagnostic.score, scoreLabel: diagnostic.scoreLabel, headline: diagnostic.headline,
        gapCount: diagnostic.gapCount, remediation: diagnostic.remediation,
        recommendations: diagnostic.result.recommendations,
      }));
      const recommendations = diagnostics.flatMap((diagnostic) => diagnostic.recommendations.map((recommendation) => ({ ...recommendation, diagnostic: diagnostic.name, score: diagnostic.score }))).slice(0, 8);
      const qualityData = {
        qualityScore: quality.result.score, qualityLabel: quality.result.scoreLabel,
        qualityHeadline: quality.result.headline, diagnosticCount: diagnostics.length,
        gapCount: diagnostics.reduce((total, diagnostic) => total + diagnostic.gapCount, 0),
        diagnostics, recommendations, qualityUpdatedAt: new Date().toISOString(),
      };
      const existing = nodes.find((node) => node.data.kind === 'diagnostics' && node.data.qualityProjectId === Number(projectId));
      const qualityNode = existing ?? newNode('diagnostics', { x: project.position.x + 390, y: project.position.y });
      qualityNode.data = { ...qualityNode.data, ...qualityData, qualityProjectId: Number(projectId), title: `${project.data.title} quality`, status: diagnostics.length ? 'Diagnostics current' : 'Not yet assessed', items: diagnostics };
      setNodes((current) => existing
        ? current.map((node) => node.id === project.id ? { ...node, data: { ...node.data, ...qualityData } } : node.id === existing.id ? { ...node, data: qualityNode.data } : node)
        : [...current.map((node) => node.id === project.id ? { ...node, data: { ...node.data, ...qualityData } } : node), qualityNode]);
      if (!existing) setEdges((current) => [...current, { id: crypto.randomUUID(), source: project.id, target: qualityNode.id, label: 'quality evidence', type: 'smoothstep', animated: true }]);
      setSelectedId(qualityNode.id);
      setNotice(diagnostics.length ? `${diagnostics.length} quality diagnostics added to the canvas` : 'Quality card added — run a diagnostic to establish a score');
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load project quality'));
  }, [nodes, persistence, requireAccount, selectedNode, setEdges, setNodes]);

  const deliverMockup = useCallback(() => {
    if (!selectedNode || (selectedNode.data.kind !== 'mockup' && selectedNode.data.kind !== 'mockupSet')) return;
    if (persistence === 'local') { requireAccount('deliver', 'Create an account to deliver this mockup', 'Delivery creates a durable project task, assigns an authorized Agent, and keeps execution status connected to this canvas.'); return; }
    const configuredProjectRef = typeof selectedNode.data.deliveryProjectRef === 'string' ? selectedNode.data.deliveryProjectRef : null;
    const configuredAgentRef = typeof selectedNode.data.mockupAgentRef === 'string' ? selectedNode.data.mockupAgentRef : null;
    const project = configuredProjectRef == null
      ? nodes.find((node) => node.data.kind === 'project')
      : nodes.find((node) => node.data.kind === 'project' && (node.data.resourceId || node.id) === configuredProjectRef);
    const agent = configuredAgentRef == null
      ? nodes.find((node) => node.data.kind === 'agent')
      : nodes.find((node) => node.data.kind === 'agent' && (node.data.resourceId || node.id) === configuredAgentRef);
    const projectId = project?.data.resourceId?.startsWith('project:') ? Number(project.data.resourceId.slice('project:'.length)) : NaN;
    const addTaskNode = (resourceId: string, status: string, detail: Partial<CreationNodeData> = {}) => {
      const taskId = crypto.randomUUID();
      const task: CreationFlowNode = {
        id: taskId, type: 'creation', position: { x: selectedNode.position.x + 330, y: selectedNode.position.y + 40 },
        data: { kind: 'task', title: `Build ${selectedNode.data.title}`, status, role: agent?.data.title || 'Available agent', assignee: agent?.data.title, agentRef: agent?.data.resourceId?.replace(/^agent:/, ''), priority: 'high', content: selectedNode.data.subtitle || 'Implement the approved canvas mockup.', subtitle: project ? `Deliver to ${project.data.title}.` : 'Attach a project when ready.', ...detail, resourceId },
      };
      setNodes((current) => [...current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status } } : node), task]);
      setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: taskId, type: 'smoothstep', animated: true }]);
      setSelectedId(taskId);
      return taskId;
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
        const canvasTaskId = addTaskNode(`task:${created.id}`, created.status || (agentRef ? 'Assigned' : 'Ready'), { taskKey: created.key, priority: created.priority, content: created.description || undefined, agentRef: created.assignedAgentRef || undefined });
        trackActivity('creation_artifact_delivered', { sessionId, metadata: { clientSurface: 'web', objectKinds: [selectedNode.data.kind], projectId } });
        if (agentRef) {
          trackActivity('creation_agent_assigned', { sessionId, metadata: { clientSurface: 'web', projectId } });
          let execution;
          try {
            execution = await runtimeApi.submitExecution({ taskId: created.id, sessionId });
          } catch (error) {
            setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status: 'Agent start failed' } } : node));
            setNotice(`Delivery task ${created.id} was created, but the agent could not start: ${error instanceof Error ? error.message : 'runtime unavailable'}`);
            return;
          }
          if (isAwaitingApprovalExecution(execution)) {
            setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status: 'Awaiting approval' } } : node));
            setNotice('Delivery task created; agent run is awaiting approval');
          } else {
            setNotice('Delivery task created and agent started');
            const follow = async (remaining = 80) => {
              try {
                const live = await runtimeApi.get(execution.id);
                const status = String(live.status || 'running').replaceAll('_', ' ');
                setNodes((current) => current.map((node) => node.id === canvasTaskId ? { ...node, data: { ...node.data, status, executionId: execution.id, executionUpdatedAt: new Date().toISOString() } } : node));
                if (!['completed', 'failed', 'cancelled', 'canceled'].includes(String(live.status)) && remaining > 0) window.setTimeout(() => void follow(remaining - 1), 3_000);
                else setNotice(`Agent delivery ${status}`);
              } catch { if (remaining > 0) window.setTimeout(() => void follow(remaining - 1), 5_000); }
            };
            void follow();
          }
        } else {
          setNotice('Mockup delivered to the project as a task');
        }
      }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not create delivery task'));
      return;
    }
    addTaskNode(`draft-task:${crypto.randomUUID()}`, 'Draft');
    setNotice('Add a real project to deliver this task');
  }, [nodes, persistence, requireAccount, selectedNode, sessionId, setEdges, setNodes]);

  const expandMockupSet = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'mockupSet') return;
    const labels = Array.isArray(selectedNode.data.items) && selectedNode.data.items.length
      ? selectedNode.data.items.map(String).slice(0, 10)
      : ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'];
    const additions = labels.map((label, index): CreationFlowNode => ({ id: crypto.randomUUID(), type: 'creation', position: { x: selectedNode.position.x + 440 + (index % 2) * 330, y: selectedNode.position.y - 180 + Math.floor(index / 2) * 220 }, data: { kind: 'mockup', title: label, status: 'Ready for review', subtitle: `High-fidelity concept ${index + 1} of ${labels.length}.` } }));
    setNodes((current) => [...current, ...additions]);
    setEdges((current) => [...current, ...additions.map((node) => ({ id: crypto.randomUUID(), source: selectedNode.id, target: node.id, type: 'smoothstep', label: 'contains', animated: true }))]);
    setNotice(`${additions.length} mockups expanded on the canvas`);
  }, [selectedNode, setEdges, setNodes]);

  const attachEvermindProject = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const project = nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || ''));
    if (!project) { setNotice('Add a saved project to the canvas first'); return; }
    const projectId = Number(project.data.resourceId!.slice('project:'.length));
    updateSelected({ resourceId: `evermind:${projectId}`, projectId, status: 'Loading…' });
    setEdges((current) => current.some((edge) => edge.source === project.id && edge.target === selectedNode.id) ? current : [...current, { id: crypto.randomUUID(), source: project.id, target: selectedNode.id, label: 'owns model', type: 'smoothstep' }]);
    void Promise.all([getProjectEvermindHead(projectId), getProjectEvermindContributions(projectId)]).then(([head, activity]) => {
      updateSelected({
        title: head.name || selectedNode.data.title,
        status: head.seeded ? `v${head.version} · ${head.mode}` : 'Ready to seed',
        evermindVersion: head.version,
        evermindSeeded: head.seeded,
        contributions: head.contributions,
        pendingContributions: activity.pending,
        recentLearnings: activity.recent,
        trainingLoss: activity.training[0]?.loss,
        learningMode: head.mode,
        lastLearnedAt: head.lastLearnedAt,
        quarantinedAt: head.quarantinedAt,
        quarantineReason: head.quarantineReason,
        evalPoint: activity.eval,
        inferenceEnabled: head.inferenceEnabled,
        teacherModel: head.teacherModel || undefined,
      });
      setNotice('Evermind attached to project');
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load Evermind'));
  }, [nodes, selectedNode, setEdges, updateSelected]);

  const expandEvermindPipeline = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    const existing = nodes.filter((node) => node.data.modelPipelineFor === selectedNode.id);
    if (existing.length) {
      const start = existing.find((node) => node.data.pipelineStep === 1) ?? existing[0]!;
      setSelectedId(start.id); setSelectedIds([start.id]);
      window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...existing].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
      setNotice('Step 1 of 5 — choose a CSV or TSV in the Details panel');
      return;
    }
    const specs: Array<{ kind: CreationObjectKind; title: string; status: string; x: number; y: number; step: number; instruction: string; detail?: Partial<CreationNodeData> }> = [
      { kind: 'dataset', title: `${selectedNode.data.title} training corpus`, status: 'Start here', x: -430, y: -20, step: 1, instruction: 'Select this card, then import a CSV or TSV in Details.' },
      { kind: 'workflow', title: 'Tokenize examples', status: 'Waiting for data', x: -430, y: 250, step: 2, instruction: 'Review the corpus, then run tokenization.', detail: { steps: [{ title: 'Inspect corpus', status: 'Waiting' }, { title: 'Build vocabulary', status: 'Waiting' }, { title: 'Verify tokens', status: 'Waiting' }] } },
      { kind: 'workflow', title: 'Distil & tune', status: 'Waiting for tokens', x: -20, y: 250, step: 3, instruction: 'Choose self-learning or a teacher, then adapt the model.', detail: { steps: [{ title: 'Choose teacher', status: 'Waiting' }, { title: 'Create exemplars', status: 'Waiting' }, { title: 'Adapt weights', status: 'Waiting' }, { title: 'Save version', status: 'Waiting' }] } },
      { kind: 'evaluation', title: 'Quality gate', status: 'Waiting for version', x: 800, y: 15, step: 4, instruction: 'Test learned answers before enabling replies.', detail: { verdict: 'Awaiting trained version', gaps: ['Run readiness prompts', 'Compare held-out loss', 'Approve the version'], recommendations: ['Complete distillation and tuning first.', 'Check regression against prior learnings.', 'Publish only after the model is coherent.'] } },
      { kind: 'dashboard', title: 'Learning telemetry', status: 'Waiting for run', x: 800, y: 300, step: 5, instruction: 'Observe loss, weight movement, and learned examples.', detail: { kpis: [{ label: 'Loss', value: '—', trend: 'After first run' }, { label: 'Weights moved', value: '—', trend: 'After first run' }, { label: 'Examples learned', value: '0', trend: 'No run yet' }], chartLabels: ['No training runs yet'], chartValues: [0] } },
    ];
    const created = specs.map((spec) => {
      const node = newNode(spec.kind, { x: selectedNode.position.x + spec.x, y: selectedNode.position.y + spec.y });
      node.data = { ...node.data, ...spec.detail, title: spec.title, status: spec.status, modelPipelineFor: selectedNode.id, pipelineStep: spec.step, pipelineStart: spec.step === 1, pipelineInstruction: spec.instruction };
      return node;
    });
    const [dataset, tokenizer, tuning, evaluation, telemetry] = created;
    const sequence = [
      { source: dataset!.id, target: tokenizer!.id, label: '1 · examples' },
      { source: tokenizer!.id, target: tuning!.id, label: '2 · tokens' },
      { source: tuning!.id, target: selectedNode.id, label: '3 · learned version' },
      { source: selectedNode.id, target: evaluation!.id, label: '4 · test' },
      { source: evaluation!.id, target: telemetry!.id, label: '5 · observe' },
    ];
    setNodes((current) => [...current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, pipelineExpanded: true } } : node), ...created]);
    setEdges((current) => [...current, ...sequence.map((edge) => ({ ...edge, id: crypto.randomUUID(), type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed } }))]);
    setSelectedId(dataset!.id); setSelectedIds([dataset!.id]);
    window.setTimeout(() => void flowRef.current?.fitView({ nodes: [selectedNode, ...created].map((node) => ({ id: node.id })), padding: .16, duration: 400 }), 0);
    setNotice('Step 1 of 5 — choose a CSV or TSV in the Details panel');
  }, [nodes, selectedNode, setEdges, setNodes]);

  const startStandup = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'standup') return;
    if (persistence === 'local') { requireAccount('start', 'Create an account to start a collaborative stand-up', 'A live stand-up needs durable participants, shared activity, follow-up tasks, and tenant permissions.'); return; }
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
    setNotice('Add a project to start a live stand-up');
  }, [nodes, persistence, requireAccount, selectedNode, setEdges, setNodes]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (!canEdit) { setNotice('Your session role does not allow editing'); return; }
    const kind = event.dataTransfer.getData(DND_MIME) as CreationObjectKind;
    if (!kind || !flowRef.current) return;
    const node = newNode(kind, flowRef.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    setNodes((current) => [...current, node]);
    setSelectedId(node.id); setSelectedIds([node.id]);
  }, [canEdit, setNodes]);

  const canvasActions = useMemo<BrainAction[]>(() => [{
    name: 'canvas_read_snapshot',
    description: 'Read every object and relationship currently visible on the creation canvas.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => ({
      scope: resolvedScopeMode,
      objects: scopedNodes.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true }; }),
      connections: scopedEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
    }),
  }, {
    name: 'canvas_read_project_prds',
    description: 'Read the complete canonical PRDs and version history for every ticket in a project. Always use this before synthesizing, consolidating, or explaining project requirements; canvas selection does not limit this project-wide read.',
    parameters: { type: 'object', additionalProperties: false, properties: { projectId: { type: 'number', description: 'Canonical project id. Omit when exactly one project is present on the canvas.' } } },
    run: async (raw: unknown) => {
      if (persistence !== 'server') return { error: 'Canonical project PRDs require a saved session' };
      const requested = Number((raw as { projectId?: unknown })?.projectId);
      const available = nodes.flatMap((node) => {
        const match = node.data.kind === 'project' ? node.data.resourceId?.match(/^project:(\d+)$/) : null;
        return match ? [Number(match[1])] : [];
      });
      const projectId = Number.isInteger(requested) && requested > 0 ? requested : available.length === 1 ? available[0]! : NaN;
      if (!Number.isInteger(projectId) || projectId <= 0) return { error: available.length ? 'Specify which canvas project to read' : 'Add a canonical project to the canvas first' };
      return creationSessionsApi.projectPrdContext(sessionId, projectId);
    },
  }, {
    name: 'canvas_create_project_prd',
    description: 'Propose a complete canonical PRD assigned to a project and represented on the canvas. Use this—not canvas_add_object—for a project PRD, consolidated PRD, or requirements synthesis.',
    parameters: {
      type: 'object', required: ['title', 'markdown'], additionalProperties: false,
      properties: {
        projectId: { type: 'number', description: 'Canonical project id. Omit when exactly one project is present on the canvas.' },
        title: { type: 'string' }, markdown: { type: 'string', description: 'Complete authored PRD in Markdown.' },
        status: { type: 'string', enum: ['draft', 'ready', 'in_progress', 'complete'] },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      if (persistence !== 'server') return { error: 'Create an account and save the session before creating a canonical project PRD' };
      const args = raw as { projectId?: unknown; title?: unknown; markdown?: unknown; status?: unknown };
      const requested = Number(args.projectId);
      const projectNodes = nodes.filter((node) => node.data.kind === 'project' && /^project:\d+$/.test(String(node.data.resourceId || '')));
      const project = Number.isInteger(requested) && requested > 0
        ? projectNodes.find((node) => node.data.resourceId === `project:${requested}`)
        : projectNodes.length === 1 ? projectNodes[0] : undefined;
      if (!project) return { error: projectNodes.length ? 'Specify which canvas project owns this PRD' : 'Add a canonical project to the canvas first' };
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) : '';
      const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : '';
      if (!title || !markdown) return { error: 'A project PRD requires a title and complete Markdown content' };
      const projectId = Number(project.data.resourceId!.slice('project:'.length));
      const node = newNode('prd', { x: project.position.x + 390, y: project.position.y });
      node.data = {
        ...node.data, title, markdown, content: markdown,
        status: ['draft', 'ready', 'in_progress', 'complete'].includes(String(args.status)) ? String(args.status) : 'draft',
        sourceProjectId: projectId, canonicalPrdPending: true,
      };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Create project PRD “${title}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Assign ${title} to ${project.data.title}`, edge: { id: crypto.randomUUID(), source: node.id, target: project.id, type: 'smoothstep', label: 'requirements for', data: { connectionKind: 'reference' } } });
      return { ok: true, proposed: true, projectId, object: { id: node.id, kind: 'prd', title }, persistence: 'canonical-after-review' };
    },
  }, {
    name: 'canvas_add_object',
    description: 'Create a fully authored visual object. Put type-specific content in fields; supported fields depend on kind and are listed in the current canvas snapshot.',
    parameters: {
      type: 'object', required: ['kind'], additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: CREATION_OBJECT_REGISTRY.map((definition) => definition.kind) },
        title: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' },
        fields: { type: 'object', description: 'Type-specific authored content. Unknown or sensitive fields are rejected.', additionalProperties: true },
        x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { kind?: CreationObjectKind; title?: string; subtitle?: string; status?: string; fields?: unknown; x?: number; y?: number; width?: number; height?: number };
      const allowed = new Set(CREATION_OBJECT_REGISTRY.map((definition) => definition.kind));
      if (!args.kind || !allowed.has(args.kind)) return { error: 'Unsupported canvas object kind' };
      const node = newNode(args.kind, { x: Number(args.x ?? 520), y: Number(args.y ?? 280) });
      const authored = sanitizeCreationObjectPatch(args.kind, { ...((args.fields && typeof args.fields === 'object') ? args.fields : {}), title: args.title, subtitle: args.subtitle, status: args.status });
      node.data = { ...node.data, ...authored, title: typeof authored.title === 'string' && authored.title.trim() ? authored.title.slice(0, 160) : node.data.title };
      const width = Number(args.width); const height = Number(args.height);
      if (Number.isFinite(width) || Number.isFinite(height)) node.style = { width: Number.isFinite(width) ? Math.max(240, Math.min(width, 2_400)) : undefined, height: Number.isFinite(height) ? Math.max(130, Math.min(height, 1_800)) : undefined };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add ${node.data.kind} “${node.data.title}”`, node });
      return { ok: true, proposed: true, object: { id: node.id, kind: node.data.kind, title: node.data.title }, mutableFields: creationObjectDefinition(args.kind).mutableFields };
    },
  }, {
    name: 'canvas_update_object',
    description: 'Author or revise any supported field of an existing canvas object. Read the snapshot first to learn its kind and mutableFields.',
    parameters: { type: 'object', required: ['objectId', 'fields'], additionalProperties: false, properties: { objectId: { type: 'string' }, fields: { type: 'object', additionalProperties: true } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; fields?: unknown };
      const target = nodes.find((node) => node.id === args.objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === args.objectId)?.node;
      if (!args.objectId || !target) return { error: 'Object not found' };
      const patch = sanitizeCreationObjectPatch(target.data.kind, args.fields);
      if (!Object.keys(patch).length) return { error: `No supported fields supplied. Mutable fields: ${creationObjectDefinition(target.data.kind).mutableFields.join(', ')}` };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update ${args.objectId}`, objectId: args.objectId, patch });
      return { ok: true, proposed: true, objectId: args.objectId, updatedFields: Object.keys(patch) };
    },
  }, {
    name: 'canvas_delete_object',
    description: 'Remove an object and all of its connections from the canvas.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const objectId = (raw as { objectId?: string }).objectId;
      const target = nodes.find((node) => node.id === objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === objectId)?.node;
      if (!objectId || !target) return { error: 'Object not found' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.delete', label: `Delete ${target.data.title}`, objectId });
      return { ok: true, proposed: true, objectId };
    },
  }, {
    name: 'canvas_arrange_objects',
    description: 'Automatically position multiple canvas objects in a non-overlapping grid, row, or column using their actual rendered sizes. Use this for requests to organize, align, evenly space, tidy, or remove overlaps. When objectIds is omitted, this intentionally arranges the whole visible canvas regardless of the prompt selection scope.',
    parameters: { type: 'object', additionalProperties: false, properties: { objectIds: { type: 'array', items: { type: 'string' }, description: 'Specific objects to arrange. Omit to arrange every visible unlocked object on the canvas, even when the composer is scoped to a single selection.' }, arrangement: { type: 'string', enum: ['grid', 'row', 'column'] }, gap: { type: 'number', description: 'Space between object bounds in canvas pixels.' }, columns: { type: 'number', description: 'Optional grid column count.' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectIds?: unknown; arrangement?: CanvasArrangement; gap?: number; columns?: number };
      const requestedIds = Array.isArray(args.objectIds) ? new Set(args.objectIds.filter((id): id is string => typeof id === 'string')) : null;
      const targets = canvasArrangementTargets(nodes, requestedIds);
      if (targets.length < 2) return { error: 'At least two unlocked objects are required to arrange the canvas' };
      const positions = arrangeCanvasNodes(targets, args.arrangement, Number(args.gap ?? 48), Number(args.columns));
      let proposed = 0;
      for (const target of targets) {
        const position = positions.get(target.id);
        if (!position || (position.x === target.position.x && position.y === target.position.y)) continue;
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.layout', label: `Arrange ${target.data.title}`, objectId: target.id, position });
        proposed += 1;
      }
      return { ok: true, proposed: true, arrangedObjects: targets.length, proposedChanges: proposed, arrangement: args.arrangement || 'grid', gap: Math.max(16, Math.min(Number(args.gap ?? 48), 320)) };
    },
  }, {
    name: 'canvas_set_object_layout',
    description: 'Move, resize, hide, show, lock, or unlock an existing canvas object.',
    parameters: { type: 'object', required: ['objectId'], additionalProperties: false, properties: { objectId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; x?: number; y?: number; width?: number; height?: number; hidden?: boolean; locked?: boolean };
      const current = nodes.find((node) => node.id === args.objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === args.objectId)?.node;
      if (!args.objectId || !current) return { error: 'Object not found' };
      const hasPosition = Number.isFinite(args.x) || Number.isFinite(args.y);
      const position = hasPosition ? { x: Number.isFinite(args.x) ? Number(args.x) : current.position.x, y: Number.isFinite(args.y) ? Number(args.y) : current.position.y } : undefined;
      const change: Extract<ProposedCanvasChange, { type: 'object.layout' }> = { id: crypto.randomUUID(), type: 'object.layout', label: `Arrange ${current.data.title}`, objectId: args.objectId, ...(position ? { position } : {}), ...(Number.isFinite(args.width) ? { width: Math.max(240, Math.min(Number(args.width), 2_400)) } : {}), ...(Number.isFinite(args.height) ? { height: Math.max(130, Math.min(Number(args.height), 1_800)) } : {}), ...(typeof args.hidden === 'boolean' ? { hidden: args.hidden } : {}), ...(typeof args.locked === 'boolean' ? { locked: args.locked } : {}) };
      if (!change.position && change.width == null && change.height == null && change.hidden == null && change.locked == null) return { error: 'No layout change supplied' };
      proposalBuffer.current.push(change);
      return { ok: true, proposed: true, objectId: args.objectId };
    },
  }, {
    name: 'canvas_invoke_object_action',
    description: 'Invoke a native capability declared by a canvas object. Inspect and edit return guidance immediately; operational actions are proposed for user review before execution.',
    parameters: { type: 'object', required: ['objectId', 'action'], additionalProperties: false, properties: { objectId: { type: 'string' }, action: { type: 'string' } } },
    mutates: (raw: unknown) => !['inspect', 'edit'].includes(String((raw as { action?: unknown })?.action || '')),
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; action?: string };
      const target = nodes.find((node) => node.id === args.objectId) || proposalBuffer.current.find((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add' && change.node.id === args.objectId)?.node;
      if (!args.objectId || !target) return { error: 'Object not found' };
      const definition = creationObjectDefinition(target.data.kind);
      if (!args.action || !definition.actions.includes(args.action)) return { error: `Unsupported action. Available actions: ${definition.actions.join(', ')}` };
      if (args.action === 'inspect') return { object: { id: target.id, ...definition.contextAdapter(target.data) }, actions: definition.actions, mutableFields: definition.mutableFields };
      if (args.action === 'edit') return { objectId: target.id, kind: target.data.kind, mutableFields: definition.mutableFields, instruction: 'Call canvas_update_object with the desired fields.' };
      if (persistence === 'local' && ACCOUNT_REQUIRED_OBJECT_ACTIONS.has(args.action)) {
        requireAccount(args.action, `Create an account to ${args.action}`, `Your ${target.data.title} remains saved on this device. Create a free account to ${args.action} it with durable tenant resources, permissions, and history.`);
        return { requiresAccount: true, action: args.action, objectId: target.id, message: 'The account creation prompt is open. The local canvas remains unchanged.' };
      }
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.action', label: `${args.action} ${target.data.title}`, objectId: target.id, action: args.action });
      return { ok: true, proposed: true, objectId: target.id, action: args.action };
    },
  }, {
    name: 'canvas_connect_objects',
    description: 'Draw a labeled relationship between two existing canvas objects.',
    parameters: { type: 'object', required: ['sourceId', 'targetId'], additionalProperties: false, properties: { sourceId: { type: 'string' }, targetId: { type: 'string' }, kind: { type: 'string', enum: [...CREATION_CONNECTION_KINDS] }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { sourceId?: string; targetId?: string; kind?: CreationConnectionKind; label?: string };
      const exists = (id: string) => nodes.some((node) => node.id === id) || proposalBuffer.current.some((change) => change.type === 'object.add' && change.node.id === id);
      if (!args.sourceId || !args.targetId || !exists(args.sourceId) || !exists(args.targetId)) return { error: 'Source or target object not found' };
      const edge = { id: crypto.randomUUID(), source: args.sourceId, target: args.targetId, label: args.label?.slice(0, 120), type: 'smoothstep', animated: true, data: { connectionKind: args.kind || 'reference' } } satisfies Edge;
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Connect objects${args.label ? `: ${args.label}` : ''}`, edge });
      return { ok: true, proposed: true, connectionId: edge.id };
    },
  }, {
    name: 'canvas_update_connection',
    description: 'Change the label or semantic kind of an existing connection.',
    parameters: { type: 'object', required: ['connectionId'], additionalProperties: false, properties: { connectionId: { type: 'string' }, kind: { type: 'string', enum: [...CREATION_CONNECTION_KINDS] }, label: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { connectionId?: string; kind?: CreationConnectionKind; label?: string };
      const exists = edges.some((edge) => edge.id === args.connectionId) || proposalBuffer.current.some((change) => change.type === 'connection.add' && change.edge.id === args.connectionId);
      if (!args.connectionId || !exists) return { error: 'Connection not found' };
      const patch = { ...(typeof args.label === 'string' ? { label: args.label.slice(0, 120) } : {}), ...(args.kind && CREATION_CONNECTION_KINDS.includes(args.kind) ? { kind: args.kind } : {}) };
      if (!Object.keys(patch).length) return { error: 'No connection change supplied' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.update', label: `Update connection ${args.connectionId}`, connectionId: args.connectionId, patch });
      return { ok: true, proposed: true, connectionId: args.connectionId };
    },
  }, {
    name: 'canvas_delete_connection',
    description: 'Remove an existing relationship between canvas objects.',
    parameters: { type: 'object', required: ['connectionId'], additionalProperties: false, properties: { connectionId: { type: 'string' } } },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const connectionId = (raw as { connectionId?: string }).connectionId;
      const exists = edges.some((edge) => edge.id === connectionId) || proposalBuffer.current.some((change) => change.type === 'connection.add' && change.edge.id === connectionId);
      if (!connectionId || !exists) return { error: 'Connection not found' };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.delete', label: `Delete connection ${connectionId}`, connectionId });
      return { ok: true, proposed: true, connectionId };
    },
  }], [canEdit, edges, nodes, persistence, requireAccount, resolvedScopeMode, scopedEdges, scopedNodes, sessionId]);

  const evaluateCanvas = useCallback((event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim() || thinking) return;
    trackActivity('creation_prompt_submitted', { sessionId, metadata: { clientSurface: 'web', scope: resolvedScopeMode, objectKinds: [...new Set(scopedNodes.map((node) => node.data.kind))] } });
    setThinking(true);
    setNotice('Brain is evaluating connected objects…');
    const requestText = prompt.trim();
    const initialMessage = initialPromptSubmitted.current ? timeline.find((message) => (message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:')) && message.body === requestText) : undefined;
    const requestMessageId = appendTimeline('user', requestText, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds] }, initialMessage?.clientMessageId);
    if (process.env.NODE_ENV !== 'test') {
      proposalBuffer.current = [];
      setBrainTrace([]);
      setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, trace: [] } } : node));
      setProposedChanges([]);
      const request = requestText;
      const snapshot = JSON.stringify({
        sessionId, scope: resolvedScopeMode, selectedObjectIds: effectiveSelectedIds,
        objects: scopedNodes.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true }; }),
        connections: scopedEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
      });
      setPrompt('');
      void runCreationCanvasAi({
        prompt: request, canvasSnapshot: snapshot, persistence, canvasActions,
        ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
        routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
        autoApprove: autoApplyRef.current,
        confirmAction: ({ name, args }) => {
          let preview = '';
          try { const serialized = JSON.stringify(args ?? {}); preview = serialized === '{}' ? '' : serialized.length > 320 ? `${serialized.slice(0, 320)}…` : serialized; } catch { preview = ''; }
          return confirm({ title: 'Approve Brain action', message: `Brain wants to run ${name.replaceAll('_', ' ')}.${preview ? `\n\n${preview}` : ''}`, confirmLabel: 'Approve', cancelLabel: 'Cancel', destructive: false });
        },
        ...(persistence === 'server' && memoryEnabled && evermindProjectId != null ? { evermind: {
          recall: (query: string) => recallProjectEvermind(evermindProjectId, query).catch(() => null),
          learn: (answer: string, question: string) => teachProjectEvermindFromText(evermindProjectId, answer, question),
        } } : {}),
        onTrace: (event) => setBrainTrace((current) => [...current, event]),
        conversation: timeline.map((message) => ({ role: message.messageRole, content: message.body })),
      }).then((answer) => {
        const changes = [...proposalBuffer.current];
        if (answer.trim()) {
          appendTimeline('assistant', answer.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds] }, `${requestMessageId}:assistant`);
          const chat = nodes.find((node) => node.data.kind === 'chat');
          const brainId = chat?.id ?? crypto.randomUUID();
          if (!chat) {
            const responseNode = { ...newNode('chat', { x: 120, y: 120 }), id: brainId };
            responseNode.data = { ...responseNode.data, title: 'Brain', subtitle: request, aiResponse: answer.trim() };
            setNodes((current) => [...current, responseNode]);
          } else setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, subtitle: request, aiResponse: answer.trim() } } : node));
          const promptTargets = effectiveSelectedIds.filter((id) => id !== brainId && nodes.some((node) => node.id === id && node.data.kind !== 'chat'));
          if (promptTargets.length) setEdges((current) => associateBrainWithArtifacts(current, brainId, promptTargets));
        }
        if (changes.length) {
          setProposedChanges(changes);
          setAcceptedProposalIds(new Set(changes.map((change) => change.id)));
          setAutoApplyPending(autoApplyRef.current);
        }
        setThinking(false);
        setNotice(changes.length ? `${changes.length} Brain changes await review` : 'Brain finished evaluating the canvas');
        trackActivity('creation_ai_evaluation_completed', { sessionId, metadata: { clientSurface: 'web', proposedChangeCount: changes.length, objectKinds: [...new Set(nodes.map((node) => node.data.kind))] } });
      }).catch((error) => {
        appendTimeline('system', error instanceof Error ? error.message : 'Brain could not complete this request', { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:error`);
        setThinking(false);
        setNotice(error instanceof Error ? error.message : 'Brain could not complete this request');
      });
      return;
    }
    window.setTimeout(() => {
      const request = prompt.toLowerCase();
      if (request.includes('roadmap')) {
        const project = nodes.find((node) => node.data.kind === 'project');
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const roadmap: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'roadmap', title: request.includes('executive') ? 'Executive team roadmap' : 'Sales presentation roadmap', status: 'AI generated' } };
        const slides: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 315 }, data: { kind: 'slides', title: request.includes('executive') ? 'Executive team presentation' : 'Sales presentation', status: 'AI generated' } };
        setNodes((current) => [...current, roadmap, slides]);
        setEdges((current) => associateBrainWithArtifacts([...current, ...(project ? [{ id: crypto.randomUUID(), source: project.id, target: roadmap.id, type: 'smoothstep' as const }] : []), { id: crypto.randomUUID(), source: roadmap.id, target: slides.id, type: 'smoothstep', label: 'presents', animated: true }], brain?.id || '', [roadmap.id], 'Created with Brain'));
        setSelectedId(roadmap.id); setThinking(false); setPrompt(''); setNotice('Roadmap added to canvas'); return;
      }
      if (request.includes('top 10') || request.includes('requested features')) {
        const brain = nodes.find((node) => node.data.kind === 'chat');
        const summary: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 500, y: 260 }, data: { kind: 'featureSummary', title: 'Top 10 requested features', status: 'Synthesized' } };
        const mockups: CreationFlowNode = { id: crypto.randomUUID(), type: 'creation', position: { x: 1040, y: 300 }, data: { kind: 'mockupSet', title: 'Top 10 feature mockups', status: 'Ready for review', subtitle: 'Ten linked high-fidelity concepts generated from user feedback.', items: ['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'], sources: [{ label: 'Customer feedback evidence', resource: '/api/feedback' }] } };
        setNodes((current) => [...current, summary, mockups]);
        setEdges((current) => associateBrainWithArtifacts([...current, { id: crypto.randomUUID(), source: summary.id, target: mockups.id, type: 'smoothstep', animated: true }], brain?.id || '', [summary.id], 'Created with Brain'));
        setSelectedId(mockups.id); setThinking(false); setPrompt(''); setNotice('Feature summary and mockups added'); return;
      }
      const evaluationId = crypto.randomUUID();
      setNodes((current) => [...current, { id: evaluationId, type: 'creation', position: { x: 560, y: 315 }, data: { kind: 'evaluation', title: 'Canvas evaluation', status: 'AI evaluation' } }]);
      const workflow = nodes.find((node) => node.data.kind === 'workflow');
      const website = nodes.find((node) => node.data.kind === 'website');
      const brain = nodes.find((node) => node.data.kind === 'chat');
      setEdges((current) => associateBrainWithArtifacts([...current, ...[workflow, website].filter((node): node is CreationFlowNode => !!node).map((node) => ({ id: crypto.randomUUID(), source: node.id, target: evaluationId, type: 'smoothstep', animated: true }))], brain?.id || '', [evaluationId], 'Created with Brain'));
      setSelectedId(evaluationId);
      setThinking(false);
      setPrompt('');
      setNotice('Evaluation added to canvas');
    }, 850);
  }, [appendTimeline, canvasActions, confirm, effectiveSelectedIds, edges, evermindProjectId, memoryEnabled, modelSelection, nodes, persistence, prompt, resolvedScopeMode, scopedEdges, scopedNodeIds, scopedNodes, sessionId, setEdges, setNodes, thinking, timeline]);

  useEffect(() => {
    if (!hydrated.current || initialPromptSubmitted.current || thinking) return;
    const initial = timeline.find((message) => message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'));
    if (!initial || timeline.some((message) => message.messageRole === 'assistant')) return;
    initialPromptSubmitted.current = true;
    setPrompt(initial.body);
    window.setTimeout(() => composerFormRef.current?.requestSubmit(), 0);
  }, [thinking, timeline]);

  const applyProposedChanges = useCallback(async () => {
    const selected = proposedChanges.filter((change) => acceptedProposalIds.has(change.id));
    const additions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.add' }> => change.type === 'object.add');
    const updates = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.update' }> => change.type === 'object.update');
    const deletions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.delete' }> => change.type === 'object.delete');
    const layouts = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.layout' }> => change.type === 'object.layout');
    const actions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'object.action' }> => change.type === 'object.action');
    const connectionAdditions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.add' }> => change.type === 'connection.add');
    const connectionUpdates = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.update' }> => change.type === 'connection.update');
    const connectionDeletions = selected.filter((change): change is Extract<ProposedCanvasChange, { type: 'connection.delete' }> => change.type === 'connection.delete');
    const deletedObjectIds = new Set(deletions.map((change) => change.objectId));
    const deletedConnectionIds = new Set(connectionDeletions.map((change) => change.connectionId));
    let materializedAdditions = additions;
    const canonicalPrds = additions.filter((change) => change.node.data.kind === 'prd' && change.node.data.canonicalPrdPending === true);
    if (canonicalPrds.length) {
      setNotice('Saving reviewed PRD to its project…');
      try {
        materializedAdditions = await Promise.all(additions.map(async (change) => {
          if (!canonicalPrds.includes(change)) return change;
          return { ...change, node: await persistCanonicalProjectPrd(change.node) };
        }));
      } catch (error) {
        setNotice(error instanceof Error ? `Project PRD was not saved: ${error.message}` : 'Project PRD was not saved');
        return;
      }
    }
    setNodes((current) => {
      const next = [...current, ...materializedAdditions.map((change) => change.node)];
      return next
        .filter((node) => !deletedObjectIds.has(node.id))
        .map((node) => updates.reduce((value, change) => value.id === change.objectId ? { ...value, data: { ...value.data, ...change.patch } } : value, node))
        .map((node) => layouts.reduce((value, change) => {
          if (value.id !== change.objectId) return value;
          const locked = change.locked ?? value.data.placementLocked === true;
          return {
            ...value,
            ...(change.position ? { position: change.position } : {}),
            ...(change.hidden != null ? { hidden: change.hidden } : {}),
            draggable: !locked,
            style: { ...value.style, ...(change.width != null ? { width: change.width } : {}), ...(change.height != null ? { height: change.height } : {}) },
            data: { ...value.data, ...(change.hidden != null ? { placementHidden: change.hidden } : {}), ...(change.locked != null ? { placementLocked: change.locked } : {}) },
          };
        }, node));
    });
    setEdges((current) => {
      const reviewed = [...current, ...connectionAdditions.map((change) => change.edge)]
        .filter((edge) => !deletedConnectionIds.has(edge.id) && !deletedObjectIds.has(edge.source) && !deletedObjectIds.has(edge.target))
        .map((edge) => connectionUpdates.reduce((value, change) => value.id === change.connectionId ? { ...value, ...(change.patch.label != null ? { label: change.patch.label } : {}), data: { ...value.data, ...(change.patch.kind ? { connectionKind: change.patch.kind } : {}) } } : value, edge));
      const brain = nodes.find((node) => node.data.kind === 'chat');
      const changedArtifactIds = [...materializedAdditions.map((change) => change.node.id), ...updates.map((change) => change.objectId), ...layouts.map((change) => change.objectId), ...actions.map((change) => change.objectId)];
      return brain && changedArtifactIds.length ? associateBrainWithArtifacts(reviewed, brain.id, changedArtifactIds, 'Changed with Brain') : reviewed;
    });
    if (materializedAdditions.length) setSelectedId(materializedAdditions[materializedAdditions.length - 1]!.node.id);
    else if (selectedId && deletedObjectIds.has(selectedId)) { setSelectedId(null); setSelectedIds([]); }
    if (actions.length) setPendingBrainActions((current) => [...current, ...actions.filter((change) => !deletedObjectIds.has(change.objectId)).map(({ objectId, action }) => ({ objectId, action }))]);
    setProposedChanges([]);
    setAcceptedProposalIds(new Set());
    setNotice(canonicalPrds.length ? `${canonicalPrds.length} project PRD${canonicalPrds.length === 1 ? '' : 's'} saved and ${selected.length} reviewed Brain changes applied` : `${selected.length} reviewed Brain changes applied`);
    trackActivity('creation_change_set_applied', { sessionId, metadata: { clientSurface: 'web', commandCount: selected.length } });
  }, [acceptedProposalIds, nodes, proposedChanges, selectedId, sessionId, setEdges, setNodes]);

  useEffect(() => {
    if (!autoApplyPending || !proposedChanges.length || acceptedProposalIds.size !== proposedChanges.length) return;
    setAutoApplyPending(false);
    void applyProposedChanges();
  }, [acceptedProposalIds.size, applyProposedChanges, autoApplyPending, proposedChanges.length]);

  const applyAndEnableAutoApply = useCallback(() => {
    setAutoApplyMode(true);
    void applyProposedChanges();
  }, [applyProposedChanges, setAutoApplyMode]);

  const rejectProposedChanges = useCallback(() => {
    setProposedChanges([]);
    setAcceptedProposalIds(new Set());
    proposalBuffer.current = [];
    setAutoApplyPending(false);
    setNotice('Brain changes rejected; canvas unchanged');
  }, []);

  const runWorkflow = useCallback((workflowId?: string) => {
    if (!canRun) { setNotice('Runner or owner access is required'); return; }
    const requestedTarget = typeof workflowId === 'string' ? nodes.find((node) => node.id === workflowId && node.data.kind === 'workflow') : null;
    const target = requestedTarget ?? (selectedNode?.data.kind === 'workflow' ? selectedNode : nodes.find((node) => node.data.kind === 'workflow'));
    if (!target) { setNotice('Add a workflow to run it'); return; }
    const targetId = target.id;
    setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running' } } : node));
    const definitionId = target.data.resourceId?.startsWith('workflow:') ? target.data.resourceId.slice('workflow:'.length) : '';
    if (persistence === 'server' && target.data.workflowExecutable === false) {
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: target.data.status } } : node));
      setNotice('This object is a workflow run record. Add or open its Workflow definition to start a new run.');
      return;
    }
    if (persistence === 'server' && definitionId) {
      setNotice('Starting canonical workflow…');
      void workflowDefinitions.get(definitionId).then((definition) => {
        if (!definition.runTargetRuntime) throw new Error('Choose a run target in the Workflow inspector before running it');
        return workflowDefinitions.run(definitionId, {
          runtime: definition.runTargetRuntime,
          agentHostId: definition.runTargetAgentHostId,
          cloudAgentRef: definition.runTargetCloudAgentRef,
        });
      }).then((run) => {
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: run.workflowId, workflowTaskCount: run.taskCount } } : node));
        setNotice(`Workflow started · ${run.taskCount} task${run.taskCount === 1 ? '' : 's'}`);
        const pollRun = (remaining: number) => {
          if (remaining <= 0) return;
          window.setTimeout(() => {
            void workflowDefinitions.runs(definitionId).then((runs) => {
              const currentRun = runs.find((candidate) => candidate.id === run.workflowId);
              if (!currentRun) { pollRun(remaining - 1); return; }
              const normalized = currentRun.status.toLowerCase();
              const terminal = ['completed', 'complete', 'failed', 'cancelled', 'canceled'].includes(normalized);
              const label = normalized === 'completed' || normalized === 'complete' ? 'Complete' : normalized === 'failed' ? 'Run failed' : normalized === 'cancelled' || normalized === 'canceled' ? 'Cancelled' : currentRun.status;
              setNodes((nodesNow) => nodesNow.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: label, workflowRunStatus: currentRun.status, workflowCompletedAt: currentRun.completedAt } } : node));
              if (terminal) setNotice(`Workflow ${label.toLowerCase()}`);
              else pollRun(remaining - 1);
            }).catch(() => pollRun(remaining - 1));
          }, 2_000);
        };
        pollRun(30);
      }).catch((error) => {
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Run failed' } } : node));
        setNotice(error instanceof Error ? error.message : 'Workflow could not be started');
      });
      return;
    }
    setNotice(persistence === 'local' ? 'Draft workflow running locally…' : 'Link a saved Workflow definition before running it');
    if (persistence !== 'local') {
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Draft' } } : node));
      return;
    }
    window.setTimeout(() => {
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Complete' } } : node));
      setNotice('Workflow completed');
    }, 1400);
  }, [canRun, nodes, persistence, selectedNode, setNodes]);

  const saveAgent = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'agent') return;
    const ref = selectedNode.data.resourceId?.startsWith('agent:') ? selectedNode.data.resourceId.slice('agent:'.length) : '';
    if (!ref) { setNotice('This is a canvas draft. Link or create the agent before publishing settings.'); return; }
    setNotice('Saving canonical agent settings…');
    void updateAgent(ref, { name: selectedNode.data.title, title: selectedNode.data.role || selectedNode.data.title, bio: typeof selectedNode.data.instructions === 'string' ? selectedNode.data.instructions : selectedNode.data.subtitle || '', baseModel: selectedNode.data.model || 'gpt-4o' })
      .then(() => setNotice('Agent settings saved everywhere'))
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Agent settings could not be saved'));
  }, [selectedNode]);

  useEffect(() => {
    const pending = pendingBrainActions[0];
    if (!pending) return;
    const target = nodes.find((node) => node.id === pending.objectId);
    if (!target) { setPendingBrainActions((current) => current.slice(1)); return; }
    if (selectedId !== target.id) {
      setSelectedId(target.id);
      setSelectedIds([target.id]);
      return;
    }
    const finish = () => setPendingBrainActions((current) => current.slice(1));
    if (target.data.kind === 'workflow' && pending.action === 'run') runWorkflow();
    else if (target.data.kind === 'dataset' && pending.action === 'visualize') visualizeDataset();
    else if (target.data.kind === 'project' && pending.action === 'expand') expandProject();
    else if (target.data.kind === 'project' && pending.action === 'compare') compareProjects();
    else if (target.data.kind === 'mockupSet' && pending.action === 'expand') expandMockupSet();
    else if ((target.data.kind === 'mockup' || target.data.kind === 'mockupSet') && pending.action === 'deliver') deliverMockup();
    else if (target.data.kind === 'standup' && pending.action === 'start') startStandup();
    else if (target.data.kind === 'evermind' && pending.action === 'train') expandEvermindPipeline();
    else if (target.data.kind === 'evermind' && pending.action === 'evaluate') {
      const evaluation = newNode('evaluation', { x: target.position.x + 560, y: target.position.y });
      evaluation.data = { ...evaluation.data, title: `${target.data.title} evaluation`, status: 'Ready', content: `Evaluate ${target.data.title} against its connected dataset, training evidence, and quality criteria.` };
      setNodes((current) => [...current, evaluation]);
      setEdges((current) => [...current, { id: crypto.randomUUID(), source: target.id, target: evaluation.id, type: 'smoothstep', label: 'evaluates', animated: true }]);
      setNotice('Evermind evaluation added to the canvas');
    } else if (['preview', 'drill', 'play', 'profile'].includes(pending.action)) {
      void flowRef.current?.fitView({ nodes: [{ id: target.id }], padding: .3, duration: 350 });
      setNotice(`${target.data.title} ready to ${pending.action}`);
    } else if (pending.action === 'publish' && ['website', 'evermind'].includes(target.data.kind)) {
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: persistence === 'local' ? 'Publish-ready draft' : 'Publish requested' } } : node));
      setNotice(persistence === 'local' ? 'Save the session to publish this artifact' : `${target.data.title} is ready for its canonical publish step`);
    } else {
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: `${pending.action} requested` } } : node));
      setNotice(`${pending.action} is ready in the ${creationObjectDefinition(target.data.kind).label} inspector`);
    }
    finish();
  }, [compareProjects, deliverMockup, expandEvermindPipeline, expandMockupSet, expandProject, nodes, pendingBrainActions, persistence, runWorkflow, selectedId, setEdges, setNodes, startStandup, visualizeDataset]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    if (persistence !== 'server') return;
    void creationSessionsApi.history.list(sessionId).then((result) => setHistory(result.snapshots))
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load history'));
  }, [persistence, sessionId]);

  const restoreRevision = useCallback((targetRevision: number) => {
    if (!canEdit || persistence !== 'server') return;
    setNotice(`Restoring revision ${targetRevision}…`);
    void creationSessionsApi.history.get(sessionId, targetRevision).then((snapshot) => {
      const restored = flowFromSnapshotGraph(snapshot.graph);
      setNodes(restored.nodes);
      setEdges(restored.edges);
      setHistoryOpen(false);
      setNotice(`Revision ${targetRevision} restored; saving as a new revision…`);
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not restore revision'));
  }, [canEdit, persistence, sessionId, setEdges, setNodes]);

  const createCheckpoint = useCallback(() => {
    if (persistence !== 'server' || !canEdit) return;
    const label = window.prompt('Name this checkpoint')?.trim(); if (!label) return;
    void creationSessionsApi.history.checkpoint(sessionId, label).then(() => {
      setNotice(`Checkpoint “${label}” saved`);
      return creationSessionsApi.history.list(sessionId);
    }).then((result) => setHistory(result.snapshots)).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not save checkpoint'));
  }, [canEdit, persistence, sessionId]);

  const exportSession = useCallback(() => {
    const filename = `${safeDownloadName(title)}.builderforce-canvas.json`;
    setNotice('Preparing Canvas export…');
    if (persistence === 'local') {
      downloadJson({
        format: 'builderforce.creation-session.v1', exportedAt: new Date().toISOString(),
        session: { id: sessionId, title, persistence: 'local' }, nodes, edges, timeline,
        viewport: flowRef.current?.getViewport() ?? viewportRef.current,
      }, filename);
      setNotice('Canvas export downloaded');
      return;
    }
    void creationSessionsApi.export(sessionId).then((payload) => {
      downloadJson(payload, filename);
      setNotice('Canvas export downloaded');
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Canvas export failed'));
  }, [edges, nodes, persistence, sessionId, timeline, title]);

  const minimapColor = useCallback((node: CreationFlowNode) => {
    const colors: Partial<Record<CreationObjectKind, string>> = { workflow: '#7357ed', website: '#3978f6', dashboard: '#08b59d', agent: '#8a5cf5', staff: '#f09a3e', evaluation: '#6941d7', evermind: '#df4fa5', projectComparison: '#0d8f82' };
    return colors[node.data.kind] ?? '#9aa8bd';
  }, []);
  const renderedNodes = useMemo(() => nodes.map((node) => node.data.placementHidden === true ? { ...node, hidden: !showHidden, style: showHidden ? { ...node.style, opacity: .42 } : node.style } : node), [nodes, showHidden]);
  const canvasNodeTypes = useMemo<NodeTypes>(() => ({
    creation: (props) => <CreationNode {...props} canRun={canRun} onRun={(nodeId) => runWorkflow(nodeId)} />,
  }), [canRun, runWorkflow]);
  const buildDiagnostics = useCallback(async () => buildCreationCanvasDiagnosticsReport({
    sessionId, title, persistence, role: sessionRole, revision: revision.current, realtimeState,
    objectCount: nodes.length, connectionCount: edges.length,
    objectKinds: nodes.reduce<Record<string, number>>((counts, node) => ({ ...counts, [node.data.kind]: (counts[node.data.kind] || 0) + 1 }), {}),
    selectedObjectIds: effectiveSelectedIds,
    hiddenObjectCount: nodes.filter((node) => node.data.placementHidden === true).length,
    lockedObjectCount: nodes.filter((node) => node.data.placementLocked === true).length,
    redactedObjectCount: nodes.filter((node) => node.data.redacted === true).length,
    canonicalResourceCount: nodes.filter((node) => !!node.data.resourceId).length,
    memberCount: persistence === 'local' ? 1 : allMembers.length,
    pendingInvitationCount: pendingInvitations.length,
    timeline: timeline.map((message) => ({ role: message.messageRole === 'assistant' ? 'Brain' : message.messageRole, body: message.body, createdAt: message.createdAt })),
    brain: { scope: resolvedScopeMode, thinking, proposedChangeCount: proposedChanges.length, actionCount: canvasActions.length },
  }, await captureDiagnosticsContext()), [allMembers.length, canvasActions.length, edges.length, effectiveSelectedIds, nodes, pendingInvitations.length, persistence, proposedChanges.length, realtimeState, resolvedScopeMode, sessionId, sessionRole, thinking, timeline, title]);

  return (
    <div className={`${styles.canvasShell} app-full-height`}>
      <div className={styles.sessionBar}>
        <div className={styles.titleBlock}><span className={styles.spark}>✦</span><input aria-label={t('sessionTitle')} value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (persistence === 'server') void creationSessionsApi.update(sessionId, { title }).then(() => setNotice(t('saved'))).catch(() => setNotice('Title save failed')); }} /><span className={styles.saved}>{notice}</span>{persistence === 'server' && <span role="status" aria-live="polite" className={styles.realtimeStatus} data-state={realtimeState}>{realtimeState === 'online' ? t('live') : realtimeState === 'offline' ? t('offlineRetry') : realtimeState === 'reconnecting' ? t('reconnecting') : t('connecting')}</span>}</div>
        <div className={styles.sessionActions}>
          <div className={styles.collaborators} aria-label="Active collaborators">
            {(persistence === 'local' ? [{ userId: 'local', displayName: 'You', role: 'owner' as const }] : members).slice(0, 4).map((member, index) => <button key={member.userId} type="button" aria-pressed={followingUserId === member.userId} title={`${member.displayName || 'Collaborator'} · ${member.role}${member.userId !== currentUserId ? ' · click to follow viewport' : ''}`} onClick={() => { if (member.userId !== currentUserId && member.userId !== 'local') setFollowingUserId((current) => current === member.userId ? null : member.userId); }} className={[styles.avatarPink, styles.avatarOrange, styles.avatarGreen][index % 3]}>{(member.displayName || 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</button>)}
            <button aria-label="Invite collaborator" onClick={() => persistence === 'local' ? requireAccount('invite', 'Create an account to invite collaborators', 'Your canvas will be saved securely so teammates can join the same live session with roles, comments, and presence.') : setShareOpen(true)}>+</button>
          </div>
          <button className={styles.secondaryButton} onClick={undo} aria-label="Undo canvas change">↶</button>
          <button className={styles.secondaryButton} onClick={redo} aria-label="Redo canvas change">↷</button>
          <button className={`${styles.secondaryButton} ${styles.mobileAction}`} aria-label={t('openDiagnostics')} onClick={() => setDiagnosticsOpen((value) => !value)}>⚠ <span>{t('diagnostics')}</span></button>
          <button className={`${styles.secondaryButton} ${styles.mobileAction}`} aria-expanded={moreOpen} aria-label={t('moreActions')} onClick={() => { setMoreOpen((value) => !value); setShareOpen(false); }}>•••</button>
          <button className={styles.secondaryButton} onClick={() => { if (persistence === 'local') requireAccount('share', 'Create an account to share this canvas', 'Your work is already safe on this device. An account saves it to your tenant and enables live collaboration, invitations, and access controls.'); else setShareOpen((value) => !value); setMoreOpen(false); }}>{t('share')} ▾</button>
          {persistence === 'local' && <button className={styles.primaryButton} onClick={() => requireAccount('save', 'Create an account to save and collaborate', 'Move this local session into a secure tenant workspace without losing its objects, conversation, or layout.')}>{t('saveCollaborate')}</button>}
          {moreOpen && <div className={styles.moreMenu} aria-label={t('moreActions')}>
            <span className={styles.moreMenuHeading}>{t('createAndView')}</span>
            <button onClick={() => { setTemplateOpen(true); setMoreOpen(false); }}><span aria-hidden>▦</span>{t('templates')}</button>
            <button onClick={() => { setConversationOpen((value) => !value); setMoreOpen(false); }}><span aria-hidden>◌</span>{t('conversation')}</button>
            <button aria-pressed={drawingMode} onClick={() => { setDrawingMode((value) => !value); setMoreOpen(false); }}><span aria-hidden>⌁</span>{drawingMode ? t('stopDrawing') : t('draw')}</button>
            <button onClick={() => { setPresentMode((value) => !value); setMoreOpen(false); }}><span aria-hidden>▶</span>{presentMode ? t('exitPresentation') : t('present')}</button>
            <span className={styles.moreMenuHeading}>{t('sessionTools')}</span>
            <button onClick={() => { openHistory(); setMoreOpen(false); }}><span aria-hidden>↶</span>{t('history')}</button>
            <button onClick={() => { exportSession(); setMoreOpen(false); }}><span aria-hidden>↓</span>{t('exportCanvas')}</button>
            <button onClick={() => { setTourStep(1); setMoreOpen(false); }}><span aria-hidden>?</span>{t('tutorial')}</button>
            <button onClick={() => { setShowHidden((value) => !value); setMoreOpen(false); }}><span aria-hidden>◉</span>{showHidden ? t('hideHidden') : t('showHidden')}</button>
            <button onClick={() => { createBranch(); setMoreOpen(false); }}><span aria-hidden>⑂</span>{t('branch')}</button>
            {branchParentId && <button onClick={() => { prepareMerge(); setMoreOpen(false); }}><span aria-hidden>⇄</span>{t('merge')}</button>}
            <label><span><i aria-hidden>⌁</i>{t('edge')}</span><select aria-label="Connection kind" value={connectionKind} onChange={(event) => setConnectionKind(event.target.value as CreationConnectionKind)}>{CREATION_CONNECTION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          </div>}
          {shareOpen && <div className={styles.shareMenu} role="dialog" aria-label={persistence === 'local' ? 'Save to invite people' : 'Invite collaborators'}>
            <div className={styles.shareMenuHeader}>
              <strong>{persistence === 'local' ? 'Save to invite people' : 'Invite collaborators'}</strong>
              <button type="button" className={styles.shareMenuClose} aria-label="Close invitation panel" onClick={() => setShareOpen(false)}>×</button>
            </div>
            <p>{persistence === 'local' ? 'Your work is safe on this device. Create a free account when you want live collaboration or delivery.' : 'Anyone invited can build with you and ask Brain questions.'}</p>
            {persistence === 'local' ? <button onClick={() => requireAccount('save', 'Create an account to save this session', 'Move this local session into a secure tenant workspace without losing its objects, conversation, or layout.')}>Create free account</button> : <>
              <div><input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" /><select aria-label="Invitation role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as CreationSessionSummary['role'])}><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option><option value="runner">Runner</option><option value="owner">Owner</option></select><button disabled={!inviteEmail.trim()} onClick={() => { void creationSessionsApi.invite(sessionId, { email: inviteEmail.trim() }, inviteRole).then(async (result) => { if ('acceptPath' in result) { await copyTextToClipboard(`${window.location.origin}${result.acceptPath}`); setPendingInvitations((current) => [...current.filter((item) => item.id !== result.invitationId), { id: result.invitationId, email: result.email, role: result.role as CreationSessionSummary['role'], expiresAt: result.expiresAt, acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString() }]); setNotice(result.emailSent ? 'Invitation emailed and backup link copied' : 'Invitation saved; backup link copied (email delivery is not configured)'); } else { const detail = await creationSessionsApi.get(sessionId); setAllMembers(detail.members); setNotice(result.emailSent ? 'Collaborator invited by email' : 'Collaborator invited in Builderforce'); } setInviteEmail(''); }).catch((error) => setNotice(error instanceof Error ? error.message : 'Invite failed')); }}>Invite</button></div>
              {sessionRole === 'owner' && <div aria-label="Session members">{allMembers.map((member) => <div key={member.userId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span>{member.displayName || 'Collaborator'}{member.userId === currentUserId ? ' (you)' : ''}</span>
                <select aria-label={`Role for ${member.displayName || member.userId}`} value={member.role} onChange={(event) => { const role = event.target.value as CreationSessionSummary['role']; void creationSessionsApi.members.update(sessionId, member.userId, role).then(() => setAllMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item))).catch((error) => setNotice(error instanceof Error ? error.message : 'Role update failed')); }}><option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option><option value="runner">Runner</option><option value="owner">Owner</option></select>
                <button type="button" disabled={member.userId === currentUserId} aria-label={`Remove ${member.displayName || 'member'}`} onClick={() => { void creationSessionsApi.members.remove(sessionId, member.userId).then(() => setAllMembers((current) => current.filter((item) => item.userId !== member.userId))).catch((error) => setNotice(error instanceof Error ? error.message : 'Member removal failed')); }}>×</button>
              </div>)}{!!pendingInvitations.length && <div aria-label="Pending invitations" style={{ marginTop: 10 }}><strong>Pending invitations</strong>{pendingInvitations.map((invitation) => <div key={invitation.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span>{invitation.email}</span><small>{invitation.role}</small><button type="button" aria-label={`Revoke invitation for ${invitation.email}`} onClick={() => { void creationSessionsApi.invitations.revoke(sessionId, invitation.id).then(() => { setPendingInvitations((current) => current.filter((item) => item.id !== invitation.id)); setNotice('Invitation revoked'); }).catch((error) => setNotice(error instanceof Error ? error.message : 'Invitation could not be revoked')); }}>×</button>
              </div>)}</div>}</div>}
            </>}
            <small>Access: {persistence === 'local' ? 'Private on this device' : inviteRole}</small>
          </div>}
          {templateOpen && <div className={styles.templateMenu}>
            <header><div><strong>{t('canvasTemplates')}</strong><small>{t('marketplacePacks')}</small></div><button onClick={() => setTemplateOpen(false)} aria-label="Close templates">×</button></header>
            {CREATION_TEMPLATES.map((template) => <button key={template.id} onClick={() => applyTemplate(template)}><b>{template.name}</b><small>{template.category} · {template.objects.length} objects</small><span>{template.description}</span></button>)}
            {!!serverTemplates.length && <><h4>{t('savedAccount')}</h4>{serverTemplates.map((template) => <button key={template.id} onClick={() => applyServerTemplate(template)}><b>{template.name}</b><small>{template.visibility === 'tenant' ? 'Shared with tenant' : 'Private'} · {template.category}</small><span>{template.description}</span></button>)}</>}
            {!!framePresets.length && <><h4>{t('reusableFrames')}</h4>{framePresets.map((preset) => <button key={preset.id} onClick={() => addFramePreset(preset)}><b>{preset.name}</b><small><span>Private custom frame</span> · this device</small></button>)}</>}
          </div>}
        </div>
      </div>

      {accountGate && <div className={styles.accountGateBackdrop} role="presentation">
        <section className={styles.accountGate} role="dialog" aria-modal="true" aria-labelledby="canvas-account-gate-title">
          <button type="button" className={styles.accountGateClose} aria-label="Close account prompt" onClick={() => setAccountGate(null)}>×</button>
          <span className={styles.accountGateIcon} aria-hidden>✦</span>
          <small>Keep your momentum</small>
          <h2 id="canvas-account-gate-title">{accountGate.title}</h2>
          <p>{accountGate.description}</p>
          <div className={styles.accountGateBenefits}><span>✓ Keep this entire local session</span><span>✓ Unlock durable resources and history</span><span>✓ Collaborate with your team</span></div>
          <div className={styles.accountGateActions}>
            <button type="button" className={styles.primaryButton} onClick={() => { trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: 'web', action: accountGate.action } }); window.location.href = `/register?next=${encodeURIComponent(`/create/${sessionId}`)}`; }}>Create free account</button>
            <button type="button" className={styles.secondaryButton} onClick={() => { window.location.href = `/login?next=${encodeURIComponent(`/create/${sessionId}`)}`; }}>Sign in</button>
          </div>
          <button type="button" className={styles.accountGateLater} onClick={() => setAccountGate(null)}>Not now — keep creating locally</button>
        </section>
      </div>}

      <div ref={flowWrapRef} className={styles.flowWrap} data-cursor-mode={drawingMode ? 'draw' : 'pan'} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={() => { cursorRef.current = null; drawingPoints.current = []; }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        {!presentMode && effectiveSelectedIds.length > 0 && <div className={styles.selectionToolbar} aria-label={t('selectionActions')}>
          <span>{t('selectedCount', { count: effectiveSelectedIds.length })}</span>
          <button onClick={focusSelection}>{t('focus')}</button>
          <button onClick={duplicateSelection} disabled={!canEdit}>{t('duplicate')}</button>
          {effectiveSelectedIds.length > 1 && <button onClick={alignSelection} disabled={!canEdit}>{t('align')}</button>}
          {effectiveSelectedIds.length > 1 && <button onClick={frameSelection} disabled={!canEdit}>{t('frame')}</button>}
          <button onClick={togglePlacementLock} disabled={!canEdit}>{effectiveSelectedIds.some((id) => nodes.find((node) => node.id === id)?.data.placementLocked !== true) ? t('lock') : t('unlock')}</button>
          <button onClick={toggleHidden} disabled={!canEdit}>{t('hide')}</button>
        </div>}
        {loadingSession && <div className={styles.canvasSkeleton} role="status" aria-live="polite"><span /><span /><span /><b>Loading session…</b></div>}
        {nodes.length > 100 && <div className={styles.performanceNotice} role="status"><strong>{t('largeSession', { count: nodes.length })}</strong><span>Only visible Objects are rendered. Use frames or hide heavy Objects to keep navigation fast.</span><button type="button" onClick={openPalette}>{t('frame')}</button></div>}
        {tourStep > 0 && <div style={{ position: 'absolute', zIndex: 30, top: 18, left: '50%', transform: 'translateX(-50%)', width: 'min(430px, calc(100% - 32px))', padding: 16, borderRadius: 14, background: 'var(--bg-elevated, white)', boxShadow: '0 14px 44px rgba(25,40,70,.22)', border: '1px solid var(--border-subtle)' }}>
          <strong>{['', 'Ask Brain from the composer', 'Everything is an object', 'Select to focus Brain', 'Connect ideas explicitly', 'Build with collaborators', 'Deliver when you are ready'][tourStep]}</strong>
          <p style={{ margin: '7px 0 12px', color: 'var(--text-secondary)', fontSize: 13 }}>{['', 'The familiar prompt stays at the bottom and can create or evaluate anything in this session.', 'Drag workflows, sites, data, agents, people, and project context from the palette.', 'Select one object for a focused question, or click the background to evaluate the complete session.', 'Connect two objects to define a real data, control, reference, presentation, or delivery relationship.', 'Share the session, comment on objects, and see live cursors without moving anyone else’s viewport.', 'Projects are optional. Add one only when you want to turn an artifact into a Task and assign an Agent.'][tourStep]}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><small>{tourStep} of 6</small><span style={{ display: 'flex', gap: 7 }}><button className={styles.secondaryButton} onClick={() => { localStorage.setItem(tourStorageKey, '1'); setTourStep(0); }}>Dismiss</button><button className={styles.primaryButton} onClick={() => { trackActivity('creation_tutorial_step_completed', { sessionId, metadata: { clientSurface: 'web', step: tourStep } }); if (tourStep < 6) setTourStep((step) => step + 1); else { localStorage.setItem(tourStorageKey, '1'); setTourStep(0); } }}>{tourStep < 6 ? 'Next' : 'Start creating'}</button></span></div>
        </div>}
        <ReactFlow<CreationFlowNode, Edge>
          nodes={renderedNodes}
          edges={edges}
          nodeTypes={canvasNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          onPaneClick={clearSelection}
          onMoveEnd={onViewportChange}
          onInit={(instance) => { flowRef.current = instance; if (pendingViewport.current) void instance.setViewport(pendingViewport.current); }}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.35}
          maxZoom={1.6}
          defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#7b8aa0', strokeWidth: 1.5 } }}
          nodesDraggable={canEdit && !drawingMode}
          nodesConnectable={canEdit && !drawingMode}
          elementsSelectable
          deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
          selectionOnDrag
          multiSelectionKeyCode={['Meta', 'Control']}
          proOptions={{ hideAttribution: true }}
          onlyRenderVisibleElements
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--creation-dot, #c9d8ea)" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap position="bottom-right" nodeColor={minimapColor} maskColor="var(--creation-minimap-mask, rgba(244,248,253,.72))" pannable zoomable />
        </ReactFlow>

        <RemoteCursors members={members} currentUserId={currentUserId} instance={flowRef.current} container={flowWrapRef.current} />
        <details className={styles.structuredGraph}><summary>Accessible canvas outline</summary><ol>{nodes.map((node) => <li key={node.id}><button aria-label={`Focus ${node.data.title}`} onClick={() => { setSelectedId(node.id); setSelectedIds([node.id]); }}>{node.data.title} ({node.data.kind})</button><span>{node.data.status || 'Canvas object'}{node.data.placementLocked === true ? ' · placement locked' : ''}</span><ul>{edges.filter((edge) => edge.source === node.id).map((edge) => <li key={edge.id}>{String(edge.data?.connectionKind || 'reference')} connection to {nodes.find((target) => target.id === edge.target)?.data.title || 'object'}{edge.label ? `: ${String(edge.label)}` : ''}</li>)}</ul></li>)}</ol></details>

        {!presentMode && <button className={styles.paletteToggle} onClick={() => setPaletteOpen((value) => !value)} aria-label="Toggle object palette">{paletteOpen ? '‹' : '+'}</button>}
        {!presentMode && paletteOpen && <aside id="canvas-object-palette" className={styles.palette}>
          <div className={styles.paletteHeader}><strong>{t('addToCanvas')}</strong><button onClick={() => setPaletteOpen(false)} aria-label="Close palette">×</button></div>
          <div className={styles.paletteSearchWrap}><span aria-hidden>⌕</span><input ref={paletteSearchRef} className={styles.search} aria-label={t('searchEverything')} value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder={t('searchEverything')} />{paletteSearch && <button type="button" aria-label={t('clearSearch')} onClick={() => setPaletteSearch('')}>×</button>}</div>
          <div className={styles.paletteSections}>{CREATION_PALETTE_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => `${t(`object.${item.kind}`)} ${item.group} ${item.kind}`.toLowerCase().includes(paletteSearch.trim().toLowerCase())) })).filter((group) => group.items.length).map((group) => {
            const collapsed = !paletteSearch.trim() && collapsedPaletteGroups.has(group.group);
            const regionId = `canvas-palette-${group.group.toLowerCase()}`;
            return <section key={group.group} className={styles.paletteSection}>
              <button type="button" className={styles.paletteSectionToggle} aria-expanded={!collapsed} aria-controls={regionId} onClick={() => setCollapsedPaletteGroups((current) => { const next = new Set(current); if (next.has(group.group)) next.delete(group.group); else next.add(group.group); return next; })}>
                <span className={styles.paletteGroupIcon} aria-hidden>{PALETTE_GROUP_ICONS[group.group]}</span><strong>{group.group}</strong><small>{group.items.length}</small><span className={styles.paletteChevron} aria-hidden>{collapsed ? '›' : '⌄'}</span>
              </button>
              {!collapsed && <div id={regionId} className={styles.paletteGrid}>{group.items.map((item) => <button key={item.kind} aria-label={t(`object.${item.kind}`)} disabled={!canEdit} draggable={canEdit} onDragStart={(event) => { event.dataTransfer.setData(DND_MIME, item.kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addAtCenter(item.kind)}><span>{item.icon}</span>{t(`object.${item.kind}`)}</button>)}</div>}
            </section>;
          })}</div>
        </aside>}

        {!presentMode && selectedNode && <Inspector node={selectedNode} nodes={nodes} edges={edges} timeline={timeline} brainTrace={brainTrace} sessionId={sessionId} persistence={persistence} role={sessionRole} editable={canEdit && !lockBlocked} members={members} onChange={updateSelected} onWebsiteViewportChange={updateWebsiteViewport} onClose={() => setSelectedId(null)} onRun={runWorkflow} onEditWorkflow={() => setWorkflowFocus({ nodeId: selectedNode.id, definitionId: selectedNode.data.resourceId?.startsWith('workflow:') ? selectedNode.data.resourceId.slice('workflow:'.length) : null })} onSaveAgent={saveAgent} onSaveFramePreset={saveFramePreset} onExpandProject={expandProject} onLoadProjectQuality={loadProjectQuality} onCompareProjects={compareProjects} onDeliverMockup={deliverMockup} onExpandMockupSet={expandMockupSet} onImportDataset={importDataset} onVisualizeDataset={visualizeDataset} onAttachEvermindProject={attachEvermindProject} onExpandEvermindPipeline={expandEvermindPipeline} onStartStandup={startStandup} />}

        {workflowFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label="Workflow focus editor">
          <header><div><strong>Edit Workflow on Canvas</strong><small>Changes save to the canonical Workflow definition.</small></div><button type="button" onClick={() => setWorkflowFocus(null)} aria-label="Close workflow editor">×</button></header>
          <div className={styles.workflowFocusBody}><ReactFlowProvider><WorkflowBuilder definitionId={workflowFocus.definitionId} embedded onSaved={(definitionId, name) => { setWorkflowFocus((current) => current ? { ...current, definitionId } : current); setNodes((current) => current.map((node) => node.id === workflowFocus.nodeId ? { ...node, data: { ...node.data, title: name, resourceId: `workflow:${definitionId}`, workflowExecutable: true, resourceSubtype: 'definition', status: 'Saved' } } : node)); setNotice('Workflow saved from this Session'); }} onRunStarted={(workflowId) => { setNodes((current) => current.map((node) => node.id === workflowFocus.nodeId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: workflowId } } : node)); setNotice(`Workflow run ${workflowId} started`); }} /></ReactFlowProvider></div>
        </section>}

        {historyOpen && <aside className={styles.historyPanel}><header><div><strong>Version history</strong><small>Restore creates a new revision</small></div><button onClick={() => setHistoryOpen(false)} aria-label="Close history">×</button></header>{persistence === 'local' ? <p>This session is currently stored on this device. Server version history begins after you save it.</p> : <><button className={styles.primaryButton} onClick={createCheckpoint} disabled={!canEdit}>+ Name current checkpoint</button><div>{history.length ? history.map((snapshot) => <button key={snapshot.revision} onClick={() => restoreRevision(snapshot.revision)} disabled={!canEdit}><b>{snapshot.label || `Revision ${snapshot.revision}`}</b><span>Revision {snapshot.revision} · {new Date(snapshot.createdAt).toLocaleString()}</span></button>) : <p>No saved revisions yet.</p>}</div></>}</aside>}
        {conversationOpen && <aside className={styles.historyPanel} aria-label="Session conversation"><header><div><strong>Session conversation</strong><small>Persists even when Chat Objects are removed</small></div><span className={styles.panelHeaderActions}><CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyChatDiagnostics')} getText={buildDiagnostics} /><button onClick={() => setConversationOpen(false)} aria-label="Close conversation">×</button></span></header><div>{timeline.length ? timeline.map((message) => <article key={message.clientMessageId} style={{ padding: '9px 10px', borderBottom: '1px solid var(--border-subtle)' }}><strong style={{ textTransform: 'capitalize' }}>{message.messageRole === 'assistant' ? 'Brain' : message.messageRole}</strong><p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{message.body}</p><small>{new Date(message.createdAt).toLocaleString()}</small></article>) : <p>No conversation yet. Ask Brain from the composer to begin.</p>}</div></aside>}
        {diagnosticsOpen && <aside className={`${styles.historyPanel} ${styles.diagnosticsPanel}`} aria-label="Canvas diagnostics"><header><div><strong>{t('diagnostics')}</strong><small>{t('diagnosticsHint')}</small></div><button onClick={() => setDiagnosticsOpen(false)} aria-label="Close diagnostics">×</button></header><div className={styles.diagnosticsSummary}><dl><div><dt>Session</dt><dd>{persistence} · revision {revision.current}</dd></div><div><dt>Realtime</dt><dd>{realtimeState}</dd></div><div><dt>Canvas</dt><dd>{nodes.length} objects · {edges.length} connections</dd></div><div><dt>Brain</dt><dd>{thinking ? 'responding' : 'ready'} · {canvasActions.length} actions</dd></div><div><dt>Scope</dt><dd>{resolvedScopeMode}</dd></div><div><dt>Access</dt><dd>{sessionRole}</dd></div></dl><CopyButton label={t('copyDiagnostics')} ariaLabel={t('copyCanvasDiagnostics')} getText={buildDiagnostics} /></div></aside>}

        {!!proposedChanges.length && <aside className={styles.changeSetPanel}><header><div><strong>Review Brain changes</strong><small>Select exactly what should change</small></div><button onClick={rejectProposedChanges} aria-label="Close change set">×</button></header><div>{proposedChanges.map((change) => <label key={change.id}><input type="checkbox" checked={acceptedProposalIds.has(change.id)} onChange={() => setAcceptedProposalIds((current) => { const next = new Set(current); if (next.has(change.id)) next.delete(change.id); else next.add(change.id); return next; })} /><span><b>{change.label}</b><small>{change.type.replace('.', ' ')}</small></span></label>)}</div><footer><button className={styles.secondaryButton} onClick={rejectProposedChanges}>Reject all</button><button className={styles.secondaryButton} disabled={!acceptedProposalIds.size} onClick={applyAndEnableAutoApply} title="Apply this batch and automatically apply following Brain actions">Apply &amp; auto-apply</button><button className={styles.primaryButton} disabled={!acceptedProposalIds.size} onClick={applyProposedChanges}>Apply {acceptedProposalIds.size} selected</button></footer></aside>}
        {mergeReview && <aside className={styles.mergePanel}><header><div><strong>Merge branch into parent</strong><p>Resolve each object explicitly. Parent-only objects are preserved.</p></div><button onClick={() => setMergeReview(null)} aria-label="Close merge review">×</button></header>{mergeReview.items.map((item) => <label key={item.key}><b>{item.source.data.title}</b><small>{item.target ? `Both sessions contain this ${item.source.data.kind}.` : `New ${item.source.data.kind} from this branch.`}</small>{item.target && <span><select aria-label={`Merge choice for ${item.source.data.title}`} value={item.choice} onChange={(event) => setMergeReview((current) => current ? { ...current, items: current.items.map((candidate) => candidate.key === item.key ? { ...candidate, choice: event.target.value as 'branch' | 'parent' } : candidate) } : current)}><option value="branch">Use branch version</option><option value="parent">Keep parent version</option></select></span>}</label>)}<button className={styles.primaryButton} onClick={applyMerge}>Apply reviewed merge</button></aside>}

        {!presentMode && <form ref={composerFormRef} className={styles.composer} onSubmit={evaluateCanvas}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} aria-label={t('askBrain')} placeholder={t('askBrain')} rows={1} />
          <div className={styles.composerBottom}><button type="button" className={styles.iconButton} onClick={openPalette} aria-label={t('addToCanvas')}>＋</button><label className={styles.scopeChip}>⌁ <span className="sr-only">Brain scope</span><select aria-label="Brain scope" value={scopeMode} onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)}><option value="auto">{scopeLabel}</option><option value="canvas">Entire canvas</option><option value="selection" disabled={!effectiveSelectedIds.length}>{effectiveSelectedIds.length > 1 ? `${effectiveSelectedIds.length} selected objects` : 'Selected object'}</option><option value="connected" disabled={!effectiveSelectedIds.length}>Connected objects</option><option value="frame" disabled={selectedNode?.data.kind !== 'frame'}>Current frame</option></select></label><label className={styles.scopeChip}>◉ <span className="sr-only">LLM routing</span><select aria-label="LLM routing" value={modelSelection.mode === 'model' ? `model:${modelSelection.model}` : modelSelection.mode} onChange={(event) => { const value = event.target.value; setModelSelection(value === 'auto' ? { mode: 'auto' } : value === 'byo_pool' ? { mode: 'byo_pool' } : { mode: 'model', model: value.slice('model:'.length) }); }}><option value="auto">Auto</option>{llmModels.byoProviders.length > 0 && <option value="byo_pool">Pool (BYO order)</option>}{canvasModelChoices.map((choice) => <option key={choice.id} value={`model:${choice.id}`}>{choice.label}</option>)}</select></label><button type="button" className={`${styles.autoApplyButton} ${autoApply ? styles.autoApplyButtonActive : ''}`} aria-pressed={autoApply} title="Automatically apply Brain actions without showing the review batch" onClick={() => setAutoApplyMode(!autoApply)}><span aria-hidden>⚡</span> Auto apply</button><button type="button" className={`${styles.memoryButton} ${memoryEnabled ? styles.memoryButtonActive : ''}`} aria-pressed={memoryEnabled} disabled={evermindProjectId == null || persistence !== 'server'} title={evermindProjectId == null ? 'Add a saved Project to connect its Evermind' : memoryEnabled ? 'Evermind recall and learning are enabled' : 'Evermind is disabled for this canvas chat'} onClick={() => setMemoryMode(!memoryEnabled)}><span aria-hidden>🧠</span> Memory</button><span className={styles.composerSpacer} /><button type="button" className={styles.iconButton} aria-label="Use microphone" title="Use microphone" onClick={startVoiceInput}><svg className={styles.microphoneIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M6 11.5v.5a6 6 0 0 0 12 0v-.5M12 18v3M9 21h6" /></svg></button><button className={styles.sendButton} aria-label={t('sendBrain')} disabled={thinking || !prompt.trim()}>{thinking ? '•••' : '➤'}</button></div>
        </form>}
      </div>
    </div>
  );
}

function RemoteCursors({ members, currentUserId, instance, container }: { members: CreationSessionDetail['members']; currentUserId: string | null; instance: ReactFlowInstance<CreationFlowNode, Edge> | null; container: HTMLDivElement | null }) {
  if (!instance || !container) return null;
  const rect = container.getBoundingClientRect();
  return <div className={styles.remoteCursors} aria-live="polite">{members.filter((member) => member.userId !== currentUserId && typeof member.cursor?.x === 'number' && typeof member.cursor?.y === 'number').map((member, index) => {
    const screen = instance.flowToScreenPosition({ x: member.cursor!.x!, y: member.cursor!.y! });
    return <span key={member.userId} style={{ left: screen.x - rect.left, top: screen.y - rect.top, color: ['#d946ef', '#f97316', '#059669', '#2563eb'][index % 4] }}><i>◢</i><b>{member.displayName || 'Collaborator'}{member.typing ? ' · typing…' : ''}</b></span>;
  })}</div>;
}

function BrainObjectDetails({ node, nodes, edges, timeline, trace }: { node: CreationFlowNode; nodes: CreationFlowNode[]; edges: Edge[]; timeline: CanvasTimelineMessage[]; trace: BrainTraceEvent[] }) {
  const messages = timeline.length ? timeline : Array.isArray(node.data.messages) ? node.data.messages.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const message = value as Record<string, unknown>;
    if (typeof message.content !== 'string') return [];
    return [{
      clientMessageId: `${message.createdAt || 'message'}:${message.role || 'assistant'}:${message.content}`,
      messageRole: message.role === 'user' || message.role === 'system' ? message.role : 'assistant',
      body: message.content,
      createdAt: typeof message.createdAt === 'string' ? message.createdAt : '',
    } satisfies CanvasTimelineMessage];
  }) : [];
  const connectedIds = new Set(edges.flatMap((edge) => edge.source === node.id ? [edge.target] : edge.target === node.id ? [edge.source] : []));
  const connected = nodes.filter((candidate) => candidate.id !== node.id && connectedIds.has(candidate.id));
  const agents = connected.filter((candidate) => candidate.data.kind === 'agent');
  const tickets = connected.filter((candidate) => candidate.data.kind === 'task');
  const related = connected.filter((candidate) => candidate.data.kind !== 'agent' && candidate.data.kind !== 'task');
  const canonicalChatId = node.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
  const connectedProjectId = connected.find((candidate) => candidate.data.kind === 'project')?.data.resourceId?.match(/^project:(\d+)$/)?.[1];
  const timelineMessages: BrainMessage[] = messages.map((message, index) => ({
    id: index + 1,
    seq: index + 1,
    role: message.messageRole,
    content: message.body,
    metadata: null,
    createdAt: message.createdAt,
  }));
  const visibleTrace = trace.length ? trace : Array.isArray(node.data.trace) ? node.data.trace.filter((value): value is BrainTraceEvent => !!value && typeof value === 'object' && typeof (value as { ts?: unknown }).ts === 'string' && typeof (value as { category?: unknown }).category === 'string' && typeof (value as { label?: unknown }).label === 'string') : [];
  const roster = (items: CreationFlowNode[], empty: string) => items.length ? <div className={styles.brainAssociationList}>{items.map((item) => <div key={item.id}><span aria-hidden>{creationObjectDefinition(item.data.kind).icon}</span><p><b>{item.data.title}</b><small>{item.data.status || creationObjectDefinition(item.data.kind).label}</small></p></div>)}</div> : <p className={styles.brainEmpty}>{empty}</p>;

  return <div className={styles.brainDetails}>
    <section aria-labelledby="brain-conversation-heading">
      <div className={styles.brainSectionHeading}><h3 id="brain-conversation-heading">Conversation</h3><span>{messages.length}</span></div>
      <div className={styles.brainInspectorTimeline} role="log" aria-label="Full Brain activity" tabIndex={0}>
        <BrainTimeline messages={timelineMessages} trace={visibleTrace} streamingText="" isRunning={false} assistantName="Brain" labels={{ you: 'You', assistant: 'Brain', empty: 'No conversation yet. Ask Brain from the canvas prompt to begin.' }} />
      </div>
    </section>
    {canonicalChatId ? <section aria-label="Brain chat associations" className={styles.brainCanonicalAssociations}>
      <ChatTicketsPanel chatId={Number(canonicalChatId)} projectId={connectedProjectId ? Number(connectedProjectId) : null} chatList={[{ id: Number(canonicalChatId), title: node.data.title }]} />
    </section> : <>
      <section aria-labelledby="brain-agents-heading"><div className={styles.brainSectionHeading}><h3 id="brain-agents-heading">Agents</h3><span>{agents.length}</span></div>{roster(agents, 'No agents associated with this chat.')}</section>
      <section aria-labelledby="brain-tickets-heading"><div className={styles.brainSectionHeading}><h3 id="brain-tickets-heading">Associated tickets</h3><span>{tickets.length}</span></div>{roster(tickets, 'No tickets associated with this chat.')}</section>
      <section aria-labelledby="brain-objects-heading"><div className={styles.brainSectionHeading}><h3 id="brain-objects-heading">Connected objects</h3><span>{related.length}</span></div>{roster(related, 'No other objects connected yet.')}</section>
    </>}
  </div>;
}

function Inspector({ node, nodes, edges, timeline, brainTrace, sessionId, persistence, role, editable, members, onChange, onWebsiteViewportChange, onClose, onRun, onEditWorkflow, onSaveAgent, onSaveFramePreset, onExpandProject, onLoadProjectQuality, onCompareProjects, onDeliverMockup, onExpandMockupSet, onImportDataset, onVisualizeDataset, onAttachEvermindProject, onExpandEvermindPipeline, onStartStandup }: { node: CreationFlowNode; nodes: CreationFlowNode[]; edges: Edge[]; timeline: CanvasTimelineMessage[]; brainTrace: BrainTraceEvent[]; sessionId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; editable: boolean; members: CreationSessionDetail['members']; onChange: (patch: Partial<CreationNodeData>) => void; onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => void; onClose: () => void; onRun: () => void; onEditWorkflow: () => void; onSaveAgent: () => void; onSaveFramePreset: () => void; onExpandProject: () => void; onLoadProjectQuality: () => void; onCompareProjects: () => void; onDeliverMockup: () => void; onExpandMockupSet: () => void; onImportDataset: (file: File) => void | Promise<void>; onVisualizeDataset: () => void; onAttachEvermindProject: () => void; onExpandEvermindPipeline: () => void; onStartStandup: () => void }) {
  const kind = node.data.kind;
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  const [accessStatus, setAccessStatus] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    if (typeof window === 'undefined') return INSPECTOR_DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY));
    return Number.isFinite(saved) ? Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, saved)) : INSPECTOR_DEFAULT_WIDTH;
  });
  const [expandedInspector, setExpandedInspector] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorWidthRef = useRef(inspectorWidth);
  const restoreInspectorWidth = useRef(INSPECTOR_DEFAULT_WIDTH);
  const resizeStart = useRef({ pointerX: 0, width: INSPECTOR_DEFAULT_WIDTH });
  const maxInspectorWidth = useCallback(() => {
    const available = inspectorRef.current?.parentElement?.getBoundingClientRect().width;
    return available && available > INSPECTOR_MIN_WIDTH
      ? Math.max(INSPECTOR_MIN_WIDTH, Math.min(INSPECTOR_MAX_WIDTH, available - 40))
      : INSPECTOR_MAX_WIDTH;
  }, []);
  const applyInspectorWidth = useCallback((width: number, persist = false) => {
    const next = Math.round(Math.min(maxInspectorWidth(), Math.max(INSPECTOR_MIN_WIDTH, width)));
    inspectorWidthRef.current = next;
    setInspectorWidth(next);
    if (persist) window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(next));
  }, [maxInspectorWidth]);
  const toggleInspectorWidth = () => {
    if (expandedInspector) {
      applyInspectorWidth(restoreInspectorWidth.current, true);
      setExpandedInspector(false);
      return;
    }
    restoreInspectorWidth.current = inspectorWidth;
    applyInspectorWidth(INSPECTOR_WIDE_WIDTH, true);
    setExpandedInspector(true);
  };
  const resizeInspectorWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = inspectorWidth + (event.shiftKey ? 50 : 20);
    if (event.key === 'ArrowRight') next = inspectorWidth - (event.shiftKey ? 50 : 20);
    if (event.key === 'Home') next = INSPECTOR_MIN_WIDTH;
    if (event.key === 'End') next = maxInspectorWidth();
    if (next == null) return;
    event.preventDefault();
    setExpandedInspector(false);
    applyInspectorWidth(next, true);
  };
  const markdown = artifactMarkdown(node.data);
  const csv = artifactCsv(node.data);
  const taskId = kind === 'task' && /^task:\d+$/.test(node.data.resourceId || '') ? Number(node.data.resourceId!.slice(5)) : null;
  const taskAgents = nodes.filter((candidate) => candidate.data.kind === 'agent');
  const agentTools = Array.isArray(node.data.tools) ? node.data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const availableAgentTools = ['Audience Analyzer', 'Copy Optimizer', 'Research', 'Browser'];
  const mockupProjects = nodes.filter((candidate) => candidate.data.kind === 'project');
  const mockupAgents = taskAgents;
  const defaultMockupProjectRef = mockupProjects[0]?.data.resourceId || mockupProjects[0]?.id || 'draft:builderforce-launch';
  const mockupProjectValue = typeof node.data.deliveryProjectRef === 'string' ? node.data.deliveryProjectRef : defaultMockupProjectRef;
  const defaultMockupAgentRef = mockupAgents[0]?.data.resourceId || mockupAgents[0]?.id || 'campaign-strategist';
  const mockupAgentValue = typeof node.data.mockupAgentRef === 'string' ? node.data.mockupAgentRef : defaultMockupAgentRef;
  const selectedTaskAgent = taskAgents.find((agent) => agent.data.title === node.data.assignee || agent.data.title === node.data.role);
  const taskAgentValue = typeof node.data.agentRef === 'string' ? node.data.agentRef : selectedTaskAgent ? (selectedTaskAgent.data.resourceId?.replace(/^agent:/, '') || selectedTaskAgent.id) : '';
  const connectedPrd = kind === 'task' ? nodes.find((candidate) => candidate.data.kind === 'prd' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const prdTitle = typeof connectedPrd?.data.title === 'string' ? connectedPrd.data.title : typeof node.data.prdTitle === 'string' ? node.data.prdTitle : '';
  const prdStatus = typeof connectedPrd?.data.status === 'string' ? connectedPrd.data.status : typeof node.data.prdStatus === 'string' ? node.data.prdStatus : '';
  const prdSummary = [connectedPrd?.data.markdown, connectedPrd?.data.content, connectedPrd?.data.subtitle, node.data.prdSummary].find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const normalizedTaskStatus = String(node.data.status || 'ready').toLowerCase().replaceAll(' ', '_');
  const statusGuidance: Record<string, string> = {
    backlog: 'Add a clear description and PRD, set priority, and assign an agent to make this ready.',
    todo: 'Confirm the PRD and acceptance criteria, then move the task to Ready.',
    ready: 'The task is actionable. Start work by moving it to In progress or running its assigned agent.',
    assigned: 'The owner is set. Move the task to In progress when execution begins.',
    in_progress: 'Keep the description and acceptance criteria current; move to In review when evidence is ready.',
    in_review: 'Validate the work against the PRD and acceptance criteria, then mark Done or return it to In progress.',
    blocked: 'Record the blocker in the description, resolve its dependency, then return it to Ready or In progress.',
    done: 'This task is complete. Reopen it only when the PRD or acceptance criteria are not satisfied.',
  };
  const persistTaskPatch = async (apiPatch: Parameters<typeof tasksApi.update>[1], canvasPatch: Partial<CreationNodeData>) => {
    setActionStatus('Saving task…');
    try {
      if (taskId != null && persistence === 'server') await tasksApi.update(taskId, apiPatch);
      onChange(canvasPatch);
      setActionStatus(taskId != null && persistence === 'server' ? 'Task updated' : 'Task updated in this session');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Task update failed');
    }
  };
  const runArtifactAction = async (action: 'copy' | 'markdown' | 'csv' | 'docx' | 'pptx' | 'json') => {
    setActionStatus('Preparing…');
    try {
      const base = safeDownloadName(node.data.title);
      if (action === 'copy') {
        setActionStatus(await copyTextToClipboard(markdown) ? 'Copied to clipboard' : 'Clipboard access was unavailable');
        return;
      }
      if (action === 'markdown') downloadText(markdown, `${base}.md`, 'text/markdown');
      if (action === 'csv') {
        if (!csv) throw new Error('This object does not contain tabular rows yet');
        exportCsv(csv, `${base}.csv`);
      }
      if (action === 'docx') {
        if (persistence === 'local') downloadText(markdown, `${base}.md`, 'text/markdown');
        else await exportDocx(markdown, node.data.title);
      }
      if (action === 'pptx') {
        if (persistence === 'local') downloadText(markdown, `${base}.md`, 'text/markdown');
        else await exportPptx(markdown, node.data.title);
      }
      if (action === 'json') downloadJson({ kind, title: node.data.title, data: node.data }, `${base}.json`);
      setActionStatus(action === 'docx' && persistence === 'local' || action === 'pptx' && persistence === 'local' ? 'Markdown downloaded; save the Session for Office export' : 'Download ready');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Export failed');
    }
  };
  return <aside ref={inspectorRef} className={styles.inspector} aria-label="Details panel" style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}>
    <div
      className={styles.inspectorResizeHandle}
      role="separator"
      aria-label="Resize details panel"
      aria-orientation="vertical"
      aria-valuemin={INSPECTOR_MIN_WIDTH}
      aria-valuemax={maxInspectorWidth()}
      aria-valuenow={inspectorWidth}
      tabIndex={0}
      onKeyDown={resizeInspectorWithKeyboard}
      onPointerDown={(event) => {
        resizeStart.current = { pointerX: event.clientX, width: inspectorWidth };
        event.currentTarget.setPointerCapture(event.pointerId);
        setExpandedInspector(false);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        applyInspectorWidth(resizeStart.current.width + resizeStart.current.pointerX - event.clientX);
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(inspectorWidthRef.current));
      }}
    />
    <header><div className={styles.inspectorTitle}><span>{kind === 'agent' ? '✦' : kind === 'website' ? '◎' : kind === 'workflow' ? '⌘' : '◇'}</span><strong>{node.data.title}</strong><small>Live {kind}</small></div><div className={styles.inspectorHeaderActions}><button type="button" onClick={toggleInspectorWidth} aria-label={expandedInspector ? 'Restore details panel width' : 'Expand details panel'} title={expandedInspector ? 'Restore panel width' : 'Expand panel'}>{expandedInspector ? '⇥' : '↔'}</button><button type="button" onClick={onClose} aria-label="Close inspector">×</button></div></header>
    <div className={styles.inspectorTabs}><button className={tab === 'details' ? styles.activeTab : ''} onClick={() => setTab('details')}>Details</button><button className={tab === 'activity' ? styles.activeTab : ''} onClick={() => setTab('activity')}>Activity</button></div>
    <div className={styles.inspectorBody}>
      {tab === 'details' ? <fieldset className={styles.inspectorFields} disabled={!editable}>
      {node.data.redacted === true && <><p className={styles.inspectorHint}>You can see this object’s position, but its source is no longer available to you.</p><button type="button" className={styles.fullButton} disabled={persistence !== 'server' || !!accessStatus} onClick={() => { setAccessStatus('Requesting…'); void creationSessionsApi.requestObjectAccess(sessionId, node.id).then(() => setAccessStatus('Access requested')).catch((error) => setAccessStatus(error instanceof Error ? error.message : 'Request failed')); }}>{accessStatus || 'Request access'}</button></>}
      <label>Name<input value={node.data.title} onChange={(event) => onChange({ title: event.target.value })} /></label>
      {typeof node.data.pipelineStep === 'number' && <section className={styles.pipelineInspectorGuide} aria-label={`Evermind setup step ${node.data.pipelineStep}`}><span>Evermind setup · {node.data.pipelineStep} of 5</span><strong>{node.data.pipelineStart === true ? 'Start here' : node.data.title}</strong><p>{String(node.data.pipelineInstruction || 'Complete this stage, then follow the numbered connection to the next card.')}</p>{node.data.pipelineStep === 1 && node.data.status !== 'Imported' && <small>Use the file picker directly below to begin.</small>}{node.data.pipelineStep === 1 && node.data.status === 'Imported' && <small>Data is ready. Follow “2 · examples” to Tokenize examples.</small>}</section>}
      {kind === 'chat' && <BrainObjectDetails node={node} nodes={nodes} edges={edges} timeline={timeline} trace={brainTrace} />}
      {kind === 'agent' && <>
        <label>Model<select value={node.data.model || 'gpt-4o'} onChange={(event) => onChange({ model: event.target.value })}><option>gpt-4o</option><option>claude-3.5-sonnet</option><option>Evermind</option></select></label>
        <label>Instructions<textarea value={typeof node.data.instructions === 'string' ? node.data.instructions : node.data.subtitle || ''} onChange={(event) => onChange({ instructions: event.target.value, subtitle: event.target.value })} rows={5} /></label>
        <label>Tools<div className={styles.inspectorPills}>{agentTools.map((tool) => <button type="button" key={tool} aria-label={`Remove ${tool}`} onClick={() => onChange({ tools: agentTools.filter((candidate) => candidate !== tool) })}>{tool} ×</button>)}<button type="button" disabled={availableAgentTools.every((tool) => agentTools.includes(tool))} onClick={() => { const next = availableAgentTools.find((tool) => !agentTools.includes(tool)); if (next) onChange({ tools: [...agentTools, next] }); }}>+ Add tool</button></div></label>
        <label>Autonomy<select value={typeof node.data.autonomy === 'string' ? node.data.autonomy : 'medium'} onChange={(event) => onChange({ autonomy: event.target.value })}><option value="medium">Medium · request approvals</option><option value="low">Low · suggest only</option><option value="high">High · act within policy</option></select></label>
        <button type="button" className={styles.fullButton} onClick={onSaveAgent}>Save agent settings everywhere</button>
      </>}
      {kind === 'staff' && <><label>Role<input value={node.data.role || ''} onChange={(event) => onChange({ role: event.target.value })} /></label><label>Current focus<textarea value={node.data.focus || ''} onChange={(event) => onChange({ focus: event.target.value })} rows={4} /></label></>}
      {(kind === 'website' || kind === 'prototype') && <><label>Headline<input value={typeof node.data.websiteHeadline === 'string' ? node.data.websiteHeadline : 'Fall in love with every look'} onChange={(event) => onChange({ websiteHeadline: event.target.value })} /></label><label>Supporting copy<textarea rows={3} value={typeof node.data.websiteBody === 'string' ? node.data.websiteBody : 'New arrivals for the season ahead.'} onChange={(event) => onChange({ websiteBody: event.target.value })} /></label><label>Call to action<input value={typeof node.data.websiteCta === 'string' ? node.data.websiteCta : 'Shop the collection'} onChange={(event) => onChange({ websiteCta: event.target.value })} /></label><label>Accent color<input type="color" value={typeof node.data.websiteAccent === 'string' ? node.data.websiteAccent : '#3978f6'} onChange={(event) => onChange({ websiteAccent: event.target.value })} /></label><label>Viewport<select value={typeof node.data.viewport === 'string' ? node.data.viewport : 'desktop'} onChange={(event) => onWebsiteViewportChange(event.target.value as 'desktop' | 'tablet' | 'mobile')}><option value="desktop">Desktop · 1440</option><option value="tablet">Tablet · 768</option><option value="mobile">Mobile · 390</option></select></label><p className={styles.inspectorHint}>Changes render live in the interactive prototype on the canvas.</p></>}
      {kind === 'workflow' && <><label>Execution target<select value={typeof node.data.runTarget === 'string' ? node.data.runTarget : 'builderforce'} onChange={(event) => onChange({ runTarget: event.target.value })}><option value="builderforce">BuilderForce.AI</option><option value="campaign-strategist">Campaign Strategist</option></select></label><label>Approval mode<select value={typeof node.data.approvalMode === 'string' ? node.data.approvalMode : 'required'} onChange={(event) => onChange({ approvalMode: event.target.value })}><option value="required">Required before publish</option><option value="autonomous">Fully autonomous</option></select></label><button type="button" className={styles.fullButton} onClick={onEditWorkflow}>Edit Workflow on Canvas</button><button className={styles.fullButton} onClick={onRun}>▶ Run workflow</button></>}
      {kind === 'dashboard' && <><label>Date range<select value={typeof node.data.dateRange === 'string' ? node.data.dateRange : '30d'} onChange={(event) => onChange({ dateRange: event.target.value })}><option value="30d">Last 30 days</option><option value="7d">Last 7 days</option><option value="qtd">Quarter to date</option></select></label><button type="button" className={styles.fullButton} onClick={() => onChange({ fetchedAt: new Date().toISOString(), status: 'Live' })}>Refresh live data</button></>}
      {kind === 'dataset' && <><label>Import CSV or TSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportDataset(file); }} /></label><p className={styles.inspectorHint}>A safe preview of up to 500 rows is stored with this session. Connect it to a dashboard or ask Brain to analyze it.</p><button className={styles.fullButton} onClick={onVisualizeDataset}>Create visualization</button></>}
      {kind === 'voice' && <CanvasVoiceInspector node={node} persistence={persistence} onChange={onChange} />}
      {kind === 'project' && <><label>Project view<select value={typeof node.data.projectLens === 'string' ? node.data.projectLens : 'everything'} onChange={(event) => onChange({ projectLens: event.target.value })}><option value="everything">Everything</option><option value="delivery">Delivery</option><option value="metrics">Metrics</option><option value="customer-feedback">Customer feedback</option></select></label><p className={styles.inspectorHint}>Project context is optional. Load its quality evidence, add related work, or compare it with every other project on the canvas.</p><button className={styles.fullButton} onClick={onLoadProjectQuality}>Visualize quality diagnostics</button><button className={styles.fullButton} onClick={onExpandProject}>Add all related items</button><button className={styles.fullButton} onClick={onCompareProjects}>Compare projects on canvas</button></>}
      {kind === 'task' && <>
        <div className={styles.taskInspectorGrid}>
          <label>Status<select value={String(node.data.status || 'ready')} onChange={(event) => void persistTaskPatch({ status: event.target.value }, { status: event.target.value })}>
            {!['backlog','todo','ready','assigned','in_progress','in_review','blocked','done'].includes(String(node.data.status || 'ready')) && <option value={String(node.data.status)}>{String(node.data.status)}</option>}
            <option value="backlog">Backlog</option><option value="todo">To do</option><option value="ready">Ready</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="in_review">In review</option><option value="blocked">Blocked</option><option value="done">Done</option>
          </select></label>
          <label>Priority<select value={typeof node.data.priority === 'string' ? node.data.priority : 'medium'} onChange={(event) => void persistTaskPatch({ priority: event.target.value as 'low' | 'medium' | 'high' | 'urgent' }, { priority: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        </div>
        <div className={styles.statusGuidance}><b>How to move this forward</b><p>{statusGuidance[normalizedTaskStatus] || 'Keep the owner, PRD, acceptance criteria, and current state accurate so the next action is clear.'}</p></div>
        <label>Assigned agent<select value={taskAgentValue} onChange={(event) => {
          const selected = taskAgents.find((agent) => (agent.data.resourceId?.replace(/^agent:/, '') || agent.id) === event.target.value);
          const agentRef = selected?.data.resourceId?.startsWith('agent:') ? selected.data.resourceId.slice(6) : null;
          if (taskId != null && persistence === 'server' && selected && !agentRef) { setActionStatus('Save this Agent before assigning it to a project task'); return; }
          void persistTaskPatch({ assignedAgentRef: agentRef, assignedAgentHostId: null, assignedUserId: null }, { agentRef: event.target.value || undefined, assignee: selected?.data.title || undefined, role: selected?.data.title || undefined });
        }}><option value="">Unassigned</option>{taskAgents.map((agent) => { const value = agent.data.resourceId?.replace(/^agent:/, '') || agent.id; return <option key={agent.id} value={value}>{agent.data.title}{agent.data.model ? ` · ${String(agent.data.model)}` : ''}</option>; })}</select></label>
        <label>Description<textarea rows={5} value={typeof node.data.content === 'string' ? node.data.content : typeof node.data.subtitle === 'string' ? node.data.subtitle : ''} onChange={(event) => onChange({ content: event.target.value })} onBlur={(event) => { if (taskId != null && persistence === 'server') void persistTaskPatch({ description: event.target.value || null }, { content: event.target.value }); }} /></label>
        <label>Acceptance criteria<textarea rows={4} value={typeof node.data.acceptanceCriteria === 'string' ? node.data.acceptanceCriteria : ''} placeholder="What must be true for this task to be done?" onChange={(event) => onChange({ acceptanceCriteria: event.target.value })} /></label>
        <section className={styles.taskPrdSummary} aria-label="Task PRD">
          <div><span>PRD</span>{prdStatus && <small>{prdStatus}</small>}</div>
          {prdTitle ? <><strong>{prdTitle}</strong>{prdSummary && <p>{prdSummary.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 360)}</p>}</> : <><strong>No PRD linked</strong><p>Connect a PRD object to this task or link one from the project task details. The PRD gives the agent the goal and handoff context.</p></>}
        </section>
        {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
      </>}
      {kind === 'projectComparison' && <><p className={styles.inspectorHint}>This portfolio view combines project health with saved quality diagnostics, open gaps, remediation state, and prioritized recommendations.</p><button className={styles.fullButton} onClick={onCompareProjects}>Refresh quality comparison</button><SourceList sources={node.data.sources} /></>}
      {kind === 'mockup' && <><label>Delivery project<select value={mockupProjectValue} onChange={(event) => { const project = mockupProjects.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ deliveryProjectRef: event.target.value, deliveryProjectName: project?.data.title || (event.target.value === 'draft:builderforce-launch' ? 'BuilderForce launch' : 'No project') }); }}><option value="draft:builderforce-launch">BuilderForce launch</option>{mockupProjects.filter((project) => (project.data.resourceId || project.id) !== 'draft:builderforce-launch').map((project) => <option key={project.id} value={project.data.resourceId || project.id}>{project.data.title}</option>)}<option value="">No project</option></select></label><label>Assign agent<select value={mockupAgentValue} onChange={(event) => { const agent = mockupAgents.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ mockupAgentRef: event.target.value, mockupAgentName: agent?.data.title || (event.target.value === 'web-analyst' ? 'Web Analyst' : 'Unassigned') }); }}><option value="campaign-strategist">Campaign Strategist</option>{mockupAgents.filter((agent) => (agent.data.resourceId || agent.id) !== 'campaign-strategist').map((agent) => <option key={agent.id} value={agent.data.resourceId || agent.id}>{agent.data.title}</option>)}<option value="web-analyst">Web Analyst</option><option value="">Unassigned</option></select></label><button className={styles.fullButton} onClick={onDeliverMockup}>Add to project and assign</button></>}
      {kind === 'mockupSet' && <><p className={styles.inspectorHint}>Expand the set into individually reviewable mockups, or deliver the approved set as one project task.</p><button className={styles.fullButton} onClick={onExpandMockupSet}>Expand all mockups</button><button className={styles.fullButton} onClick={onDeliverMockup}>Add to project and assign</button><SourceList sources={node.data.sources} /></>}
      {kind === 'evermind' && <EvermindInspector node={node} persistence={persistence} onAttach={onAttachEvermindProject} onExpand={onExpandEvermindPipeline} />}
      {kind === 'standup' && <><p className={styles.inspectorHint}>Gather every Staff Member and Agent currently on the canvas. With a saved Project, this starts the canonical stand-up ceremony and keeps its resource link in the session.</p><button className={styles.fullButton} onClick={onStartStandup}>Gather and start stand-up</button></>}
      {kind === 'frame' && <><label>Purpose<input value={typeof node.data.framePurpose === 'string' ? node.data.framePurpose : 'Arrange related objects here'} onChange={(event) => onChange({ framePurpose: event.target.value })} /></label><label>Fill color<input type="color" value={typeof node.data.frameColor === 'string' ? node.data.frameColor : '#f8f6ff'} onChange={(event) => onChange({ frameColor: event.target.value })} /></label><label>Border color<input type="color" value={typeof node.data.frameBorder === 'string' ? node.data.frameBorder : '#9d8bea'} onChange={(event) => onChange({ frameBorder: event.target.value })} /></label><button className={styles.fullButton} onClick={onSaveFramePreset}>Save as reusable frame</button></>}
      {kind === 'drawing' && <><label>Stroke color<input type="color" value={typeof node.data.stroke === 'string' ? node.data.stroke : '#5b5ce2'} onChange={(event) => onChange({ stroke: event.target.value })} /></label><label>Stroke width<input type="range" min="1" max="12" value={typeof node.data.strokeWidth === 'number' ? node.data.strokeWidth : 3} onChange={(event) => onChange({ strokeWidth: Number(event.target.value) })} /></label><p className={styles.inspectorHint}>Resize, annotate, connect, or use this sketch as visual context for Brain.</p></>}
      {!['chat', 'agent', 'staff', 'website', 'prototype', 'workflow', 'dashboard', 'dataset', 'voice', 'project', 'task', 'mockup', 'evermind', 'standup', 'frame', 'drawing'].includes(kind) && <p className={styles.inspectorHint}>This object is live in the session. Connect it to other objects or ask Brain to transform or evaluate it.</p>}
      </fieldset> : <ActivityInspector sessionId={sessionId} objectId={node.id} persistence={persistence} role={role} members={members} />}
      {tab === 'details' && <section aria-label="Copy and download" style={{ display: 'grid', gap: 7, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <strong style={{ fontSize: 12 }}>Copy &amp; download</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(kind === 'chat' || kind === 'code' || kind === 'note' || kind === 'report' || kind === 'document' || kind === 'slides' || kind === 'prd') && <button type="button" onClick={() => void runArtifactAction('copy')}>Copy</button>}
          {(kind === 'chat' || kind === 'code' || kind === 'note' || kind === 'report' || kind === 'prd') && <button type="button" onClick={() => void runArtifactAction('markdown')}>Download Markdown</button>}
          {(kind === 'dataset' || kind === 'spreadsheet' || kind === 'table') && <button type="button" onClick={() => void runArtifactAction('csv')}>Download CSV</button>}
          {kind === 'document' && <button type="button" onClick={() => void runArtifactAction('docx')}>Download Word</button>}
          {kind === 'slides' && <button type="button" onClick={() => void runArtifactAction('pptx')}>Download PowerPoint</button>}
          {(kind === 'dashboard' || kind === 'chart' || kind === 'evaluation' || kind === 'featureSummary' || kind === 'projectComparison') && <button type="button" onClick={() => void runArtifactAction('json')}>Download data</button>}
        </div>
        {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
      </section>}
    </div>
    <footer><span>Resource · {role}</span><code>{node.data.resourceId || `session:${node.id}`}</code><button className={styles.fullButton} disabled={!editable} onClick={() => kind === 'task' ? setActionStatus('Task details are saved') : onChange({ status: 'Saved' })}>{kind === 'task' ? 'Save task details' : 'Save changes'}</button></footer>
  </aside>;
}

function SourceList({ sources }: { sources: unknown }) {
  if (!Array.isArray(sources) || !sources.length) return null;
  return <div className={styles.sourceList}><strong>Evidence sources</strong>{sources.map((source, index) => { const item = source as { label?: string; resource?: string }; return <div key={`${item.resource}-${index}`}><span>{index + 1}</span><p><b>{item.label || 'Source'}</b><code>{item.resource || 'Canonical API'}</code></p></div>; })}</div>;
}

function CanvasVoiceInspector({ node, persistence, onChange }: { node: CreationFlowNode; persistence: 'local' | 'server'; onChange: (patch: Partial<CreationNodeData>) => void }) {
  const storageProjectId = useMemo(() => {
    const ref = node.data.resourceId;
    if (!ref?.startsWith('project:')) return null;
    const value = Number(ref.slice('project:'.length));
    return Number.isInteger(value) && value > 0 ? value : null;
  }, [node.data.resourceId]);
  const voice = useVoiceStudio({ enabled: persistence === 'server', storageProjectId });
  const loadedNode = useRef<string | null>(null);
  const savedResult = useRef<unknown>(null);

  useEffect(() => {
    if (loadedNode.current === node.id) return;
    loadedNode.current = node.id;
    voice.setText(typeof node.data.voiceScript === 'string' && node.data.voiceScript.trim() ? node.data.voiceScript : '');
  }, [node.data.voiceScript, node.id, voice.setText]);

  useEffect(() => {
    const savedCloneId = Number(node.data.voiceCloneId);
    if (Number.isInteger(savedCloneId) && savedCloneId > 0 && voice.clones.some((clone) => clone.id === savedCloneId) && voice.selectedCloneId !== savedCloneId) {
      voice.setSelectedCloneId(savedCloneId);
    }
  }, [node.data.voiceCloneId, voice.clones, voice.selectedCloneId, voice.setSelectedCloneId]);

  useEffect(() => {
    if (!voice.result || savedResult.current === voice.result) return;
    savedResult.current = voice.result;
    onChange({
      voiceScript: voice.text,
      voiceTranscript: voice.text,
      voiceCloneId: voice.selectedCloneId,
      voiceDurationMs: voice.result.durationMs,
      voiceEngine: voice.result.engineId,
      voiceAudioResource: voice.result.audioUrl ?? null,
      voiceWordTimestamps: voice.result.wordTimestamps,
      status: 'Generated',
      subtitle: voice.text,
    });
  }, [onChange, voice.result, voice.selectedCloneId, voice.text]);

  const dictate = () => {
    const browserWindow = window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition };
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) { onChange({ status: 'Voice dictation is not supported by this browser' }); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) return;
      voice.setText(transcript);
      onChange({ voiceScript: transcript, voiceTranscript: transcript, subtitle: transcript, status: 'Transcribed' });
    };
    recognition.onerror = () => onChange({ status: 'Voice transcription failed' });
    recognition.onend = null;
    recognition.start();
  };

  if (persistence === 'local') return <p className={styles.inspectorHint}>Save this Session to create or select a consented voice, record a sample, transcribe speech, and generate playable audio.</p>;
  return <div className={styles.canvasVoiceStudio}>
    <button type="button" className={styles.fullButton} onClick={dictate}>Dictate and transcribe script</button>
    <VoiceConfigPanel voice={voice} />
    <button type="button" className={styles.fullButton} disabled={voice.busy || !voice.selectedCloneId || !voice.text.trim()} onClick={() => { onChange({ voiceScript: voice.text, voiceTranscript: voice.text, status: 'Generating voice…' }); void voice.synth(); }}>{voice.busy ? 'Generating…' : 'Generate voice'}</button>
    <div className={styles.canvasVoiceOutput}><VoiceOutput result={voice.result} audioUrl={voice.audioUrl} busy={voice.busy} unavailable={voice.unavailable} /></div>
  </div>;
}

function EvermindInspector({ node, persistence, onAttach, onExpand }: { node: CreationFlowNode; persistence: 'local' | 'server'; onAttach: () => void; onExpand: () => void }) {
  const rawProjectId = node.data.resourceId?.startsWith('evermind:') ? node.data.resourceId.slice('evermind:'.length) : '';
  const projectId = /^\d+$/.test(rawProjectId) ? Number(rawProjectId) : null;
  return <>
    <div className={styles.evermindStartGuide}><span>{node.data.pipelineExpanded === true ? 'Guided setup added' : 'New model'}</span><strong>{node.data.pipelineExpanded === true ? 'Continue from Step 1' : 'Start with training examples'}</strong><p>{node.data.pipelineExpanded === true ? 'The numbered cards show the complete learning path. This button returns you to the first unfinished action.' : 'We’ll add a five-step flow and open the training-data picker first. Each card explains the next action.'}</p></div>
    <button className={styles.fullButton} onClick={onExpand}>{node.data.pipelineExpanded === true ? 'Go to Step 1 · Training data' : 'Start guided setup'}</button>
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

export function CreationCanvas({ sessionId, persistence = 'server', initialFocusId, initialShareOpen, initialPresent }: { sessionId: string; persistence?: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialPresent?: boolean }) {
  return <ReactFlowProvider><CanvasInner sessionId={sessionId} persistence={persistence} initialFocusId={initialFocusId} initialShareOpen={initialShareOpen} initialPresent={initialPresent} /></ReactFlowProvider>;
}
