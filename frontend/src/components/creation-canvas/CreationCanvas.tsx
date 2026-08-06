'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AccessibleOutlineIcon, CanvasCommands, CanvasFilesIcon, CanvasRailToggle, cleanCanvasLayout } from '@/components/canvas/CanvasCommands';
import { Canvas3DView, type Canvas3DMove } from '@/components/canvas/Canvas3DView';
import { Canvas3DControlsProvider, useCanvas3DControls } from '@/components/canvas/canvas3dControls';
import type { Canvas3DDescriptor } from '@/components/canvas/canvas3d';
import { CanvasOutlinePanel } from './CanvasOutlinePanel';
import { CanvasFilesPanel } from './CanvasFilesPanel';
import { BrainDock } from './BrainDock';
import { brainDockReservedWidth, brainDockWidth, DEFAULT_BRAIN_DOCK_PREFERENCES, readBrainDockPreferences, writeBrainDockPreferences, type BrainDockPreferences } from './brainDockPreferences';
import { BrainSurfaceProvider, type BrainSurfaceContextValue } from './brainSurfaceContext';
import { useToast } from '@/components/ToastProvider';
import { CreationNode, type CreationFlowNode } from './CreationNode';
import type { CreationNodeData, CreationObjectKind } from './types';
import styles from './CreationCanvas.module.css';
import { agileMetricsApi, ceremonySessionsApi, creationSessionsApi, runtimeApi, specsApi, tasksApi, taskSpecsApi, toolsApi, workflowDefinitions, type CreationOutcomeMetrics, type CreationSessionActivity, type CreationSessionComment, type CreationSessionDetail, type CreationSessionInvitation, type CreationSessionSummary, type CreationSnapshotSummary, type CreationTemplate as ServerCreationTemplate, type CreationTimelineMessage } from '@/lib/builderforceApi';
import { creationGraphFromSnapshot, creationStorageKey, readLocalCreationSession, writeLocalCreationSession, type LocalCreationSnapshot } from '@/lib/creationSessions';
import { useGuestRoom } from '@/lib/useGuestRoom';
import { GuestInviteLink } from '@/components/guest/GuestInviteLink';
import {
  createGuestRoom, leaveGuestRoom, fetchGuestRoomCanvas, pushGuestRoomCanvas,
  getActiveGuestRoom, getGuestDisplayName, setGuestDisplayName,
} from '@/lib/guestRoomApi';
import { runCreationCanvasAi } from '@/lib/creationCanvasAi';
import type { BrainAction, BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import '@seanhogg/builderforce-brain-ui/styles.css';
import { ProjectEvermindPanel } from '@/components/ide/ProjectEvermindPanel';
import { EvermindValidationProvider } from '@/components/ide/EvermindValidationContext';
import { getProjectEvermindContributions, getProjectEvermindHead, recallProjectEvermind, teachProjectEvermindFromText, type ProjectEvermindContributions, type ProjectEvermindHead } from '@/lib/projectEvermindApi';
import { isAwaitingApprovalExecution } from '@/lib/builderforceApi';
import { evaluateModel, fetchProjects, publishSite } from '@/lib/api';
import { computeProjectHealth } from '@/lib/projectHealth';
import { createCloudAgent, updateAgent } from '@/lib/api';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, createDefaultCreationData, creationObjectDefinition, sanitizeCreationObjectPatch, type CreationObjectGroup } from './creationObjectRegistry';
import { CREATION_TEMPLATES, type CreationTemplate } from './creationTemplates';
import { trackActivity } from '@/lib/activity/tracker';
import { useTranslations } from 'next-intl';
import { CREATION_CONNECTION_KINDS, CREATIVE_CAPABILITIES, type CreationConnectionKind } from '@builderforce/creation-canvas-contract';
import { downloadJson, downloadText, toCsv } from '@/lib/download';
import { exportCsv, exportDocx, exportPptx } from '@/lib/exportApi';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';
import {
  MAX_MATERIALIZED_ROWS, MAX_TABULAR_COLUMNS, TABULAR_AGGREGATE_OPERATORS, TABULAR_FILTER_OPERATORS,
  isTabularFile, parseTabularText, profileTabular, queryTabular, tabularFromObject,
  type TabularHighlightRule, type TabularQuery, type TabularSource,
} from '@/lib/canvasTabularData';
import { WorkflowBuilder } from '@/components/workflow-builder/WorkflowBuilder';
import { VoiceConfigPanel } from '@/components/ide/VoiceConfigPanel';
import { VoiceOutput } from '@/components/ide/VoiceOutput';
import { useVoiceStudio } from '@/lib/voiceStudio';
import { CopyButton } from '@/components/CopyButton';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { buildCreationCanvasDiagnosticsReport } from '@/lib/creationCanvasDiagnostics';
import { arrangeCanvasNodes, canvasArrangementTargets, canvasNodeDimensions, canvasPlacementUnlocked, nextCanvasObjectPosition, type CanvasArrangement } from './creationCanvasLayout';
import { isBrainAutoApprove, setBrainAutoApprove } from '@/lib/brain/autoApprove';
import { useConfirm } from '@/components/ConfirmProvider';
import { useLlmModels } from '@/lib/useLlmModels';
import { ChatInput, type ChatModelOptions, type ChatModelSelection } from '@/components/ChatInput';
import { runCanonicalCanvasGroupTurn } from '@/lib/creationAgentChat';
import { buildBrowserCreativeArtifact, buildWebsiteAssets, creationDeliverables, creativePreviewImageUrl, generateEvermindMedia, mediaFrameDataUrl, navigableArtifactUrl, withCreationDeliverable, type CreationDeliverable } from '@/lib/creationDeliverables';
import { canvasDiagram, canvasFiles, canvasObjectMarkdown, type CanvasFile } from '@/lib/canvasDocuments';
import { listEvermindModels } from '@/lib/studioModelsApi';
import { AITrainingPanel } from '@/components/AITrainingPanel';

const DND_MIME = 'application/x-builderforce-creation-object';
const PALETTE_COLLAPSE_STORAGE_KEY = 'builderforce:create:palette-collapsed-groups';
const PALETTE_OPEN_STORAGE_KEY = 'builderforce:create:palette-open';
const INSPECTOR_WIDTH_STORAGE_KEY = 'builderforce:create:inspector-width';
const INSPECTOR_DEFAULT_WIDTH = 270;
const INSPECTOR_MIN_WIDTH = 270;
const INSPECTOR_WIDE_WIDTH = 520;
const INSPECTOR_MAX_WIDTH = 720;
const ACCOUNT_REQUIRED_OBJECT_ACTIONS = new Set(['publish', 'deliver', 'assign', 'authenticate', 'execute', 'record', 'train', 'start', 'compare']);
const CONNECTED_CANVAS_ACTIONS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  website: ['publish'], video: ['generate'],
  workflow: ['run'], dataset: ['visualize', 'profile'], project: ['expand', 'compare'],
  mockup: ['deliver'], mockupSet: ['expand', 'deliver'], standup: ['start'],
  evermind: ['train', 'evaluate', 'publish'],
  image: ['generate', 'preview', 'export'], animation: ['generate', 'preview', 'export'], podcast: ['generate', 'preview', 'export'],
  comic: ['generate', 'preview', 'export'], game: ['generate', 'preview', 'export'], cad: ['generate', 'preview', 'export'], model3d: ['generate', 'preview', 'export'],
  resume: ['generate', 'preview', 'export'], template: ['browse', 'apply'],
};
const CREATIVE_GENERATOR_KINDS = new Set<CreationObjectKind>(['image', 'animation', 'podcast', 'comic', 'game', 'cad', 'model3d', 'resume', 'template']);
const CREATIVE_OUTPUTS = Object.fromEntries(CREATIVE_CAPABILITIES.map((capability) => [capability.kind, capability.outputs])) as Partial<Record<CreationObjectKind, readonly string[]>>;

/** True only when an advertised capability has a real Canvas-side adapter. */
export function canInvokeCreationObjectAction(kind: CreationObjectKind, action: string): boolean {
  return action === 'inspect' || action === 'edit' || CONNECTED_CANVAS_ACTIONS[kind]?.includes(action) === true;
}
const PALETTE_GROUP_ICONS: Record<CreationObjectGroup, string> = {
  Build: '✦', Data: '▦', Knowledge: '▤', Insights: '↗', Work: '✓', People: '●', Agents: '✧', Models: '◉', Collaborate: '◇', Integrations: '⌘',
};
export type ProposedCanvasChange =
  | { id: string; type: 'object.add'; label: string; node: CreationFlowNode }
  | { id: string; type: 'object.update'; label: string; objectId: string; patch: Partial<CreationNodeData> }
  | { id: string; type: 'object.delete'; label: string; objectId: string }
  | { id: string; type: 'object.layout'; label: string; objectId: string; position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean; locked?: boolean }
  | { id: string; type: 'object.action'; label: string; objectId: string; action: string }
  | { id: string; type: 'connection.add'; label: string; edge: Edge }
  | { id: string; type: 'connection.update'; label: string; connectionId: string; patch: { label?: string; kind?: CreationConnectionKind } }
  | { id: string; type: 'connection.delete'; label: string; connectionId: string };

/**
 * Canvas-local authoring is reversible and is the direct result the user asked
 * Brain to create, so it must not stop behind a second approval step. Keep
 * destructive operations, executable actions, and canonical PRD persistence in
 * review. Those can remove data, trigger work, or write outside the canvas.
 */
export function canvasChangesCanAutoApply(changes: readonly ProposedCanvasChange[]): boolean {
  return changes.length > 0 && changes.every((change) => {
    if (change.type === 'object.add') return change.node.data.canonicalPrdPending !== true;
    return change.type === 'object.update'
      || change.type === 'object.layout'
      || change.type === 'connection.add'
      || change.type === 'connection.update';
  });
}
type MergeItem = { key: string; source: CreationFlowNode; target: CreationFlowNode | null; choice: 'branch' | 'parent' };
type MergeReview = { parentId: string; parentRevision: number; parentNodes: CreationFlowNode[]; parentEdges: Edge[]; items: MergeItem[] };
type FramePreset = { id: string; name: string; data: CreationNodeData };

/** A follow-up about the selected object is an edit unless the user clearly asks
 * for another object. This is also enforced at the tool boundary so a model that
 * ignores the prompt cannot silently duplicate a chart while claiming an update. */
export function duplicateAddUpdateTarget(
  prompt: string,
  kind: CreationObjectKind,
  nodes: CreationFlowNode[],
  selectedIds: string[],
): CreationFlowNode | undefined {
  const selected = nodes.find((node) => selectedIds.includes(node.id) && node.data.kind === kind && node.data.kind !== 'chat');
  if (!selected) return undefined;
  const escapedKind = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('-', '[ -]');
  const explicitlyCreatesObject = new RegExp(`\\b(?:create|add|insert|duplicate|copy)\\s+(?:(?:a|an|another|new|additional|second|one)\\s+)?(?:analytical\\s+)?${escapedKind}\\b`, 'i').test(prompt)
    || /\b(?:another|new|additional|second)\s+(?:object|visual|widget|version)\b/i.test(prompt);
  return explicitlyCreatesObject ? undefined : selected;
}
type CanvasTimelineMessage = Pick<CreationTimelineMessage, 'clientMessageId' | 'messageRole' | 'body' | 'createdAt'> & { id?: number; metadata?: CreationTimelineMessage['metadata'] };
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

export function scoreAgentTestResponse(response: string, expected: string): { passed: boolean | null; matched: string[]; missing: string[] } {
  const criteria = expected.split(/[\n,;]+/).map((item) => item.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 20);
  if (!criteria.length) return { passed: null, matched: [], missing: [] };
  const haystack = response.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const matches = (criterion: string) => {
    const words = criterion.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];
    return words.length > 0 && words.filter((word) => haystack.includes(word)).length >= Math.ceil(words.length * 0.6);
  };
  const matched = criteria.filter(matches);
  const missing = criteria.filter((criterion) => !matches(criterion));
  return { passed: missing.length === 0, matched, missing };
}

function safeDownloadName(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'creation';
}

export type CanvasExportAction = 'copy' | 'markdown' | 'csv' | 'docx' | 'pptx' | 'json' | 'diagram';

/** Objects whose body is authored prose or an outline, and so get a writable
 * editor rather than a read-only "live object" note. */
const DOCUMENT_EDITOR_KINDS = new Set<CreationObjectKind>(['document', 'prd', 'knowledge', 'note', 'report', 'slides']);

const EXPORT_MIME: Readonly<Record<CanvasExportAction, string>> = {
  copy: 'text/plain', markdown: 'text/markdown', csv: 'text/csv', json: 'application/json',
  diagram: 'application/vnd.jgraph.mxfile',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** The format an object exports to when nothing more specific was asked for —
 * a deck becomes a deck, a sheet becomes rows, a diagram stays a diagram. */
export function defaultExportAction(kind: CreationObjectKind): CanvasExportAction {
  if (kind === 'slides') return 'pptx';
  if (kind === 'diagram') return 'diagram';
  if (kind === 'spreadsheet' || kind === 'table' || kind === 'dataset') return 'csv';
  if (kind === 'document' || kind === 'prd' || kind === 'knowledge' || kind === 'report' || kind === 'note') return 'docx';
  return 'markdown';
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

/**
 * Canonical Dataset object fields for an imported or attached tabular file.
 * Both the inspector importer and the composer attachment build the object
 * through this helper, so an uploaded file is previewable and queryable no
 * matter which route it arrived by.
 */
function datasetObjectData(fileName: string, source: TabularSource, options: { mimeType?: string; subtitle: string; status: string }): Partial<CreationNodeData> {
  return {
    title: fileName,
    fileName,
    ...(options.mimeType ? { mimeType: options.mimeType } : {}),
    columns: source.columns,
    rows: source.rows,
    sampleRows: source.rows.slice(0, 25),
    rowCount: source.rows.length,
    profile: profileTabular(source),
    status: options.status,
    subtitle: options.subtitle,
  };
}

/** Text attachments Brain can read directly once they are on the canvas. */
const READABLE_TEXT_FILE = /\.(txt|md|markdown|log|xml|yaml|yml|html?|sql|ini|conf|env\.example)$/i;
const MAX_FILE_PREVIEW_CHARS = 20_000;

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

/** Canonical project state rendered over an attached Evermind node. Kept outside the
 * persisted canvas graph so a 20-second live refresh never creates canvas revisions. */
export function projectEvermindNodePatch(head: ProjectEvermindHead, activity: ProjectEvermindContributions): Partial<CreationNodeData> {
  const measuredLoss = activity.training.find((point) => point.loss > 0)?.loss;
  return {
    title: head.name || 'Project Evermind',
    status: head.seeded ? `${head.mode === 'connected' ? 'Learning' : 'Frozen'} · v${head.version}` : 'Ready to seed',
    evermindVersion: head.version,
    evermindSeeded: head.seeded,
    contributions: activity.contributions,
    pendingContributions: activity.pending,
    recentLearnings: activity.recent,
    trainingLoss: measuredLoss,
    learningMode: activity.mode,
    lastLearnedAt: activity.lastLearnedAt,
    quarantinedAt: activity.quarantinedAt ?? head.quarantinedAt,
    quarantineReason: activity.quarantineReason ?? head.quarantineReason,
    evalPoint: activity.eval,
    inferenceEnabled: activity.inferenceEnabled,
    teacherModel: activity.teacherModel || undefined,
    evermindLoading: false,
  };
}

function CanvasInner({ sessionId, persistence, initialFocusId, initialShareOpen = false, initialPresent = false }: { sessionId: string; persistence: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialPresent?: boolean }) {
  const t = useTranslations('creationCanvas');
  /** Chrome shared with every other spatial canvas lives in its own namespace. */
  const tCommands = useTranslations('canvasCommands');
  const tFiles = useTranslations('creationCanvas.files');
  const confirm = useConfirm();
  const toast = useToast();
  const storageKey = creationStorageKey(sessionId);
  const [nodes, setNodes, onNodesChange] = useNodesState<CreationFlowNode>(persistence === 'local' ? INITIAL_NODES : []);
  const [evermindLiveByNodeId, setEvermindLiveByNodeId] = useState<Record<string, Partial<CreationNodeData>>>({});
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(persistence === 'local' ? INITIAL_EDGES : []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scopeMode, setScopeMode] = useState<'auto' | 'canvas' | 'selection' | 'connected' | 'frame'>('auto');
  const [connectionKind, setConnectionKind] = useState<CreationConnectionKind>('reference');
  const [title, setTitle] = useState('Untitled session');
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(true);
  /**
   * The 3D reading of this canvas. It replaces the flat board rather than
   * floating over it — two live views of the same objects would compete for the
   * same pointer, and the point of the mode is to read depth without distraction.
   */
  const [threeD, setThreeD] = useState(false);
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
    try {
      const savedOpen = localStorage.getItem(PALETTE_OPEN_STORAGE_KEY);
      setPaletteOpen(savedOpen === '1' || (savedOpen == null && window.innerWidth > 760));
    } catch { setPaletteOpen(window.innerWidth > 760); }
    setPalettePreferencesReady(true);
  }, []);
  const [presentMode, setPresentMode] = useState(initialPresent);
  const [drawingMode, setDrawingMode] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const [branchParentId, setBranchParentId] = useState<string | null>(null);
  const [mergeReview, setMergeReview] = useState<MergeReview | null>(null);
  const [workflowFocus, setWorkflowFocus] = useState<{ nodeId: string; definitionId: string | null } | null>(null);
  const [trainingFocus, setTrainingFocus] = useState<{ nodeId: string; projectId: number | string; localOnly: boolean } | null>(null);
  const [framePresets, setFramePresets] = useState<FramePreset[]>([]);
  const [serverTemplates, setServerTemplates] = useState<ServerCreationTemplate[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CreationSessionSummary['role']>('editor');
  const [prompt, setPrompt] = useState('');
  const [thinking, setThinking] = useState(false);
  // When the in-flight turn began. Shared with every Brain surface (dock strip,
  // transcript, board anchor) so they narrate the same phase at the same instant.
  const [brainRunStartedAt, setBrainRunStartedAt] = useState<number | null>(null);
  const [activeAgentIds, setActiveAgentIds] = useState<Set<string>>(() => new Set());
  const [modelSelection, setModelSelection] = useState<ChatModelSelection>({ mode: 'auto' });
  const llmModels = useLlmModels();
  const canvasModelOptions = useMemo<ChatModelOptions>(() => ({
    configured: llmModels.tenantModels.map((model) => ({ id: model.ref, label: model.name })),
    byo: llmModels.fundingSurface.byo.models.map(({ id, vendor }) => ({ id, vendor })),
    free: llmModels.freeModels,
    plan: llmModels.models,
    paid: llmModels.premiumModels.map((model) => ({
      id: model.id,
      cost: `$${(model.pricing.prompt * 1_000_000).toFixed(2)} input / $${(model.pricing.completion * 1_000_000).toFixed(2)} output per 1M tokens + $0.01/request`,
    })),
  }), [llmModels]);
  const [tourStep, setTourStep] = useState(0);
  const [notice, setNotice] = useState('Session saved');

  /**
   * SHARED FREE SESSION (no account).
   *
   * An account-less canvas used to be strictly single-player: "Share" opened a
   * sign-up gate, which answers a question nobody asked — they wanted to show
   * someone the board, not to file paperwork. So a local canvas can now open the
   * same guest ROOM the free Brain chat uses: an invite link, a roster, a combined
   * turn allowance, and (on the chat surface) a camera meeting.
   *
   * The board syncs through the room as ONE serialized snapshot, last-writer-wins
   * on the existing save debounce. That is deliberately not a CRDT: this is a
   * short-lived ≤8-person free session, and an operational-transform stack has
   * failure modes far worse than "whoever moved a card most recently won".
   * localStorage stays the local cache, so a dropped connection still leaves the
   * board on the device that was editing it.
   */
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const guestName = useRef('');
  useEffect(() => {
    if (persistence !== 'local') return;
    setRoomCode(getActiveGuestRoom());
    guestName.current = getGuestDisplayName();
  }, [persistence]);
  const room = useGuestRoom(persistence === 'local' ? roomCode : null, { name: guestName.current });
  const inRoom = persistence === 'local' && !!roomCode;
  /** Read inside callbacks that must not re-create when the room changes. */
  const roomCodeRef = useRef<string | null>(null);
  roomCodeRef.current = inRoom ? roomCode : null;
  /** The snapshot most recently exchanged with the room — suppresses echo. */
  const lastRoomSnapshot = useRef<string>('');
  /**
   * False until this device has read the room's board (or learned it has none).
   *
   * An invitee mounts on the DEFAULT starter board and the save debounce fires
   * ~300ms later — before the first pull can land. Without this gate that empty
   * starter board would be pushed over the host's real one, and joining a shared
   * canvas would wipe it. Pushes are held until the pull settles.
   */
  const roomHydrated = useRef(false);
  const announceCanvas = room.announceCanvas;

  /**
   * The ONE write for an account-less canvas: this device, and — when the session
   * is shared — the room everybody else is reading. Called by every local save
   * path, so a shared board can never be updated by one of them and missed by
   * another.
   */
  const persistSnapshot = useCallback((snapshot: LocalCreationSnapshot) => {
    writeLocalCreationSession(sessionId, snapshot);
    const code = roomCodeRef.current;
    if (!code || !roomHydrated.current) return;
    const serialized = JSON.stringify(snapshot);
    // Don't push back what we just pulled — that is how two peers get into a
    // permanent round-trip over a board neither of them is touching.
    if (serialized === lastRoomSnapshot.current) return;
    lastRoomSnapshot.current = serialized;
    void pushGuestRoomCanvas(code, serialized).then((stored) => {
      if (stored) announceCanvas();
      // A board too big for the room's slot must say so out loud: everyone here
      // would otherwise keep editing while late joiners load a stale board.
      else setNotice(t('sharedBoardTooLarge'));
    });
  }, [sessionId, announceCanvas, t]);
  const [loadingSession, setLoadingSession] = useState(persistence === 'server');
  const [realtimeState, setRealtimeState] = useState<'local' | 'connecting' | 'online' | 'reconnecting' | 'offline'>(persistence === 'local' ? 'local' : 'connecting');
  const [members, setMembers] = useState<CreationSessionDetail['members']>([]);
  const [joinedCollaborator, setJoinedCollaborator] = useState<CreationSessionDetail['members'][number] | null>(null);
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
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // ONE Brain surface: which side it is parked on, how wide, and whether the user
  // wants the step list. Read from storage after mount so SSR stays deterministic.
  const [brainDock, setBrainDock] = useState(DEFAULT_BRAIN_DOCK_PREFERENCES);
  const [inspectorFocus, setInspectorFocus] = useState<'knowledge' | 'test' | 'evaluation' | 'delivery' | null>(null);
  const [outcomeMetricsOpen, setOutcomeMetricsOpen] = useState(false);
  const [outcomeMetrics, setOutcomeMetrics] = useState<CreationOutcomeMetrics | null>(null);
  const [outcomeMetricsLoading, setOutcomeMetricsLoading] = useState(false);
  const [outcomeMetricsError, setOutcomeMetricsError] = useState<string | null>(null);
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
  const isComposingPrompt = prompt.trim().length > 0;
  const requireAccount = useCallback((action: string, title: string, description: string) => {
    setAccountGate({ action, title, description });
    trackActivity('creation_account_gate_shown', { sessionId, metadata: { clientSurface: 'web', action } });
  }, [sessionId]);
  useEffect(() => {
    if (!palettePreferencesReady) return;
    try {
      localStorage.setItem(PALETTE_COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedPaletteGroups]));
      localStorage.setItem(PALETTE_OPEN_STORAGE_KEY, paletteOpen ? '1' : '0');
    } catch { /* storage can be unavailable in hardened contexts */ }
  }, [collapsedPaletteGroups, paletteOpen, palettePreferencesReady]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<ReactFlowInstance<CreationFlowNode, Edge> | null>(null);
  const hydrated = useRef(false);
  const revision = useRef(1);
  const lastSavedGraph = useRef('');
  const sessionOpenCorrelation = useRef(crypto.randomUUID());
  const currentGraph = useRef('');
  const saveInFlight = useRef(false);
  const activePresenceInitialized = useRef(false);
  const activeMemberIds = useRef<Set<string>>(new Set());
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
  const initialPromptSubmitted = useRef(false);
  const autoApplyRef = useRef(false);
  const mobileViewportFitted = useRef(false);

  useEffect(() => {
    const enabled = isBrainAutoApprove();
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
  }, []);

  useEffect(() => { setBrainDock(readBrainDockPreferences()); }, []);

  /**
   * Persist AND report the layout the user chose. The signal is what lets the
   * shipped default become the layout people actually prefer instead of a guess.
   * A resize drag passes persist=false so the board reflows live without writing
   * storage — and firing a preference signal — on every pointer move.
   */
  const updateBrainDock = useCallback((patch: Partial<BrainDockPreferences>, persist = true) => {
    setBrainDock((current) => {
      const next = { ...current, ...patch };
      if (persist) {
        writeBrainDockPreferences(next);
        trackActivity('creation_brain_dock_preference', { sessionId, metadata: { clientSurface: 'web', ...next } });
      }
      return next;
    });
  }, [sessionId]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (typeof document === 'undefined' || !shell) return;
    if (document.fullscreenElement) { void document.exitFullscreen?.().catch(() => undefined); return; }
    const request = shell.requestFullscreen?.();
    if (request) void request.catch(() => toast.error(t('fullScreenUnavailable')));
    else toast.error(t('fullScreenUnavailable'));
  }, [t, toast]);

  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement && document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
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
          setTimeline((saved.timeline ?? []).map((message) => ({ clientMessageId: message.clientMessageId, messageRole: message.role, body: message.body, metadata: message.metadata ?? {}, createdAt: message.createdAt })));
          if (saved.viewport) { viewportRef.current = saved.viewport; pendingViewport.current = saved.viewport; void flowRef.current?.setViewport(saved.viewport); }
        }
        hydrated.current = true;
        trackActivity('creation_session_opened', { sessionId, metadata: { clientSurface: 'web', persistence: 'local' } });
        return;
      }
      const openedAt = performance.now();
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'started' }).catch(() => undefined);
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
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'succeeded', durationMs: performance.now() - openedAt }).catch(() => undefined);
        setNotice('Session saved');
      }).catch((error) => {
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: sessionOpenCorrelation.current, action: 'session.open', phase: 'failed', durationMs: performance.now() - openedAt }).catch(() => undefined);
        setNotice(error instanceof Error ? error.message : 'Could not load session');
      }).finally(() => setLoadingSession(false));
    } catch { hydrated.current = true; }
  }, [persistence, sessionId, setEdges, setNodes]);

  /**
   * Adopt the room's board. Used for the first load in a shared session and for
   * every peer edit after it.
   *
   * Setting `lastSavedGraph`/`lastRoomSnapshot` BEFORE the state lands is the
   * whole trick: both save debounces compare against them and bail, so applying a
   * peer's board cannot be mistaken for a local edit and pushed straight back —
   * which is how a two-person session turns into an infinite sync loop.
   */
  const applyRoomSnapshot = useCallback((serialized: string) => {
    let snapshot: LocalCreationSnapshot;
    try {
      snapshot = JSON.parse(serialized) as LocalCreationSnapshot;
    } catch {
      return; // a corrupt board is not worth wiping a good local one for
    }
    if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return;
    lastRoomSnapshot.current = serialized;
    lastSavedGraph.current = JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges });
    setTitle(snapshot.title);
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setTimeline((snapshot.timeline ?? []).map((message) => ({
      clientMessageId: message.clientMessageId,
      messageRole: message.role,
      body: message.body,
      metadata: message.metadata ?? {},
      createdAt: message.createdAt,
    })));
    // The viewport is personal — following someone else's pan mid-edit is
    // disorienting, and each participant keeps their own place on the board.
    writeLocalCreationSession(sessionId, snapshot);
  }, [sessionId, setEdges, setNodes]);

  // Pull the shared board: once on entering a room (this is how a LATE joiner
  // sees anything at all) and again whenever a peer announces a new one.
  useEffect(() => {
    if (persistence !== 'local' || !roomCode) { roomHydrated.current = false; return; }
    let cancelled = false;
    void fetchGuestRoomCanvas(roomCode).then((serialized) => {
      if (cancelled) return;
      // A room with no board yet (the host is mid-create) means THIS device's
      // board becomes the shared one — so open the gate either way.
      if (serialized) { applyRoomSnapshot(serialized); hydrated.current = true; }
      roomHydrated.current = true;
    });
    return () => { cancelled = true; };
  }, [persistence, roomCode, room.canvasVersion, applyRoomSnapshot]);

  /**
   * Turn this private board into a shared session. The board comes WITH it —
   * "invite people to this canvas" that starts them on an empty one would be a
   * different (and worse) feature.
   */
  const startSharedSession = useCallback(async () => {
    setRoomBusy(true);
    const name = guestName.current.trim() || t('sharedDefaultHostName');
    setGuestDisplayName(name);
    guestName.current = name;
    const state = await createGuestRoom(name, title, 'canvas');
    if (typeof state === 'string') {
      setNotice(state === 'unavailable' ? t('sharedUnavailable') : t('sharedEnded'));
      setRoomBusy(false);
      return;
    }
    const snapshot: LocalCreationSnapshot = {
      version: 1,
      title,
      initialPrompt: readLocalCreationSession(sessionId)?.initialPrompt,
      timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })),
      nodes,
      edges,
      viewport: viewportRef.current,
      updatedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(snapshot);
    lastRoomSnapshot.current = serialized;
    // The host's board IS the room's board — no pull to wait for.
    roomHydrated.current = true;
    const stored = await pushGuestRoomCanvas(state.code, serialized);
    setRoomCode(state.code);
    setRoomBusy(false);
    setNotice(stored ? t('sharedStarted') : t('sharedBoardTooLarge'));
  }, [edges, nodes, sessionId, t, timeline, title, viewportRef]);

  /** Stop sharing on THIS device. The board stays here; the room runs on for anyone else. */
  const leaveSharedSession = useCallback(async () => {
    const code = roomCodeRef.current;
    setRoomCode(null);
    lastRoomSnapshot.current = '';
    if (code) await leaveGuestRoom(code);
    setNotice(t('sharedLeft'));
  }, [t]);

  const evermindBindingKey = useMemo(() => JSON.stringify(nodes.flatMap((node) => {
    const match = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string'
      ? /^evermind:(\d+)$/.exec(node.data.resourceId)
      : null;
    return match ? [{ nodeId: node.id, projectId: Number(match[1]) }] : [];
  }).sort((a, b) => a.nodeId.localeCompare(b.nodeId))), [nodes]);

  useEffect(() => {
    if (persistence !== 'server' || evermindBindingKey === '[]') {
      setEvermindLiveByNodeId({});
      return;
    }
    let stopped = false;
    const bindings = JSON.parse(evermindBindingKey) as Array<{ nodeId: string; projectId: number }>;
    const sync = async () => {
      const byProject = new Map<number, Promise<[ProjectEvermindHead, ProjectEvermindContributions]>>();
      for (const binding of bindings) {
        if (!byProject.has(binding.projectId)) byProject.set(binding.projectId, Promise.all([getProjectEvermindHead(binding.projectId), getProjectEvermindContributions(binding.projectId)]));
      }
      const settled = await Promise.all(bindings.map(async (binding) => {
        try {
          const [head, activity] = await byProject.get(binding.projectId)!;
          return [binding.nodeId, projectEvermindNodePatch(head, activity)] as const;
        } catch { return null; }
      }));
      if (stopped) return;
      const activeNodeIds = new Set(bindings.map((binding) => binding.nodeId));
      setEvermindLiveByNodeId((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([nodeId]) => activeNodeIds.has(nodeId)));
        for (const entry of settled) {
          if (entry) next[entry[0]] = entry[1];
        }
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 20_000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [evermindBindingKey, persistence]);

  useEffect(() => { currentGraph.current = JSON.stringify({ nodes, edges }); }, [edges, nodes]);

  // A persisted viewport is expressed in screen pixels, so restoring a camera
  // saved on desktop can put the useful part of the graph beyond a phone's
  // narrow viewport. Reframe once after hydration; subsequent pans and zooms
  // remain entirely under the user's control.
  useEffect(() => {
    if (loadingSession || mobileViewportFitted.current || !nodes.length || typeof window === 'undefined' || window.innerWidth > 760) return;
    const handle = window.setTimeout(() => {
      if (!flowRef.current) return;
      mobileViewportFitted.current = true;
      // A full desktop graph can otherwise shrink to an illegible thumbnail on
      // a phone. Keep objects readable and let the user pan to off-screen work.
      void flowRef.current.fitView({ padding: 0.18, minZoom: 0.62, maxZoom: 0.82, duration: 280 });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [loadingSession, nodes]);

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
        const snapshot: LocalCreationSnapshot = { version: 1, title, initialPrompt: prior?.initialPrompt, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), nodes, edges, viewport: viewportRef.current, updatedAt: new Date().toISOString() };
        persistSnapshot(snapshot);
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
      const snapshot: LocalCreationSnapshot = { ...prior, title, nodes, edges, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), viewport: viewportRef.current, updatedAt: new Date().toISOString() };
      persistSnapshot(snapshot);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [edges, nodes, persistence, sessionId, storageKey, timeline, title]);

  useEffect(() => {
    if (persistence !== 'server') return;
    let stopped = false;
    const reconcile = async () => {
      try {
        const presence = await creationSessionsApi.presence(sessionId, { revision: revision.current, viewport: viewportRef.current, cursor: cursorRef.current, selection: selectedIds, typing: isComposingPrompt, followingUserId });
        if (stopped) return;
        const nextActiveIds = new Set(presence.members.map((member) => member.userId));
        if (activePresenceInitialized.current) {
          const joined = presence.members.find((member) => member.userId !== (presence.currentUserId || currentUserId) && !activeMemberIds.current.has(member.userId));
          if (joined) setJoinedCollaborator(joined);
        } else activePresenceInitialized.current = true;
        activeMemberIds.current = nextActiveIds;
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
  }, [currentUserId, followingUserId, isComposingPrompt, persistence, selectedIds, sessionId, setEdges, setNodes]);

  useEffect(() => {
    if (!joinedCollaborator) return;
    const timer = window.setTimeout(() => setJoinedCollaborator(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [joinedCollaborator]);

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
        if (node.id === selectedNode.id) return;
        const withinX = node.position.x >= selectedNode.position.x
          && node.position.x <= selectedNode.position.x + width;
        const withinY = node.position.y >= selectedNode.position.y
          && node.position.y <= selectedNode.position.y + height;
        if (withinX && withinY) selected.add(node.id);
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

  /** One writer for an object's content, wherever the edit was made — the
   * inspector, a cell edited on the card itself, or the Files library. */
  const updateNodeData = useCallback((nodeId: string, patch: Partial<CreationNodeData>) => {
    if (!canEdit || lockBlocked) return;
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node));
    setNotice('Saving changes…');
  }, [canEdit, lockBlocked, setNodes]);

  const updateSelected = useCallback((patch: Partial<CreationNodeData>) => {
    if (!selectedId) return;
    updateNodeData(selectedId, patch);
  }, [selectedId, updateNodeData]);

  const updateWebsiteViewport = useCallback((viewport: 'desktop' | 'tablet' | 'mobile') => {
    if (!selectedId || !canEdit || lockBlocked) return;
    const preset = viewport === 'mobile' ? { width: 340, height: 620 } : viewport === 'tablet' ? { width: 520, height: 560 } : { width: 720, height: 460 };
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, style: { ...node.style, ...preset }, data: { ...node.data, viewport } } : node));
    setNotice(`Website viewport changed to ${viewport}`);
  }, [canEdit, lockBlocked, selectedId, setNodes]);

  const appendTimeline = useCallback((role: 'user' | 'assistant' | 'system', body: string, metadata: CreationTimelineMessage['metadata'] = {}, clientMessageId = crypto.randomUUID()) => {
    const message: CanvasTimelineMessage = { clientMessageId, messageRole: role, body, metadata, createdAt: new Date().toISOString() };
    setTimeline((current) => current.some((item) => item.clientMessageId === clientMessageId) ? current : [...current, message]);
    if (persistence === 'server') void creationSessionsApi.timeline.append(sessionId, { clientMessageId, role, body, metadata }).then((saved) => {
      setTimeline((current) => current.map((item) => item.clientMessageId === clientMessageId ? saved : item));
    }).catch((error) => setNotice(error instanceof Error ? `Conversation save failed: ${error.message}` : 'Conversation save failed'));
    return clientMessageId;
  }, [persistence, sessionId]);

  // The Brain Object mirrors the live turn — messages, trace, and the run state that
  // drives its activity bar — so a working Brain reads as working on the board too,
  // not only inside the dock (which the user may have closed).
  useEffect(() => {
    const messages = timeline.map((message) => ({ role: message.messageRole, content: message.body, createdAt: message.createdAt }));
    setNodes((current) => current.map((node) => node.data.kind === 'chat' ? { ...node, data: { ...node.data, messages, ...(brainTrace.length ? { trace: brainTrace } : {}), brainRunning: thinking, brainRunStartedAt, aiResponse: [...timeline].reverse().find((message) => message.messageRole === 'assistant')?.body || node.data.aiResponse } } : node));
  }, [brainRunStartedAt, brainTrace, setNodes, thinking, timeline]);

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
      const parsed = parseTabularText(file.name, await file.text());
      if (parsed.rows.length > datasetRowLimit) throw new Error(t('datasetRowLimit', { limit: datasetRowLimit.toLocaleString() }));
      if (!parsed.columns.length) throw new Error(t('datasetNoColumns'));
      const shape = { rows: parsed.rows.length.toLocaleString(), columns: parsed.columns.length };
      setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...datasetObjectData(file.name, parsed, { mimeType: file.type, subtitle: t('datasetShape', shape), status: t('datasetStatusImported') }) } } : node));
      setNotice(t('datasetImported', { name: file.name, rows: parsed.rows.length.toLocaleString(), columns: parsed.columns.length }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('datasetImportFailed'));
    }
  }, [datasetRowLimit, selectedId, setNodes, t]);

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
    setNodes((current) => current.map((node) => ids.has(node.id) && canvasPlacementUnlocked(node) ? { ...node, position: { ...node.position, x: left } } : node));
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
    const shouldLock = nodes.some((node) => ids.has(node.id) && canvasPlacementUnlocked(node));
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

  /**
   * The commands the 3D scene publishes while it is on screen, and `null` in the
   * flat view. Everything the canvas can do to its own camera — focus, zoom, fit
   * — routes through this so there is ONE action per command that means the right
   * thing in whichever view is live, rather than a control that quietly dies in
   * the other one.
   */
  const threeDControls = useCanvas3DControls();
  const focusSelection = useCallback(() => {
    const ids = selectionIds(); if (!ids.length) return;
    if (threeDControls) { threeDControls.focusObjects(ids); return; }
    void flowRef.current?.fitView({ nodes: ids.map((id) => ({ id })), padding: 0.28, duration: 350 });
  }, [selectionIds, threeDControls]);

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
        setNodes((current) => current.map((node) => ids.has(node.id) && canvasPlacementUnlocked(node) ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node));
      }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [canEdit, copySelection, duplicateSelection, pasteSelection, redo, selectionIds, setEdges, setNodes, undo]);

  const visualizeDataset = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'dataset') return;
    const source = tabularFromObject(selectedNode.data as Record<string, unknown>);
    if (!source.columns.length || !source.rows.length) { setNotice(t('datasetImportBeforeVisualizing')); return; }
    // Group by the most informative low-cardinality column and total the first
    // numeric measure, rather than charting the first six rows verbatim.
    const profile = profileTabular(source);
    const groupable = (column: { distinct: number }) => {
      const distinct = column.distinct;
      if (distinct < 2) return false;
      return distinct < 25;
    };
    const category = profile.find((column) => column.type !== 'number' && groupable(column))
      ?? profile.find(groupable)
      ?? profile[0]!;
    const measure = profile.find((column) => column.type === 'number' && column.name !== category.name);
    const result = queryTabular(source, {
      groupBy: category.name,
      aggregate: measure ? [{ op: 'sum', column: measure.name, label: measure.name }] : [{ op: 'count', label: 'count' }],
      sort: { column: measure ? measure.name : 'count', direction: 'desc' },
      limit: 8,
    });
    const valueKey = measure ? measure.name : 'count';
    const dashboard = newNode('dashboard', { x: selectedNode.position.x + 440, y: selectedNode.position.y });
    dashboard.data = {
      ...dashboard.data,
      title: t('datasetVisualizationTitle', { name: selectedNode.data.title }),
      status: t('statusLive'),
      chartTitle: measure ? t('chartTitleMeasureBy', { measure: measure.name, category: category.name }) : t('chartTitleCountBy', { category: category.name }),
      xAxisLabel: category.name,
      yAxisLabel: measure ? measure.name : t('chartCountAxis'),
      chartLabels: (result.groups ?? []).map((group) => group.key),
      chartValues: (result.groups ?? []).map((group) => Number(group[valueKey] ?? group.count)),
      kpis: [
        { label: t('kpiTotalRows'), value: result.totalRows.toLocaleString() },
        { label: t('kpiGroups', { category: category.name }), value: String(result.groups?.length ?? 0) },
      ],
      sourceDatasetId: selectedNode.id,
      subtitle: measure ? t('chartTitleMeasureBy', { measure: measure.name, category: category.name }) : t('chartTitleCountBy', { category: category.name }),
    };
    setNodes((current) => [...current, dashboard]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: selectedNode.id, target: dashboard.id, type: 'smoothstep', label: t('edgeVisualizes'), animated: true, data: { connectionKind: 'data' } }]);
    setSelectedId(dashboard.id);
    setNotice(t('datasetVisualizationAdded'));
  }, [selectedNode, setEdges, setNodes, t]);

  const profileDataset = useCallback((nodeId: string) => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return;
    const source = tabularFromObject(target.data as Record<string, unknown>);
    if (!source.columns.length || !source.rows.length) { setNotice(t('datasetImportBeforeProfiling')); return; }
    const profile = profileTabular(source);
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, profile, rowCount: source.rows.length, columns: source.columns, summary: t('datasetProfileSummary', { rows: source.rows.length.toLocaleString(), columns: source.columns.length, complete: profile.filter((column) => !column.empty).length }) } }
      : node));
    setNotice(t('datasetProfiled', { columns: profile.length }));
  }, [nodes, setNodes, t]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: 'smoothstep', data: { connectionKind }, label: connectionKind, markerEnd: { type: MarkerType.ArrowClosed } }, current));
    trackActivity('creation_connection_added', { sessionId, metadata: { clientSurface: 'web', connectionKind } });
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (persistence === 'server' && source && target && source.data.kind !== 'chat' && target.data.kind !== 'chat') {
      const correlationId = crypto.randomUUID();
      const metadata = { sourceKind: source.data.kind, targetKind: target.data.kind, connectionKind };
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'started', artifactId: source.id, metadata }).catch(() => undefined);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'output.reuse', phase: 'reused', artifactId: source.id, metricKey: 'outputs_reused', metricValue: 1, unit: 'count', metadata }).catch(() => undefined);
    }
  }, [connectionKind, nodes, persistence, sessionId, setEdges]);

  /** Selecting the Brain Object reveals the dock instead of a second transcript. */
  const openBrainDock = useCallback(() => setBrainDock((current) => {
    if (current.open) return current;
    const next = { ...current, open: true };
    writeBrainDockPreferences(next);
    return next;
  }), []);

  const onNodeClick: NodeMouseHandler<CreationFlowNode> = useCallback((_event, node) => {
    setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
    setInspectorFocus(null); setSelectedId(node.id); if (!node.selected) setSelectedIds([node.id]);
    if (node.data.kind === 'chat') openBrainDock();
  }, [openBrainDock]);
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
    const snapshot: LocalCreationSnapshot = { version: 1, title, initialPrompt: prior?.initialPrompt, timeline: timeline.map((message) => ({ clientMessageId: message.clientMessageId, role: message.messageRole, body: message.body, metadata: message.metadata, createdAt: message.createdAt })), nodes, edges, viewport, updatedAt: new Date().toISOString() };
    persistSnapshot(snapshot);
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

  const attachCanvasArtifact = useCallback(async (file: File) => {
    if (!canEdit) { setNotice(t('roleCannotEdit')); return; }
    const position = flowRef.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 500, y: 300 };
    const isImage = file.type.startsWith('image/');
    // A dropped data file becomes a real Dataset, not an opaque attachment:
    // it must be previewable on the canvas and queryable by Brain immediately.
    const tabular = !isImage && isTabularFile(file.name, file.type) ? parseTabularText(file.name, await file.text()) : null;
    const parsed = tabular?.columns.length && tabular.rows.length ? tabular : null;
    const node = newNode(isImage ? 'image' : parsed ? 'dataset' : 'file', position);
    let dataUrl: string | null = null;
    if (isImage) {
      dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }
    const readableText = !isImage && !parsed && (READABLE_TEXT_FILE.test(file.name) || file.type.startsWith('text/'))
      ? (await file.text()).slice(0, MAX_FILE_PREVIEW_CHARS)
      : '';
    node.data = parsed
      ? {
        ...node.data,
        ...datasetObjectData(file.name, parsed, {
          mimeType: file.type || 'text/csv',
          subtitle: t('datasetShape', { rows: parsed.rows.length.toLocaleString(), columns: parsed.columns.length }),
          status: t('datasetStatusImported'),
        }),
        fileSize: file.size,
      }
      : {
        ...node.data,
        title: file.name,
        fileName: file.name,
        subtitle: `${file.type || t('fileGeneric')} · ${Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB`,
        status: isImage ? t('imageAttached') : t('fileAttached'),
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        ...(readableText ? { content: readableText } : {}),
        ...(dataUrl ? { thumbnailUrl: dataUrl, outputUrl: dataUrl } : {}),
      };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
    setSelectedIds([node.id]);
    setNotice(parsed
      ? t('datasetAttached', { name: file.name, rows: parsed.rows.length.toLocaleString(), columns: parsed.columns.length })
      : t('fileAddedToCanvas', { name: file.name }));
    trackActivity('creation_object_added', { sessionId, metadata: { clientSurface: 'web', objectKinds: [node.data.kind], source: 'composer_attachment' } });
  }, [canEdit, sessionId, setNodes, t]);

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
    const validationCorrelationId = crypto.randomUUID();
    const validationStartedAt = performance.now();
    void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'started', projectId: Number(projectId), artifactId: project.id }).catch(() => undefined);
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
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'validated', projectId: Number(projectId), artifactId: project.id, durationMs: performance.now() - validationStartedAt, metricKey: 'validation_pass', metricValue: Number(quality.result.score ?? 0) >= 70 ? 1 : 0, unit: 'boolean', metadata: { score: quality.result.score, diagnosticCount: diagnostics.length } }).catch(() => undefined);
    }).catch((error) => {
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: validationCorrelationId, action: 'artifact.validate', phase: 'failed', projectId: Number(projectId), artifactId: project.id, durationMs: performance.now() - validationStartedAt }).catch(() => undefined);
      setNotice(error instanceof Error ? error.message : 'Could not load project quality');
    });
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
      const deliveryCorrelationId = crypto.randomUUID();
      const deliveryStartedAt = performance.now();
      const deliverable: CreationDeliverable = { id: deliveryCorrelationId, action: 'deliver', artifactKind: 'project-task', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-tasks', resourceRef: `project:${projectId}` };
      setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivering…', deliverables: withCreationDeliverable(node.data, deliverable) } } : node));
      void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'started', projectId, artifactId: selectedNode.id, metadata: { kind: selectedNode.data.kind } }).catch(() => undefined);
      setNotice('Creating delivery task…');
      const agentRef = agent?.data.resourceId?.startsWith('agent:') ? agent.data.resourceId.slice('agent:'.length) : undefined;
      void tasksApi.create({
        projectId,
        title: `Build ${selectedNode.data.title}`,
        description: `${selectedNode.data.subtitle || 'Implement the approved canvas mockup.'}\n\nSource creation session: ${sessionId}\nSource canvas object: ${selectedNode.id}`,
        priority: 'high',
        ...(agentRef ? { assignedAgentRef: agentRef } : {}),
      }).then(async (created) => {
        const delivered: CreationDeliverable = { ...deliverable, status: 'delivered', completedAt: new Date().toISOString(), resourceRef: `task:${created.id}`, validation: { status: 'passed', detail: `Task ${created.key || created.id} created in ${project?.data.title || `project ${projectId}`}` }, metadata: { projectId, taskId: created.id, agentRef: agentRef || null } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivered', deliverables: withCreationDeliverable(node.data, delivered) } } : node));
        const canvasTaskId = addTaskNode(`task:${created.id}`, created.status || (agentRef ? 'Assigned' : 'Ready'), { taskKey: created.key, priority: created.priority, content: created.description || undefined, agentRef: created.assignedAgentRef || undefined });
        trackActivity('creation_artifact_delivered', { sessionId, metadata: { clientSurface: 'web', objectKinds: [selectedNode.data.kind], projectId } });
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'succeeded', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt, metricKey: 'delivered_outcomes', metricValue: 1, unit: 'count', metadata: { taskId: created.id, agentAssigned: !!agentRef } }).catch(() => undefined);
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
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Could not create delivery task';
        const failed: CreationDeliverable = { ...deliverable, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: 'Delivery failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        void creationSessionsApi.recordOutcome(sessionId, { correlationId: deliveryCorrelationId, action: 'artifact.deliver', phase: 'failed', projectId, artifactId: selectedNode.id, durationMs: performance.now() - deliveryStartedAt }).catch(() => undefined);
        setNotice(message);
      });
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
    const evermindNodeId = selectedNode.id;
    const project = nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || ''));
    if (!project) { setNotice('Add a saved project to the canvas first'); return; }
    const projectId = Number(project.data.resourceId!.slice('project:'.length));
    setNodes((current) => current.map((node) => node.id === evermindNodeId ? { ...node, data: { ...node.data, resourceId: `evermind:${projectId}`, projectId, status: 'Syncing project…' } } : node));
    setEdges((current) => current.some((edge) => edge.source === project.id && edge.target === selectedNode.id) ? current : [...current, { id: crypto.randomUUID(), source: project.id, target: selectedNode.id, label: 'owns model', type: 'smoothstep' }]);
    void Promise.all([getProjectEvermindHead(projectId), getProjectEvermindContributions(projectId)]).then(([head, activity]) => {
      setEvermindLiveByNodeId((current) => ({ ...current, [evermindNodeId]: projectEvermindNodePatch(head, activity) }));
      setNotice('Evermind attached to project');
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load Evermind'));
  }, [nodes, selectedNode, setEdges, setNodes]);

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

  const openEvermindTraining = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'evermind') return;
    expandEvermindPipeline();
    const attached = selectedNode.data.resourceId?.match(/^evermind:(\d+)$/)?.[1];
    const projectNode = nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || ''));
    const projectId = attached ?? projectNode?.data.resourceId?.slice('project:'.length);
    if (persistence === 'server' && !projectId) {
      setNotice('Add or attach a saved project before creating a workspace training job');
      return;
    }
    setTrainingFocus({ nodeId: selectedNode.id, projectId: projectId ? Number(projectId) : `local-${sessionId}`, localOnly: persistence === 'local' });
    setNotice(persistence === 'local' ? 'Local-only adapter studio opened' : 'Adapter studio opened for this Evermind');
  }, [expandEvermindPipeline, nodes, persistence, selectedNode, sessionId]);

  const evaluateEvermind = useCallback((nodeId?: string) => {
    const target = nodes.find((node) => node.id === nodeId && node.data.kind === 'evermind')
      ?? (selectedNode?.data.kind === 'evermind' ? selectedNode : null);
    if (!target) return;
    const jobId = typeof target.data.trainingJobId === 'string' ? target.data.trainingJobId : '';
    if (!jobId) { setNotice('Train a workspace adapter before running the model evaluation'); return; }
    setNotice('Evaluating the trained adapter against its dataset…');
    void evaluateModel(jobId).then((result) => {
      const existing = nodes.find((node) => node.data.kind === 'evaluation' && node.data.modelEvaluationFor === target.id);
      const evaluation = existing ?? newNode('evaluation', { x: target.position.x + 560, y: target.position.y });
      evaluation.data = {
        ...evaluation.data,
        title: `${target.data.title} evaluation`,
        status: 'Evaluated',
        modelEvaluationFor: target.id,
        verdict: result.score >= .8 ? 'Passed' : result.score >= .6 ? 'Review required' : 'Failed',
        score: result.score,
        content: result.details,
        results: [
          { label: 'Overall', value: result.score },
          { label: 'Code correctness', value: result.code_correctness ?? 0 },
          { label: 'Reasoning quality', value: result.reasoning_quality ?? 0 },
          { label: 'Hallucination rate', value: result.hallucination_rate ?? 0 },
        ],
      };
      setNodes((current) => existing ? current.map((node) => node.id === existing.id ? evaluation : node) : [...current, evaluation]);
      setEdges((current) => current.some((edge) => edge.source === target.id && edge.target === evaluation.id) ? current : [...current, { id: crypto.randomUUID(), source: target.id, target: evaluation.id, type: 'smoothstep', label: 'evaluated by', animated: true }]);
      setNotice(`Evermind evaluation complete: ${(result.score * 100).toFixed(0)}%`);
    }).catch((error) => setNotice(error instanceof Error ? error.message : 'Evermind evaluation failed'));
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
    name: 'canvas_query_dataset',
    description: 'Compute real values from a Dataset, Table, or Spreadsheet object on this canvas, and optionally build the resulting Table, Chart, Dashboard, or KPI. This runs over every imported row, not the sample in the snapshot. Use it for any counting, totalling, ranking, comparison, success/failure split, or visualization of uploaded data. Never estimate, sample, or invent numbers when this tool can compute them.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        datasetId: { type: 'string', description: 'Object id of the dataset. Omit when the canvas holds exactly one tabular object.' },
        select: { type: 'array', items: { type: 'string' }, description: 'Columns to return. Omit for every column.' },
        filter: {
          type: 'array', description: 'Row conditions applied before grouping.',
          items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: { description: 'Comparison value, or an array for in/notIn.' } } },
        },
        filterMatch: { type: 'string', enum: ['all', 'any'], description: 'Whether every filter must match, or any one of them. Defaults to all.' },
        derive: {
          type: 'array',
          description: 'Computed columns evaluated before filtering and grouping. Use this to classify rows, for example a Status column that is "Success" when a count column equals 1 and "Failure" otherwise.',
          items: { type: 'object', required: ['name', 'when', 'then'], additionalProperties: false, properties: {
            name: { type: 'string' },
            when: { type: 'array', items: { type: 'object', required: ['column'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {} } } },
            match: { type: 'string', enum: ['all', 'any'] },
            then: { type: 'string' }, otherwise: { type: 'string' },
          } },
        },
        groupBy: { type: 'string', description: 'Column or derived column to group by. Returns one row per distinct value with real counts.' },
        aggregate: { type: 'array', items: { type: 'object', required: ['op'], additionalProperties: false, properties: { op: { type: 'string', enum: [...TABULAR_AGGREGATE_OPERATORS] }, column: { type: 'string' }, label: { type: 'string' } } } },
        sort: { type: 'object', additionalProperties: false, properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'number' },
        materializeAs: { type: 'string', enum: ['none', 'table', 'chart', 'dashboard', 'kpi'], description: 'Build a canvas object populated with the real query result. Use "table" for a row-level breakdown and "chart" or "dashboard" for a grouped visualization.' },
        title: { type: 'string', description: 'Title for the materialized object.' },
        highlight: {
          type: 'array', description: 'Row colouring for a materialized table. The first matching rule wins.',
          items: { type: 'object', required: ['column', 'tone'], additionalProperties: false, properties: { column: { type: 'string' }, op: { type: 'string', enum: [...TABULAR_FILTER_OPERATORS] }, value: {}, tone: { type: 'string', enum: ['success', 'warning', 'danger', 'info'] } } },
        },
      },
    },
    mutates: (raw: unknown) => (raw as { materializeAs?: unknown })?.materializeAs != null && (raw as { materializeAs?: unknown }).materializeAs !== 'none',
    run: (raw: unknown) => {
      const args = raw as TabularQuery & { datasetId?: string; materializeAs?: string; title?: string; highlight?: TabularHighlightRule[] };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const candidates = [...nodes, ...stagedNodes].filter((node) => ['dataset', 'table', 'spreadsheet'].includes(node.data.kind) && Array.isArray(node.data.rows) && node.data.rows.length > 0);
      const target = args.datasetId ? candidates.find((node) => node.id === args.datasetId) : candidates.length === 1 ? candidates[0] : undefined;
      if (!target) {
        return { error: candidates.length
          ? `Specify which dataset to query. Tabular objects on this canvas: ${candidates.map((node) => `${node.id} (${node.data.title})`).join(', ')}`
          : 'No dataset with imported rows is on this canvas. Ask the user to attach a CSV, TSV, or JSON file, or import one from the Dataset inspector.' };
      }
      const source = tabularFromObject(target.data as Record<string, unknown>);
      if (!source.rows.length) return { error: `${target.data.title} has no imported rows yet` };
      const result = queryTabular(source, args);
      if (result.unknownColumns.length) {
        return { error: `Unknown column(s): ${result.unknownColumns.join(', ')}. Available columns: ${source.columns.join(', ')}` };
      }
      const materializeAs = ['table', 'chart', 'dashboard', 'kpi'].includes(String(args.materializeAs)) ? String(args.materializeAs) as 'table' | 'chart' | 'dashboard' | 'kpi' : null;
      const payload = {
        datasetId: target.id, datasetTitle: target.data.title,
        columns: result.columns, rows: result.rows.slice(0, 20),
        totalRows: result.totalRows, matchedRows: result.matchedRows, returnedRows: result.returnedRows, truncated: result.truncated,
        ...(result.groups ? { groups: result.groups } : {}),
        ...(result.aggregates ? { aggregates: result.aggregates } : {}),
        computedFromEveryRow: true,
      };
      if (!materializeAs) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      const kind: CreationObjectKind = materializeAs;
      const existing = [...nodes, ...stagedNodes].find((node) => node.data.kind === kind && node.data.sourceDatasetId === target.id);
      const title = typeof args.title === 'string' && args.title.trim()
        ? args.title.trim().slice(0, 160)
        : `${target.data.title} ${materializeAs === 'kpi' ? 'metric' : materializeAs}`;
      const highlightRules = Array.isArray(args.highlight)
        ? args.highlight.filter((rule) => rule?.column && rule.tone).slice(0, 20)
        : [];
      const valueKey = result.columns.find((column) => column !== args.groupBy) ?? 'count';
      const fields: Record<string, unknown> = materializeAs === 'table'
        ? {
          title, columns: result.columns, rows: result.rows.slice(0, MAX_MATERIALIZED_ROWS), rowCount: result.matchedRows,
          sampleRows: result.rows.slice(0, 8), ...(highlightRules.length ? { highlightRules } : {}),
          status: `${result.matchedRows.toLocaleString()} of ${result.totalRows.toLocaleString()} rows`,
          summary: `${result.matchedRows.toLocaleString()} matching rows of ${result.totalRows.toLocaleString()} in ${target.data.title}.`,
          sourceDatasetId: target.id,
        }
        : materializeAs === 'kpi'
          ? {
            title, value: String(Object.values(result.aggregates ?? { count: result.matchedRows })[0] ?? result.matchedRows),
            status: 'Live', summary: `Computed from ${result.totalRows.toLocaleString()} rows in ${target.data.title}.`, sourceDatasetId: target.id,
          }
          : {
            title, status: 'Live',
            chartTitle: title,
            ...(args.groupBy ? { xAxisLabel: args.groupBy } : {}),
            yAxisLabel: valueKey,
            chartLabels: (result.groups ?? result.rows).map((row, index) => String((row as Record<string, unknown>).key ?? (args.groupBy ? (row as Record<string, unknown>)[args.groupBy] : '') ?? `Row ${index + 1}`)),
            chartValues: (result.groups ?? result.rows).map((row) => Number((row as Record<string, unknown>)[valueKey] ?? (row as { count?: number }).count ?? 0)),
            kpis: Object.entries(result.aggregates ?? {}).slice(0, 4).map(([label, value]) => ({ label, value: value.toLocaleString() })),
            summary: `Computed from ${result.totalRows.toLocaleString()} rows in ${target.data.title}.`,
            sourceDatasetId: target.id,
          };
      const patch = sanitizeCreationObjectPatch(kind, fields);
      if (existing) {
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.update', label: `Update ${kind} “${title}”`, objectId: existing.id, patch });
        return { ...payload, proposed: true, materialized: { id: existing.id, kind, title, updated: true } };
      }
      const node = newNode(kind, nextCanvasObjectPosition([...nodes, ...stagedNodes], { x: target.position.x + 460, y: target.position.y }, typeof window !== 'undefined' && window.innerWidth <= 760));
      node.data = { ...node.data, ...patch };
      if (kind === 'table') node.style = { width: 720, height: 460 };
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.add', label: `Add ${kind} “${title}”`, node });
      proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'connection.add', label: `Connect ${target.data.title} to ${title}`, edge: { id: crypto.randomUUID(), source: target.id, target: node.id, type: 'smoothstep', animated: true, label: 'computed from', data: { connectionKind: 'data' } } });
      return { ...payload, proposed: true, materialized: { id: node.id, kind, title, created: true } };
    },
  }, {
    name: 'canvas_add_object',
    description: 'Create a fully authored visual object. Put type-specific content in fields; supported fields depend on kind and are listed in the current canvas snapshot. Never author rows or chart values by hand from an imported dataset — use canvas_query_dataset so the artifact holds real computed values.',
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
      const updateTarget = duplicateAddUpdateTarget(prompt, args.kind, nodes, effectiveSelectedIds);
      if (updateTarget) return { error: `This is a correction to selected ${args.kind} ${updateTarget.id}. Call canvas_update_object for that object instead of creating a duplicate.` };
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const node = newNode(args.kind, nextCanvasObjectPosition([...nodes, ...stagedNodes], args, narrowViewport));
      const authored = sanitizeCreationObjectPatch(args.kind, { ...((args.fields && typeof args.fields === 'object') ? args.fields : {}), title: args.title, subtitle: args.subtitle, status: args.status });
      if (args.kind === 'drawing' && (!Array.isArray(authored.points) || authored.points.length < 2)) {
        return { error: 'A generated drawing must include at least two renderable {x,y} points. Add authored points or use a chart with chartLabels and chartValues.' };
      }
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
      const stagedNodes = proposalBuffer.current.flatMap((change) => change.type === 'object.add' ? [change.node] : []);
      const targets = canvasArrangementTargets([...nodes, ...stagedNodes], requestedIds);
      if (targets.length < 2) return { error: 'At least two unlocked objects are required to arrange the canvas' };
      const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 760;
      const arrangement = args.arrangement ?? (narrowViewport ? 'column' : undefined);
      const positions = arrangeCanvasNodes(targets, arrangement, Number(args.gap ?? 48), Number(args.columns));
      let proposed = 0;
      for (const target of targets) {
        const position = positions.get(target.id);
        if (!position || (position.x === target.position.x && position.y === target.position.y)) continue;
        proposalBuffer.current.push({ id: crypto.randomUUID(), type: 'object.layout', label: `Arrange ${target.data.title}`, objectId: target.id, position });
        proposed += 1;
      }
      return { ok: true, proposed: true, arrangedObjects: targets.length, proposedChanges: proposed, arrangement: arrangement || 'grid', gap: Math.max(16, Math.min(Number(args.gap ?? 48), 320)) };
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
      if (!canInvokeCreationObjectAction(target.data.kind, args.action)) {
        return { error: `${args.action} is declared for ${definition.label}, but no real Canvas delivery adapter is connected yet. Do not claim that it ran.` };
      }
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
  }], [canEdit, edges, effectiveSelectedIds, nodes, persistence, prompt, requireAccount, resolvedScopeMode, scopedEdges, scopedNodes, sessionId]);

  const addAgentKnowledge = useCallback((agentId: string, content: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    const authored = content.trim();
    if (!agent || !authored || !canEdit) return;
    const knowledge = newNode('knowledge', { x: agent.position.x - 390, y: agent.position.y + 40 });
    knowledge.data = { ...knowledge.data, title: `${agent.data.title} knowledge`, status: 'Ready', markdown: authored, content: authored, sources: [{ label: 'Authored in Agent inspector', resource: `session:${agent.id}` }] };
    setNodes((current) => [...current, knowledge]);
    setEdges((current) => [...current, { id: crypto.randomUUID(), source: knowledge.id, target: agent.id, type: 'smoothstep', label: 'grounds', animated: true, data: { connectionKind: 'reference' } }]);
    setNotice('Knowledge added and connected to the agent');
  }, [canEdit, nodes, setEdges, setNodes]);

  const runAgentTest = useCallback(async (agentId: string, testPrompt: string, expected: string) => {
    const agent = nodes.find((node) => node.id === agentId && node.data.kind === 'agent');
    if (!agent || !testPrompt.trim()) return;
    const connectedIds = new Set(edges.flatMap((edge) => edge.source === agentId ? [edge.target] : edge.target === agentId ? [edge.source] : []));
    const knowledge = nodes.filter((node) => connectedIds.has(node.id) && ['knowledge', 'document', 'dataset', 'file', 'url'].includes(node.data.kind));
    const evaluations = nodes.filter((node) => node.data.kind === 'evaluation');
    const evaluationNode = evaluations.find((node) => connectedIds.has(node.id)) || (evaluations.length === 1 ? evaluations[0] : undefined);
    if (evaluationNode && !connectedIds.has(evaluationNode.id)) {
      connectedIds.add(evaluationNode.id);
      setEdges((current) => current.some((edge) => (edge.source === agentId && edge.target === evaluationNode.id) || (edge.target === agentId && edge.source === evaluationNode.id)) ? current : [...current, { id: crypto.randomUUID(), source: agentId, target: evaluationNode.id, type: 'smoothstep', label: 'evaluated by', animated: true, data: { connectionKind: 'reference' } }]);
    }
    const snapshot = JSON.stringify({
      testMode: true,
      agent: { id: agent.id, ...creationObjectDefinition('agent').contextAdapter(agent.data) },
      knowledge: knowledge.map((node) => ({ id: node.id, ...creationObjectDefinition(node.data.kind).contextAdapter(node.data) })),
    });
    setNodes((current) => current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testPrompt, testExpected: expected, testStatus: 'Running', testResponse: '' } } : node));
    setNotice(`Testing ${agent.data.title}…`);
    try {
      const response = await runCreationCanvasAi({
        prompt: testPrompt.trim(), canvasSnapshot: snapshot, persistence, canvasActions: [],
        ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
        routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
        participant: { ref: agent.data.resourceId || agent.id, name: agent.data.title, instructions: typeof agent.data.instructions === 'string' ? agent.data.instructions : agent.data.subtitle },
      });
      const score = scoreAgentTestResponse(response, expected);
      const status = score.passed == null ? 'Completed · review response' : score.passed ? 'Passed' : 'Failed';
      const result = { id: crypto.randomUUID(), prompt: testPrompt.trim(), expected: expected.trim(), response, status, passed: score.passed, matched: score.matched, missing: score.missing, runAt: new Date().toISOString(), knowledgeObjectIds: knowledge.map((node) => node.id) };
      setNodes((current) => {
        const evaluation = evaluationNode ? current.find((node) => node.id === evaluationNode.id) : undefined;
        const currentAgent = current.find((node) => node.id === agentId);
        const priorHistory = Array.isArray(currentAgent?.data.testHistory) ? currentAgent.data.testHistory : [];
        const updated = current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testPrompt, testExpected: expected, testResponse: response, testStatus: status, testHistory: [result, ...priorHistory].slice(0, 25), status: 'Tested' } } : node);
        if (!evaluation) return updated;
        const priorResults = Array.isArray(evaluation.data.testResults) ? evaluation.data.testResults : [];
        const results = [result, ...priorResults].slice(0, 100);
        const scored = results.filter((item) => item && typeof item === 'object' && typeof (item as { passed?: unknown }).passed === 'boolean') as Array<{ passed: boolean }>;
        const passed = scored.filter((item) => item.passed).length;
        return updated.map((node) => node.id === evaluation.id ? { ...node, data: { ...node.data, testResults: results, runCount: results.length, passRate: scored.length ? Math.round(passed / scored.length * 100) : null, lastRunAt: result.runAt, verdict: status, status: 'Tested', gaps: score.missing, recommendations: score.missing.map((item) => `Improve the response so it demonstrates: ${item}`) } } : node);
      });
      setNotice(`${agent.data.title} test ${status.toLowerCase()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent test failed';
      setNodes((current) => current.map((node) => node.id === agentId ? { ...node, data: { ...node.data, testStatus: `Error · ${message}` } } : node));
      setNotice(message);
    }
  }, [edges, modelSelection, nodes, persistence, setEdges, setNodes]);

  const evaluateCanvas = useCallback((promptOverride?: string) => {
    const requestText = (promptOverride ?? prompt).trim();
    if (!requestText || thinking) return;
    trackActivity('creation_prompt_submitted', { sessionId, metadata: { clientSurface: 'web', scope: resolvedScopeMode, objectKinds: [...new Set(scopedNodes.map((node) => node.data.kind))] } });
    setThinking(true);
    setBrainRunStartedAt(Date.now());
    setNotice('Brain is evaluating connected objects…');
    const initialMessage = initialPromptSubmitted.current ? timeline.find((message) => (message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:')) && message.body === requestText) : undefined;
    const promptAuthor = persistence === 'server' ? members.find((member) => member.userId === currentUserId) : null;
    const requestMessageId = appendTimeline('user', requestText, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'human', ref: currentUserId || 'local', name: promptAuthor?.displayName || 'You' } }, initialMessage?.clientMessageId);
    const promptStartedAt = performance.now();
    if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'started', metadata: { scope: resolvedScopeMode } }).catch(() => undefined);
    // A composer submission is a chat interaction, so reveal its Brain object
    // immediately. Waiting for the vendor request to succeed left a blank canvas
    // (and hid useful streaming/failure state) whenever the provider cascade
    // rejected the turn.
    const existingChat = nodes.find((node) => node.data.kind === 'chat');
    const brainId = existingChat?.id ?? crypto.randomUUID();
    if (!existingChat) {
      const brain = { ...newNode('chat', { x: 120, y: 120 }), id: brainId };
      brain.data = { ...brain.data, title: 'Brain', subtitle: requestText };
      setNodes((current) => current.some((node) => node.data.kind === 'chat') ? current : [...current, brain]);
    }
    setSelectedId(brainId);
    setSelectedIds([brainId]);
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
      const connectedAgentNodes = nodes.filter((node) => node.data.kind === 'agent' && (
        effectiveSelectedIds.includes(node.id)
        || edges.some((edge) => (edge.source === brainId && edge.target === node.id) || (edge.target === brainId && edge.source === node.id))
      )).slice(0, 3);
      setActiveAgentIds(new Set(connectedAgentNodes.map((agent) => agent.id)));
      const confirmCanvasAction = ({ name, args }: { name: string; args: unknown }) => {
        let preview = '';
        try { const serialized = JSON.stringify(args ?? {}); preview = serialized === '{}' ? '' : serialized.length > 320 ? `${serialized.slice(0, 320)}…` : serialized; } catch { preview = ''; }
        return confirm({ title: 'Approve agent action', message: `A session agent wants to run ${name.replaceAll('_', ' ')}.${preview ? `\n\n${preview}` : ''}`, confirmLabel: 'Approve', cancelLabel: 'Cancel', destructive: false });
      };
      const runGroupTurn = async () => {
        const historicalConversation = timeline.map((message) => ({ role: message.messageRole, content: message.metadata?.authoredBy?.name ? `${message.metadata.authoredBy.name}: ${message.body}` : message.body }));
        const groupConversation = connectedAgentNodes.length
          ? [...historicalConversation, { role: 'user' as const, content: request }]
          : historicalConversation;
        const canonicalAgents = connectedAgentNodes.flatMap((agent) => {
          const ref = agent.data.resourceId?.match(/^agent:(.+)$/)?.[1];
          return ref ? [{ ref, name: agent.data.title || 'Specialist agent', role: typeof agent.data.role === 'string' ? agent.data.role : undefined }] : [];
        });
        if (persistence === 'server' && canonicalAgents.length) {
          try {
            const existingChatId = nodes.find((node) => node.data.kind === 'chat')?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
            const projectId = nodes.find((node) => node.data.kind === 'project')?.data.resourceId?.match(/^project:(\d+)$/)?.[1];
            const groupTurn = await runCanonicalCanvasGroupTurn({
              chatId: existingChatId ? Number(existingChatId) : null,
              title, projectId: projectId ? Number(projectId) : null,
              sessionId, prompt: request, agents: canonicalAgents,
            });
            setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, resourceId: `chat:${groupTurn.chatId}`, status: 'Canonical group chat' } } : node));
            for (const { agent, message } of groupTurn.contributions) {
              appendTimeline('assistant', message.content, {
                scope: resolvedScopeMode, objectIds: [...scopedNodeIds],
                authoredBy: { kind: 'agent', ref: agent.ref, name: agent.name },
              }, `${requestMessageId}:agent:${agent.ref}`);
              groupConversation.push({ role: 'assistant', content: `${agent.name}: ${message.content}` });
              setActiveAgentIds((current) => {
                const next = new Set(current);
                const canvasAgent = connectedAgentNodes.find((candidate) => candidate.data.resourceId === `agent:${agent.ref}`);
                if (canvasAgent) next.delete(canvasAgent.id);
                return next;
              });
            }
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Canonical agent turn failed';
            appendTimeline('system', `The canonical agent group could not complete its turn: ${detail}`, { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:agent-group-error`);
          }
        } else if (connectedAgentNodes.length) {
          // Guest drafts cannot call the tenant workforce runtime. Keep ideation
          // useful, but do not present these local personas as canonical agents.
          for (const agent of connectedAgentNodes) {
            const name = agent.data.title || 'Draft specialist';
            const ref = agent.id;
            try {
              const contribution = await runCreationCanvasAi({
                prompt: 'Contribute a specialist perspective to the latest request.', canvasSnapshot: snapshot,
                guestTurnId: requestMessageId,
                guestTurnInput: request,
                persistence, canvasActions, routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
                autoApprove: autoApplyRef.current, confirmAction: confirmCanvasAction,
                participant: { ref, name, instructions: typeof agent.data.instructions === 'string' ? agent.data.instructions : agent.data.subtitle },
                conversation: groupConversation,
              });
              if (contribution.trim()) {
                appendTimeline('assistant', contribution.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'agent', ref, name } }, `${requestMessageId}:draft-agent:${agent.id}`);
                groupConversation.push({ role: 'assistant', content: `${name}: ${contribution.trim()}` });
              }
            } catch { /* Brain synthesis still runs with the available transcript. */ }
            finally {
              setActiveAgentIds((current) => {
                const next = new Set(current);
                next.delete(agent.id);
                return next;
              });
            }
          }
        }
        return runCreationCanvasAi({
          prompt: connectedAgentNodes.length
            ? `Synthesize the invited agents' perspectives and complete the user's requested outcome. Resolve disagreements, make the final Canvas changes, and state what was actually created.`
            : request,
          canvasSnapshot: snapshot, persistence, canvasActions,
          guestTurnId: requestMessageId,
          guestTurnInput: request,
          ...(modelSelection.mode === 'model' ? { model: modelSelection.model, modelStrict: true } : {}),
          routingMode: modelSelection.mode === 'byo_pool' ? 'byo_pool' : 'auto',
          autoApprove: autoApplyRef.current, confirmAction: confirmCanvasAction,
          ...(persistence === 'server' && memoryEnabled && evermindProjectId != null ? { evermind: {
            recall: (query: string) => recallProjectEvermind(evermindProjectId, query).catch(() => null),
            learn: (answer: string, question: string) => teachProjectEvermindFromText(evermindProjectId, answer, question),
          } } : {}),
          onTrace: (event) => setBrainTrace((current) => [...current, event]),
          conversation: groupConversation,
        });
      };
      void runGroupTurn().then((answer) => {
        const changes = [...proposalBuffer.current];
        const shouldAutoApply = changes.length > 0 && (autoApplyRef.current || canvasChangesCanAutoApply(changes));
        if (answer.trim()) {
          appendTimeline('assistant', answer.trim(), { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], authoredBy: { kind: 'brain', ref: 'brain', name: 'Brain' } }, `${requestMessageId}:assistant`);
          setNodes((current) => current.map((node) => node.id === brainId ? { ...node, data: { ...node.data, subtitle: request, aiResponse: answer.trim() } } : node));
          const promptTargets = effectiveSelectedIds.filter((id) => id !== brainId && nodes.some((node) => node.id === id && node.data.kind !== 'chat'));
          if (promptTargets.length) setEdges((current) => associateBrainWithArtifacts(current, brainId, promptTargets));
        }
        if (changes.length) {
          setProposedChanges(changes);
          setAcceptedProposalIds(new Set(changes.map((change) => change.id)));
          // Basic, non-destructive canvas output (including authored visual/image
          // objects and the response attached to them) applies immediately. A
          // user should not have to approve the ordinary result of their own
          // prompt, and on mobile the review surface may not be visible yet.
          setAutoApplyPending(shouldAutoApply);
        }
        setThinking(false);
        setActiveAgentIds(new Set());
        setNotice(changes.length ? shouldAutoApply ? `Applying ${changes.length} Brain changes…` : `${changes.length} Brain changes await review` : 'Brain finished evaluating the canvas');
        trackActivity('creation_ai_evaluation_completed', { sessionId, metadata: { clientSurface: 'web', proposedChangeCount: changes.length, objectKinds: [...new Set(nodes.map((node) => node.data.kind))] } });
        if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'succeeded', actorType: 'brain', durationMs: performance.now() - promptStartedAt, metricKey: 'artifacts_proposed', metricValue: changes.length, unit: 'count' }).catch(() => undefined);
      }).catch((error) => {
        appendTimeline('system', error instanceof Error ? error.message : 'Brain could not complete this request', { scope: resolvedScopeMode, objectIds: [...scopedNodeIds], error: true }, `${requestMessageId}:error`);
        setThinking(false);
        setActiveAgentIds(new Set());
        setNotice(error instanceof Error ? error.message : 'Brain could not complete this request');
        if (persistence === 'server') void creationSessionsApi.recordOutcome(sessionId, { correlationId: requestMessageId, action: 'prompt.evaluate', phase: 'failed', actorType: 'brain', durationMs: performance.now() - promptStartedAt }).catch(() => undefined);
      });
      return;
    }
    window.setTimeout(() => {
      const request = requestText.toLowerCase();
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
  }, [appendTimeline, canvasActions, confirm, currentUserId, effectiveSelectedIds, edges, evermindProjectId, members, memoryEnabled, modelSelection, nodes, persistence, prompt, resolvedScopeMode, scopedEdges, scopedNodeIds, scopedNodes, sessionId, setEdges, setNodes, thinking, timeline, title]);

  useEffect(() => {
    if (!hydrated.current || initialPromptSubmitted.current || thinking) return;
    const initial = timeline.find((message) => message.clientMessageId.startsWith('initial:') || message.clientMessageId.startsWith('claim:'));
    if (!initial || timeline.some((message) => message.messageRole === 'assistant')) return;
    initialPromptSubmitted.current = true;
    setPrompt(initial.body);
    evaluateCanvas(initial.body);
  }, [thinking, timeline, evaluateCanvas]);

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
    if (typeof window !== 'undefined' && window.innerWidth <= 760 && materializedAdditions.length) {
      const brainId = nodes.find((node) => node.data.kind === 'chat')?.id;
      const focusIds = [brainId, ...materializedAdditions.map((change) => change.node.id)].filter((id): id is string => !!id);
      window.setTimeout(() => {
        void flowRef.current?.fitView({ nodes: focusIds.map((id) => ({ id })), padding: .18, minZoom: .62, maxZoom: .9, duration: 350 });
      }, 0);
    }
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
    const deliveryId = crypto.randomUUID();
    const started: CreationDeliverable = { id: deliveryId, action: 'run', artifactKind: 'workflow-run', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-workflows' };
    setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', deliverables: withCreationDeliverable(node.data, started) } } : node));
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
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: run.workflowId, workflowTaskCount: run.taskCount, deliverables: withCreationDeliverable(node.data, { ...started, resourceRef: `workflow-run:${run.workflowId}`, metadata: { taskCount: run.taskCount } }) } } : node));
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
              setNodes((nodesNow) => nodesNow.map((node) => {
                if (node.id !== targetId) return node;
                const terminalDeliverable: CreationDeliverable | null = terminal ? { ...started, status: normalized === 'completed' || normalized === 'complete' ? 'delivered' : 'failed', completedAt: currentRun.completedAt || new Date().toISOString(), resourceRef: `workflow-run:${run.workflowId}`, validation: { status: normalized === 'completed' || normalized === 'complete' ? 'passed' : 'failed', detail: `Workflow ${currentRun.status}` }, metadata: { taskCount: run.taskCount }, ...(!(normalized === 'completed' || normalized === 'complete') ? { error: `Workflow ${currentRun.status}` } : {}) } : null;
                return { ...node, data: { ...node.data, status: label, workflowRunStatus: currentRun.status, workflowCompletedAt: currentRun.completedAt, ...(terminalDeliverable ? { deliverables: withCreationDeliverable(node.data, terminalDeliverable) } : {}) } };
              }));
              if (terminal) setNotice(`Workflow ${label.toLowerCase()}`);
              else pollRun(remaining - 1);
            }).catch(() => pollRun(remaining - 1));
          }, 2_000);
        };
        pollRun(30);
      }).catch((error) => {
        const message = error instanceof Error ? error.message : 'Workflow could not be started';
        const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
        setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Run failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
        setNotice(message);
      });
      return;
    }
    setNotice(persistence === 'local' ? 'Draft workflow running locally…' : 'Link a saved Workflow definition before running it');
    if (persistence !== 'local') {
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Draft' } } : node));
      return;
    }
    window.setTimeout(() => {
      const completed: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), provider: 'browser-draft', validation: { status: 'passed', detail: 'Local draft workflow completed' } };
      setNodes((current) => current.map((node) => node.id === targetId ? { ...node, data: { ...node.data, status: 'Complete', deliverables: withCreationDeliverable(node.data, completed) } } : node));
      setNotice('Workflow completed');
    }, 1400);
  }, [canRun, nodes, persistence, selectedNode, setNodes]);

  const saveAgent = useCallback(() => {
    if (!selectedNode || selectedNode.data.kind !== 'agent') return;
    const ref = selectedNode.data.resourceId?.startsWith('agent:') ? selectedNode.data.resourceId.slice('agent:'.length) : '';
    if (!ref && persistence === 'local') { requireAccount('agent', t('saveCollaborator'), t('saveCollaboratorGate')); return; }
    const personality = typeof selectedNode.data.personality === 'string' ? selectedNode.data.personality.trim() : '';
    const direction = typeof selectedNode.data.instructions === 'string' ? selectedNode.data.instructions.trim() : selectedNode.data.subtitle || '';
    const bio = [personality, direction].filter(Boolean).join('\n\n');
    const baseModel = selectedNode.data.model && selectedNode.data.model !== 'auto' ? String(selectedNode.data.model) : undefined;
    const input = { name: selectedNode.data.title, title: selectedNode.data.role || selectedNode.data.title, bio, skills: Array.isArray(selectedNode.data.tools) ? selectedNode.data.tools.map(String) : undefined, baseModel };
    setNotice(ref ? t('savingAgentSettings') : t('creatingWorkforceAgent'));
    void (ref ? updateAgent(ref, input) : createCloudAgent(input))
      .then((saved) => {
        setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, resourceId: `agent:${saved.id}`, status: 'Configured' } } : node));
        setNotice(ref ? t('agentSettingsSaved') : t('agentCreatedReady'));
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : t('agentSettingsSaveFailed')));
  }, [persistence, requireAccount, selectedNode, setNodes, t]);

  const publishWebsite = useCallback((websiteId?: string) => {
    const target = nodes.find((node) => node.id === websiteId && node.data.kind === 'website')
      ?? (selectedNode?.data.kind === 'website' ? selectedNode : nodes.find((node) => node.data.kind === 'website'));
    if (!target) { setNotice('Add a Website object to publish'); return; }
    if (persistence !== 'server') { requireAccount('publish', 'Create an account to publish', 'Save this session to publish the Website as a live Builderforce site.'); return; }
    const connectedProject = nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || '') && edges.some((edge) => (edge.source === target.id && edge.target === node.id) || (edge.target === target.id && edge.source === node.id)))
      ?? nodes.find((node) => node.data.kind === 'project' && /^project:\d+$/.test(node.data.resourceId || ''));
    const projectId = connectedProject?.data.resourceId?.match(/^project:(\d+)$/)?.[1];
    if (!projectId) { setNotice('Connect this Website to a saved Project before publishing'); return; }
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'publish', artifactKind: 'website', status: 'running', createdAt: new Date().toISOString(), provider: 'builderforce-sites', resourceRef: `project:${projectId}` };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publishing…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice('Building and publishing the Website…');
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'started', artifactId: target.id, projectId: Number(projectId) }).catch(() => undefined);
    const subdomain = typeof target.data.subdomain === 'string' ? target.data.subdomain : undefined;
    void publishSite(projectId, buildWebsiteAssets(target.data), subdomain).then((site) => {
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), url: site.url, pathUrl: site.pathUrl, mimeType: 'text/html', resourceRef: `site:${site.subdomain}`, validation: { status: 'passed', detail: `${site.assetCount} assets published (${site.totalBytes} bytes)` }, metadata: { versionToken: site.versionToken, assetCount: site.assetCount, totalBytes: site.totalBytes } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Published', url: site.url, siteUrl: site.url, pathUrl: site.pathUrl, subdomain: site.subdomain, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      setNotice(`Website published to ${site.url}`);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'succeeded', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { url: site.url, versionToken: site.versionToken } }).catch(() => undefined);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Website publish failed';
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Publish failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'website.publish', phase: 'failed', artifactId: target.id, projectId: Number(projectId), durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [edges, nodes, persistence, requireAccount, selectedNode, sessionId, setNodes]);

  const generateVideo = useCallback((videoId?: string) => {
    const target = nodes.find((node) => node.id === videoId && node.data.kind === 'video')
      ?? (selectedNode?.data.kind === 'video' ? selectedNode : nodes.find((node) => node.data.kind === 'video'));
    if (!target) { setNotice('Add a Video object to generate'); return; }
    if (persistence !== 'server') { requireAccount('generate', 'Create an account to generate video', 'Save this session to run a published Evermind video model.'); return; }
    const deliveryId = crypto.randomUUID();
    const correlationId = `deliver:${deliveryId}`;
    const startedAt = performance.now();
    const started: CreationDeliverable = { id: deliveryId, action: 'generate', artifactKind: 'video', status: 'running', createdAt: new Date().toISOString(), provider: 'evermind' };
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generating…', deliverables: withCreationDeliverable(node.data, started) } } : node));
    setNotice('Generating video with Evermind…');
    void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'started', artifactId: target.id }).catch(() => undefined);
    void listEvermindModels().then((models) => {
      const configured = typeof target.data.modelSlug === 'string' ? target.data.modelSlug : typeof target.data.model === 'string' ? target.data.model : '';
      const model = models.find((candidate) => candidate.slug === configured || candidate.name === configured) ?? models[0];
      if (!model) throw new Error('Publish an Evermind video model before generating this deliverable');
      return generateEvermindMedia(model.slug, { prompt: typeof target.data.prompt === 'string' ? target.data.prompt : target.data.content as string | undefined, maxFrames: typeof target.data.maxFrames === 'number' ? target.data.maxFrames : 16 }).then((media) => ({ media, model }));
    }).then(({ media, model }) => {
      const previewUrl = media.frames[0] ? mediaFrameDataUrl(media.frames[0], media.width, media.height, media.channels) : null;
      const delivered: CreationDeliverable = { ...started, status: 'delivered', completedAt: new Date().toISOString(), mimeType: media.modality === 'video' ? 'application/x-builderforce-video-frames' : 'image/png', resourceRef: media.model, validation: { status: media.frameCount > 0 ? 'passed' : 'failed', detail: `${media.frameCount} ${media.width}×${media.height} frames generated` }, metadata: { modelSlug: model.slug, frameCount: media.frameCount, width: media.width, height: media.height, channels: media.channels, usage: media.usage } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generated', modelSlug: model.slug, frameCount: media.frameCount, videoWidth: media.width, videoHeight: media.height, generatedFrames: media.frames, ...(previewUrl ? { videoUrl: previewUrl } : {}), deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      setNotice(`${media.frameCount}-frame video generated with ${model.name}`);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'succeeded', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt, metricKey: 'deliverables_completed', metricValue: 1, unit: 'count', metadata: { model: model.slug, frameCount: media.frameCount } }).catch(() => undefined);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Video generation failed';
      const failed: CreationDeliverable = { ...started, status: 'failed', completedAt: new Date().toISOString(), error: message, validation: { status: 'failed', detail: message } };
      setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: 'Generation failed', deliverables: withCreationDeliverable(node.data, failed) } } : node));
      setNotice(message);
      void creationSessionsApi.recordOutcome(sessionId, { correlationId, action: 'video.generate', phase: 'failed', actorType: 'system', artifactId: target.id, durationMs: performance.now() - startedAt }).catch(() => undefined);
    });
  }, [nodes, persistence, requireAccount, selectedNode, sessionId, setNodes]);

  const runCreativeAction = useCallback((objectId?: string, action = 'generate') => {
    const target = nodes.find((node) => node.id === objectId && CREATIVE_GENERATOR_KINDS.has(node.data.kind))
      ?? (selectedNode && CREATIVE_GENERATOR_KINDS.has(selectedNode.data.kind) ? selectedNode : undefined);
    if (!target) { setNotice('Select a creative object first'); return; }
    const existingUrl = typeof target.data.outputUrl === 'string' ? target.data.outputUrl : '';
    if ((action === 'preview' || action === 'export') && existingUrl) {
      // A browser refuses to open a `data:` URL in a top-level tab, so both paths
      // go through a navigable URL. It is revoked on a timer rather than at once:
      // revoking it before the new tab has read it is the same blank page.
      const navigable = navigableArtifactUrl(existingUrl);
      if (action === 'preview') window.open(navigable, '_blank', 'noopener,noreferrer');
      else {
        const anchor = document.createElement('a'); anchor.href = navigable;
        anchor.download = typeof target.data.outputFileName === 'string' ? target.data.outputFileName : `${target.data.title}.artifact`;
        anchor.click();
      }
      if (navigable !== existingUrl) window.setTimeout(() => URL.revokeObjectURL(navigable), 60_000);
      setNotice(action === 'preview' ? 'Preview opened' : 'Deliverable downloaded');
      return;
    }
    const artifact = buildBrowserCreativeArtifact(target.data);
    const delivered: CreationDeliverable = {
      id: crypto.randomUUID(), action, artifactKind: artifact.artifactKind, status: 'delivered', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      url: artifact.url, mimeType: artifact.mimeType, fileName: artifact.fileName, provider: 'builderforce-browser', validation: { status: 'passed', detail: artifact.validationDetail }, metadata: { outputFormat: artifact.outputFormat, capabilityId: target.data.capabilityId },
    };
    // The tile shows the preview the artifact came with, and nothing when it has
    // none — a stale thumbnail from an earlier generation would misdescribe the
    // file that is now attached.
    setNodes((current) => current.map((node) => node.id === target.id ? { ...node, data: { ...node.data, status: action === 'apply' ? 'Applied' : 'Generated', outputUrl: artifact.url, outputFormat: artifact.outputFormat, outputFileName: artifact.fileName, thumbnailUrl: artifact.previewImageUrl ?? '', deliverables: withCreationDeliverable(node.data, delivered) } } : node));
    setNotice(`${artifact.fileName} generated and validated`);
  }, [nodes, selectedNode, setNodes]);

  /**
   * The one export path for an authored object. The inspector's buttons, Brain's
   * `export` action, and the Files library all call this, so the file that lands
   * in Downloads, the deliverable recorded on the object, and the row the library
   * lists are produced once and cannot disagree.
   */
  const exportArtifact = useCallback(async (nodeId: string, action: CanvasExportAction): Promise<string> => {
    const target = nodes.find((node) => node.id === nodeId);
    if (!target) return t('exportFailed');
    const markdown = canvasObjectMarkdown(target.data);
    const base = safeDownloadName(target.data.title);
    try {
      if (action === 'copy') return await copyTextToClipboard(markdown) ? t('copiedToClipboard') : t('clipboardUnavailable');
      const office = (action === 'docx' || action === 'pptx') && persistence === 'server';
      let fileName = `${base}.md`;
      if (action === 'markdown' || ((action === 'docx' || action === 'pptx') && !office)) downloadText(markdown, fileName, 'text/markdown');
      if (action === 'csv') {
        const csv = artifactCsv(target.data);
        if (!csv) throw new Error(t('noTabularRows'));
        fileName = `${base}.csv`;
        exportCsv(csv, fileName);
      }
      if (action === 'diagram') {
        const diagram = canvasDiagram(target.data);
        if (!diagram) throw new Error(t('noDiagramSource'));
        fileName = `${base}.${diagram.format === 'drawio' ? 'drawio' : 'mmd'}`;
        downloadText(diagram.source, fileName, diagram.format === 'drawio' ? 'application/vnd.jgraph.mxfile' : 'text/vnd.mermaid');
      }
      if (office) {
        fileName = `${base}.${action}`;
        if (action === 'docx') await exportDocx(markdown, target.data.title);
        else await exportPptx(markdown, target.data.title);
      }
      if (action === 'json') {
        fileName = `${base}.json`;
        downloadJson({ kind: target.data.kind, title: target.data.title, data: target.data }, fileName);
      }
      const delivered: CreationDeliverable = {
        id: crypto.randomUUID(), action: 'export', artifactKind: action, status: 'delivered',
        createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        provider: office ? 'builderforce-office-export' : action === 'docx' || action === 'pptx' ? 'browser-markdown-fallback' : 'browser-download',
        fileName,
        mimeType: action === 'diagram' ? 'application/vnd.jgraph.mxfile' : office || (action !== 'docx' && action !== 'pptx') ? EXPORT_MIME[action] : 'text/markdown',
        validation: { status: 'passed', detail: 'Export generated and download started' },
      };
      setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, deliverables: withCreationDeliverable(node.data, delivered) } } : node));
      return (action === 'docx' || action === 'pptx') && !office ? t('markdownDownloaded') : t('downloadReady');
    } catch (error) {
      return error instanceof Error ? error.message : t('exportFailed');
    }
  }, [nodes, persistence, setNodes, t]);

  /** Every file this session holds, derived from the objects themselves so a new
   * document, deck, diagram, or sheet appears in the library the moment Brain
   * authors it — no separate registration step to forget. */
  const sessionFiles = useMemo(() => canvasFiles(nodes), [nodes]);

  /** A file the library offers: a delivered artifact opens, an authored object
   * exports through the path above. */
  const downloadCanvasFile = useCallback((file: CanvasFile) => {
    if (file.url) {
      const navigable = navigableArtifactUrl(file.url);
      const anchor = document.createElement('a');
      anchor.href = navigable;
      anchor.download = file.name;
      anchor.click();
      if (navigable !== file.url) window.setTimeout(() => URL.revokeObjectURL(navigable), 60_000);
      setNotice(t('downloadReady'));
      return;
    }
    const target = nodes.find((node) => node.id === file.nodeId);
    if (target) void exportArtifact(file.nodeId, defaultExportAction(target.data.kind)).then(setNotice);
  }, [exportArtifact, nodes, t]);

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
    else if (target.data.kind === 'website' && pending.action === 'publish') publishWebsite(target.id);
    else if (target.data.kind === 'video' && pending.action === 'generate') generateVideo(target.id);
    else if (CREATIVE_GENERATOR_KINDS.has(target.data.kind)) runCreativeAction(target.id, pending.action);
    else if (target.data.kind === 'dataset' && pending.action === 'visualize') visualizeDataset();
    else if (target.data.kind === 'dataset' && pending.action === 'profile') profileDataset(target.id);
    else if (target.data.kind === 'project' && pending.action === 'expand') expandProject();
    else if (target.data.kind === 'project' && pending.action === 'compare') compareProjects();
    else if (target.data.kind === 'mockupSet' && pending.action === 'expand') expandMockupSet();
    else if ((target.data.kind === 'mockup' || target.data.kind === 'mockupSet') && pending.action === 'deliver') deliverMockup();
    else if (target.data.kind === 'standup' && pending.action === 'start') startStandup();
    else if (target.data.kind === 'evermind' && pending.action === 'train') openEvermindTraining();
    else if (target.data.kind === 'evermind' && pending.action === 'evaluate') evaluateEvermind(target.id);
    else if (pending.action === 'export') void exportArtifact(target.id, defaultExportAction(target.data.kind)).then(setNotice);
    else if (target.data.kind === 'slides' && pending.action === 'present') setPresentMode(true);
    else if (target.data.kind === 'evermind' && pending.action === 'publish') {
      openEvermindTraining();
      setNotice('Use the trained package section to publish and test this Evermind');
    }
    else {
      setNotice(`${pending.action} did not run because this ${creationObjectDefinition(target.data.kind).label} has no connected delivery adapter`);
    }
    finish();
  }, [compareProjects, deliverMockup, evaluateEvermind, expandMockupSet, expandProject, exportArtifact, generateVideo, nodes, openEvermindTraining, pendingBrainActions, persistence, profileDataset, publishWebsite, runCreativeAction, runWorkflow, selectedId, setEdges, setNodes, startStandup, visualizeDataset]);

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
  const cleanLayout = useCallback(() => {
    setNodes((current) => cleanCanvasLayout(current, edges));
    window.setTimeout(() => void flowRef.current?.fitView({ padding: .16, maxZoom: .9, duration: 320 }), 0);
  }, [edges, setNodes]);
  const renderedNodes = useMemo(() => nodes.map((node) => {
    const attachedEvermind = node.data.kind === 'evermind' && typeof node.data.resourceId === 'string' && /^evermind:\d+$/.test(node.data.resourceId);
    const live = evermindLiveByNodeId[node.id];
    const liveNode = attachedEvermind ? { ...node, data: { ...node.data, ...(live ?? { evermindLoading: true, status: 'Syncing project…' }) } } : node;
    const agentRef = liveNode.data.kind === 'agent' ? liveNode.data.resourceId?.match(/^agent:(.+)$/)?.[1] : undefined;
    const latestAgentReply = liveNode.data.kind === 'agent' ? [...timeline].reverse().find((message) => {
      const author = message.metadata?.authoredBy;
      return author?.kind === 'agent' && (author.ref === agentRef || author.ref === liveNode.id || author.name === liveNode.data.title);
    }) : undefined;
    const withCollaboration = liveNode.data.kind === 'agent' && (activeAgentIds.has(liveNode.id) || latestAgentReply)
      ? { ...liveNode, data: { ...liveNode.data, ...(activeAgentIds.has(liveNode.id) ? { collaborationState: 'thinking' } : {}), ...(latestAgentReply ? { collaborationReply: latestAgentReply.body, collaborationReplyAt: latestAgentReply.createdAt } : {}) } }
      : liveNode;
    const hasDatasetConnection = ['chart', 'dashboard', 'report'].includes(withCollaboration.data.kind) && edges.some((edge) => {
      const otherId = edge.source === withCollaboration.id ? edge.target : edge.target === withCollaboration.id ? edge.source : null;
      return otherId != null && nodes.some((candidate) => candidate.id === otherId && ['dataset', 'table', 'spreadsheet'].includes(candidate.data.kind));
    });
    const withLiveData = hasDatasetConnection && /connect a dataset/i.test(String(withCollaboration.data.status || ''))
      ? { ...withCollaboration, data: { ...withCollaboration.data, status: 'Dataset connected' } }
      : withCollaboration;
    return withLiveData.data.placementHidden === true ? { ...withLiveData, hidden: !showHidden, style: showHidden ? { ...withLiveData.style, opacity: .42 } : withLiveData.style } : withLiveData;
  }), [activeAgentIds, edges, evermindLiveByNodeId, nodes, showHidden, timeline]);
  /**
   * The 3D view reads the SAME nodes the board renders, minus the ones the board
   * is currently hiding — a mode that quietly resurrects hidden objects would
   * report a different canvas than the one the user is working on.
   */
  const threeDNodes = useMemo(() => renderedNodes.filter((node) => node.hidden !== true), [renderedNodes]);
  const describeThreeD = useCallback((node: CreationFlowNode): Canvas3DDescriptor => {
    const definition = creationObjectDefinition(node.data.kind);
    return {
      label: node.data.title || t(`object.${node.data.kind}`),
      sublabel: node.data.status || node.data.subtitle,
      group: t(`group.${definition.group}`),
      icon: definition.icon,
      accent: typeof node.data.accent === 'string' ? node.data.accent : minimapColor(node),
      // A generated object carries a picture of what it produced — a rendered
      // mesh, a drawn profile, an image. In 3D that is the point of the card.
      preview: creativePreviewImageUrl(node.data) ?? undefined,
      // Where the user has put this object through depth, if they have. It rides
      // in the object's own content, so it survives a reload and a share exactly
      // like its position on the flat board does.
      depthOffset: typeof node.data.depthOffset === 'number' ? node.data.depthOffset : undefined,
      locked: !canvasPlacementUnlocked(node),
    };
  }, [minimapColor, t]);
  const selectThreeDObject = useCallback((id: string) => {
    setInspectorFocus(null);
    setSelectedId(id);
    setSelectedIds([id]);
  }, []);
  /**
   * Objects moved in the 3D space, written straight back to the board.
   *
   * There is one set of positions, not a 3D copy of them: across the plane the
   * move IS the board position, and through depth it is how far the object
   * floats off the layer its dependencies put it on. So an object dragged in the
   * space is where the user left it on the flat canvas too, and is saved by the
   * same autosave that persists any other placement.
   */
  const moveThreeDObjects = useCallback((moves: readonly Canvas3DMove[]) => {
    if (!canEdit || !moves.length) return;
    const byId = new Map(moves.map((move) => [move.id, move]));
    setNodes((current) => current.map((node) => {
      const move = byId.get(node.id);
      if (!move || !canvasPlacementUnlocked(node)) return node;
      const depth = (typeof node.data.depthOffset === 'number' ? node.data.depthOffset : 0) + move.dz;
      return {
        ...node,
        position: { x: node.position.x + move.dx, y: node.position.y + move.dy },
        // A zero offset is the absence of one: an object settled back onto its
        // layer must not carry a stale field into every future save.
        data: depth === 0
          ? { ...node.data, depthOffset: undefined }
          : { ...node.data, depthOffset: depth },
      };
    }));
  }, [canEdit, setNodes]);
  /**
   * Zoom and fit mean the scene while it is up, and the flat board otherwise —
   * the phone-sized action stack keeps the same buttons in both views instead of
   * leaving three dead controls behind whenever 3D opens.
   */
  const zoomInAction = useCallback(() => {
    if (threeDControls) threeDControls.zoomIn(); else void flowRef.current?.zoomIn({ duration: 180 });
  }, [threeDControls]);
  const zoomOutAction = useCallback(() => {
    if (threeDControls) threeDControls.zoomOut(); else void flowRef.current?.zoomOut({ duration: 180 });
  }, [threeDControls]);
  const fitViewAction = useCallback(() => {
    if (threeDControls) threeDControls.resetView(); else void flowRef.current?.fitView({ padding: .18, maxZoom: .9, duration: 260 });
  }, [threeDControls]);
  // Brain reaches its Object through BrainSurfaceProvider, not through this memo:
  // a per-token dependency here would hand React Flow a new nodeTypes object and
  // remount every Object on the board on every streamed word.
  const canvasNodeTypes = useMemo<NodeTypes>(() => ({
    creation: (props) => <CreationNode {...props} canRun={canRun} onRun={(nodeId) => runWorkflow(nodeId)} onEditData={updateNodeData} onOpenDetails={(nodeId, focus) => {
      setDiagnosticsOpen(false); setHistoryOpen(false); setOutcomeMetricsOpen(false);
      setInspectorFocus(focus || null); setSelectedId(nodeId); setSelectedIds([nodeId]);
    }} />,
  }), [canRun, runWorkflow, updateNodeData]);
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

  /**
   * The diagnostics control does the whole job in one click: the report is on the
   * clipboard (ready to paste into a bug report) before the panel finishes opening,
   * so nobody has to find a second "Copy" button to report what they are looking at.
   */
  const openDiagnostics = useCallback(async () => {
    setDiagnosticsOpen(true);
    setHistoryOpen(false);
    setOutcomeMetricsOpen(false);
    const report = await buildDiagnostics();
    if (await copyTextToClipboard(report)) toast.success(t('diagnosticsCopied'));
    else toast.error(t('diagnosticsCopyFailed'));
  }, [buildDiagnostics, t, toast]);

  const openOutcomeMetrics = useCallback(() => {
    setOutcomeMetricsOpen(true);
    setOutcomeMetricsError(null);
    if (persistence === 'local') return;
    setOutcomeMetricsLoading(true);
    void creationSessionsApi.outcomeMetrics(sessionId)
      .then(setOutcomeMetrics)
      .catch((error) => setOutcomeMetricsError(error instanceof Error ? error.message : 'Outcome metrics could not be loaded'))
      .finally(() => setOutcomeMetricsLoading(false));
  }, [persistence, sessionId]);

  const formatOutcomeValue = useCallback((value: number | null, unit: string) => {
    if (value == null) return 'Not measured';
    if (unit === 'percent') return `${Math.round(value * 100)}%`;
    if (unit === 'usd') return `$${value.toFixed(2)}`;
    if (unit === 'seconds') return value >= 60 ? `${(value / 60).toFixed(value >= 600 ? 0 : 1)} min` : `${Math.round(value)} sec`;
    if (unit === 'agents') return `${value.toFixed(value % 1 ? 1 : 0)} agent${value === 1 ? '' : 's'}`;
    return value.toFixed(value % 1 ? 1 : 0);
  }, []);

  const brainNode = nodes.find((node) => node.data.kind === 'chat') ?? null;
  // An inline Brain IS an Object on the board, so only a docked one is reserved.
  const brainDockReserved = brainDockReservedWidth(brainDock);
  const brainMessages = useMemo<BrainMessage[]>(() => timeline.map((message, index) => ({
    id: index + 1,
    seq: index + 1,
    role: message.messageRole,
    content: message.body,
    metadata: message.metadata?.authoredBy ? JSON.stringify({ authoredBy: message.metadata.authoredBy }) : null,
    createdAt: message.createdAt,
  })), [timeline]);

  const brainSurfaceOpen = !presentMode && brainDock.open;
  const brainCollaborators = useMemo(
    () => members.filter((member) => member.userId !== currentUserId),
    [currentUserId, members],
  );
  /**
   * Exactly one surface renders the conversation. When it is inline, the Brain Object
   * reads this and becomes the chat; the edge dock is not rendered at all. Feeding both
   * placements from ONE value is what guarantees the board can never show two.
   */
  const brainSurface = useMemo<BrainSurfaceContextValue>(() => ({
    open: brainSurfaceOpen,
    canOpen: !presentMode,
    mode: brainDock.mode,
    showExecutionDetail: brainDock.showExecutionDetail,
    running: thinking,
    runStartedAt: brainRunStartedAt,
    messages: brainMessages,
    trace: brainTrace,
    nodes,
    edges,
    collaborators: brainCollaborators,
    joinedCollaborator,
    onOpen: (nodeId) => { setSelectedId(nodeId); setSelectedIds([nodeId]); openBrainDock(); },
    onModeChange: (mode) => updateBrainDock({ mode }),
    onExecutionDetailChange: (showExecutionDetail) => updateBrainDock({ showExecutionDetail }),
    onClose: () => updateBrainDock({ open: false }),
  }), [
    brainCollaborators, brainDock.mode, brainDock.showExecutionDetail, brainMessages, brainRunStartedAt,
    brainSurfaceOpen, brainTrace, edges, joinedCollaborator, nodes, openBrainDock, presentMode, thinking, updateBrainDock,
  ]);

  /**
   * The prompt lives in the centre of the board, bottom-aligned — where ChatGPT and
   * every other chat product people already use puts it. It is deliberately NOT part
   * of the Brain surface: it stays put and stays reachable whether Brain is inline in
   * its Object, docked to either edge, or closed entirely.
   */
  const composer = !presentMode && <ChatInput
    className={styles.composer}
    value={prompt}
    onChange={setPrompt}
    onSubmit={evaluateCanvas}
    placeholder={t('askBrain')}
    submitLabel={t('sendBrain')}
    disabled={thinking}
    rows={1}
    submitOnEnter
    contextControls={<>
      <label className={styles.scopeChip}>⌁ <span className="sr-only">{t('brainScope')}</span><select aria-label={t('brainScope')} value={scopeMode} onChange={(event) => setScopeMode(event.target.value as typeof scopeMode)}><option value="auto">{scopeLabel}</option><option value="canvas">{t('entireCanvas')}</option><option value="selection" disabled={!effectiveSelectedIds.length}>{effectiveSelectedIds.length > 1 ? t('selectedObjects', { count: effectiveSelectedIds.length }) : t('selectedObject')}</option><option value="connected" disabled={!effectiveSelectedIds.length}>{t('connectedScope')}</option><option value="frame" disabled={selectedNode?.data.kind !== 'frame'}>{t('currentFrame')}</option></select></label>
    </>}
    onAttach={attachCanvasArtifact}
    onAddContext={openPalette}
    autoMode={autoApply}
    onAutoModeChange={setAutoApplyMode}
    modelSelection={modelSelection}
    modelOptions={canvasModelOptions}
    onModelSelectionChange={setModelSelection}
    modelTrigger="slash"
    modeControls={
      <button type="button" className={`${styles.memoryButton} ${memoryEnabled ? styles.memoryButtonActive : ''}`} aria-pressed={memoryEnabled} aria-label={t('memory')} disabled={evermindProjectId == null || persistence !== 'server'} title={evermindProjectId == null ? t('memoryNeedsProject') : memoryEnabled ? t('memoryEnabled') : t('memoryDisabled')} onClick={() => setMemoryMode(!memoryEnabled)}><span aria-hidden>🧠</span><span className={styles.composerActionLabel}>{t('memory')}</span></button>
    }
    showVoice
  />;

  return (
    <div
      ref={shellRef}
      className={`${styles.canvasShell} app-full-height`}
      data-fullscreen={fullscreen ? 'true' : 'false'}
    >
      <div className={styles.sessionBar}>
        <div className={styles.titleBlock}><span className={styles.spark}>✦</span><input aria-label={t('sessionTitle')} value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (persistence === 'server') void creationSessionsApi.update(sessionId, { title }).then(() => setNotice(t('saved'))).catch(() => setNotice(t('titleSaveFailed'))); }} /><span className={styles.saved}>{notice}</span>{persistence === 'server' && <span role="status" aria-live="polite" className={styles.realtimeStatus} data-state={realtimeState}>{realtimeState === 'online' ? t('live') : realtimeState === 'offline' ? t('offlineRetry') : realtimeState === 'reconnecting' ? t('reconnecting') : t('connecting')}</span>}</div>
        <div className={styles.sessionActions}>
          <div className={styles.collaborators} aria-label={t('activeCollaborators')}>
            {/* In a shared free session the roster is REAL — showing only "you"
                while three other people move cards around is a lie the board
                itself contradicts. */}
            {(persistence !== 'local'
              ? members
              : inRoom && room.participants.length
                ? room.participants.map((person) => ({ userId: `guest:${person.name}:${person.joinedAt}`, displayName: person.name, role: person.isHost ? ('owner' as const) : ('editor' as const) }))
                : [{ userId: 'local', displayName: t('you'), role: 'owner' as const }]
            ).slice(0, 4).map((member, index) => <button key={member.userId} type="button" data-typing={'typing' in member && member.typing ? 'true' : 'false'} aria-pressed={followingUserId === member.userId} title={`${member.displayName || t('collaborator')} · ${member.role}${'typing' in member && member.typing ? ` · ${t('writingPrompt')}` : ''}${member.userId !== currentUserId ? ` · ${t('clickToFollow')}` : ''}`} onClick={() => { if (member.userId !== currentUserId && member.userId !== 'local') setFollowingUserId((current) => current === member.userId ? null : member.userId); }} className={[styles.avatarPink, styles.avatarOrange, styles.avatarGreen][index % 3]}>{(member.displayName || 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</button>)}
            <button aria-label={t('inviteCollaborator')} onClick={() => setShareOpen(true)}>+</button>
          </div>
          <div className={styles.undoRedoGroup} role="group" aria-label={t('canvasHistory')}>
            <button className={styles.secondaryButton} onClick={undo} aria-label={t('undoCanvasChange')}>↶</button>
            <button className={styles.secondaryButton} onClick={redo} aria-label={t('redoCanvasChange')}>↷</button>
          </div>
          <button className={styles.secondaryButton} aria-expanded={outcomeMetricsOpen} aria-label={t('viewOutcomeMetrics')} title={t('outcomeMetricsTitle')} onClick={openOutcomeMetrics}>↗</button>
          <button className={`${styles.secondaryButton} ${styles.iconAction}`} aria-pressed={fullscreen} aria-label={fullscreen ? t('exitFullScreen') : t('fullScreen')} title={fullscreen ? t('exitFullScreen') : t('fullScreen')} onClick={toggleFullscreen}>{fullscreen ? '⤡' : '⛶'}</button>
          <button className={`${styles.secondaryButton} ${styles.iconAction}`} aria-expanded={diagnosticsOpen} aria-label={t('openDiagnostics')} title={t('openDiagnostics')} onClick={() => void openDiagnostics()}>⚠</button>
          <button className={`${styles.secondaryButton} ${styles.mobileAction}`} aria-expanded={moreOpen} aria-label={t('moreActions')} onClick={() => { setMoreOpen((value) => !value); setShareOpen(false); }}>•••</button>
          {/* A local canvas opens the SAME share menu a saved one does. It used to
              open a sign-up gate, which answered a question nobody asked: they
              wanted to show someone the board, not to create an account. */}
          <button className={styles.secondaryButton} onClick={() => { setShareOpen((value) => !value); setMoreOpen(false); }}>{t('share')} ▾</button>
          {persistence === 'local' && <button className={`${styles.primaryButton} ${styles.saveButton}`} aria-label={t('saveCollaborate')} onClick={() => requireAccount('save', t('gateSaveTitle'), t('gateSaveBody'))}><span className={styles.saveButtonFull}>{t('saveCollaborate')}</span><span className={styles.saveButtonShort} aria-hidden>{t('save')}</span></button>}
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
            <label><span><i aria-hidden>⌁</i>{t('edge')}</span><select aria-label={t('connectionKind')} value={connectionKind} onChange={(event) => setConnectionKind(event.target.value as CreationConnectionKind)}>{CREATION_CONNECTION_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          </div>}
          {shareOpen && <div className={styles.shareMenu} role="dialog" aria-label={t('inviteCollaborators')}>
            <div className={styles.shareMenuHeader}>
              <strong>{t('inviteCollaborators')}</strong>
              <button type="button" className={styles.shareMenuClose} aria-label={t('closeInvitationPanel')} onClick={() => setShareOpen(false)}>×</button>
            </div>
            <p>{persistence === 'local' ? (inRoom ? t('sharedLiveHint') : t('sharedInviteHint')) : t('invitedCanBuild')}</p>
            {/* NO ACCOUNT: invite by link into a shared free session. Everyone edits
                the same board and shares one free-message allowance; signing up is
                offered as the way to KEEP it, not as the price of sharing it. */}
            {persistence === 'local' ? (inRoom && roomCode ? <>
              <GuestInviteLink code={roomCode} surface="canvas" full={room.participants.length >= (room.state?.maxParticipants ?? 0)} />
              <div className={styles.shareRoomPeople} aria-label={t('sharedPeopleHere', { count: room.participants.length })}>
                {room.participants.map((person) => <span key={`${person.name}-${person.joinedAt}`}>{person.name}{person.isHost ? ` ${t('sharedHostTag')}` : ''}</span>)}
              </div>
              <div className={styles.shareRoomActions}>
                <button type="button" onClick={() => void leaveSharedSession()}>{t('sharedStopSharing')}</button>
                <button type="button" onClick={() => requireAccount('save', t('gateSaveSessionTitle'), t('gateSaveBody'))}>{t('sharedSaveToKeep')}</button>
              </div>
            </> : <button disabled={roomBusy} onClick={() => void startSharedSession()}>{roomBusy ? t('sharedStarting') : t('sharedStart')}</button>) : <>
              <div><input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder={t('emailPlaceholder')} /><select aria-label={t('invitationRole')} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as CreationSessionSummary['role'])}><option value="viewer">{t('roleViewer')}</option><option value="commenter">{t('roleCommenter')}</option><option value="editor">{t('roleEditor')}</option><option value="runner">{t('roleRunner')}</option><option value="owner">{t('roleOwner')}</option></select><button disabled={!inviteEmail.trim()} onClick={() => { void creationSessionsApi.invite(sessionId, { email: inviteEmail.trim() }, inviteRole).then(async (result) => { if ('acceptPath' in result) { await copyTextToClipboard(`${window.location.origin}${result.acceptPath}`); setPendingInvitations((current) => [...current.filter((item) => item.id !== result.invitationId), { id: result.invitationId, email: result.email, role: result.role as CreationSessionSummary['role'], expiresAt: result.expiresAt, acceptedAt: null, revokedAt: null, createdAt: new Date().toISOString() }]); setNotice(result.emailSent ? t('invitationEmailed') : t('invitationSavedLinkCopied')); } else { const detail = await creationSessionsApi.get(sessionId); setAllMembers(detail.members); setNotice(result.emailSent ? t('collaboratorInvitedEmail') : t('collaboratorInvited')); } setInviteEmail(''); }).catch((error) => setNotice(error instanceof Error ? error.message : t('inviteFailed'))); }}>{t('invite')}</button></div>
              {sessionRole === 'owner' && <div aria-label={t('sessionMembers')}>{allMembers.map((member) => <div key={member.userId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span>{member.displayName || t('collaborator')}{member.userId === currentUserId ? ` ${t('youSuffix')}` : ''}</span>
                <select aria-label={t('roleFor', { name: member.displayName || member.userId })} value={member.role} onChange={(event) => { const role = event.target.value as CreationSessionSummary['role']; void creationSessionsApi.members.update(sessionId, member.userId, role).then(() => setAllMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item))).catch((error) => setNotice(error instanceof Error ? error.message : t('roleUpdateFailed'))); }}><option value="viewer">{t('roleViewer')}</option><option value="commenter">{t('roleCommenter')}</option><option value="editor">{t('roleEditor')}</option><option value="runner">{t('roleRunner')}</option><option value="owner">{t('roleOwner')}</option></select>
                <button type="button" disabled={member.userId === currentUserId} aria-label={t('removeMember', { name: member.displayName || t('member') })} onClick={() => { void creationSessionsApi.members.remove(sessionId, member.userId).then(() => setAllMembers((current) => current.filter((item) => item.userId !== member.userId))).catch((error) => setNotice(error instanceof Error ? error.message : t('memberRemovalFailed'))); }}>×</button>
              </div>)}{!!pendingInvitations.length && <div aria-label={t('pendingInvitations')} style={{ marginTop: 10 }}><strong>{t('pendingInvitations')}</strong>{pendingInvitations.map((invitation) => <div key={invitation.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <span>{invitation.email}</span><small>{invitation.role}</small><button type="button" aria-label={t('revokeInvitation', { email: invitation.email })} onClick={() => { void creationSessionsApi.invitations.revoke(sessionId, invitation.id).then(() => { setPendingInvitations((current) => current.filter((item) => item.id !== invitation.id)); setNotice(t('invitationRevoked')); }).catch((error) => setNotice(error instanceof Error ? error.message : t('invitationRevokeFailed'))); }}>×</button>
              </div>)}</div>}</div>}
            </>}
            <small>{t('accessLabel', { access: persistence === 'local' ? (inRoom ? t('sharedAnyoneWithLink') : t('privateOnDevice')) : inviteRole })}</small>
          </div>}
          {templateOpen && <div className={styles.templateMenu}>
            <header><div><strong>{t('canvasTemplates')}</strong><small>{t('marketplacePacks')}</small></div><button onClick={() => setTemplateOpen(false)} aria-label={t('closeTemplates')}>×</button></header>
            {CREATION_TEMPLATES.map((template) => <button key={template.id} onClick={() => applyTemplate(template)}><b>{template.name}</b><small>{t('templateMeta', { category: template.category, count: template.objects.length })}</small><span>{template.description}</span></button>)}
            {!!serverTemplates.length && <><h4>{t('savedAccount')}</h4>{serverTemplates.map((template) => <button key={template.id} onClick={() => applyServerTemplate(template)}><b>{template.name}</b><small>{template.visibility === 'tenant' ? t('sharedWithTenant') : t('private')} · {template.category}</small><span>{template.description}</span></button>)}</>}
            {!!framePresets.length && <><h4>{t('reusableFrames')}</h4>{framePresets.map((preset) => <button key={preset.id} onClick={() => addFramePreset(preset)}><b>{preset.name}</b><small><span>{t('privateCustomFrame')}</span> · {t('thisDevice')}</small></button>)}</>}
          </div>}
        </div>
      </div>

      {accountGate && <div className={styles.accountGateBackdrop} role="presentation">
        <section className={styles.accountGate} role="dialog" aria-modal="true" aria-labelledby="canvas-account-gate-title">
          <button type="button" className={styles.accountGateClose} aria-label={t('closeAccountPrompt')} onClick={() => setAccountGate(null)}>×</button>
          <span className={styles.accountGateIcon} aria-hidden>✦</span>
          <small>{t('keepMomentum')}</small>
          <h2 id="canvas-account-gate-title">{accountGate.title}</h2>
          <p>{accountGate.description}</p>
          <div className={styles.accountGateBenefits}><span>{`✓ ${t('gateBenefitKeep')}`}</span><span>{`✓ ${t('gateBenefitUnlock')}`}</span><span>{`✓ ${t('gateBenefitCollaborate')}`}</span></div>
          <div className={styles.accountGateActions}>
            <button type="button" className={styles.primaryButton} onClick={() => { trackActivity('creation_account_gate_accepted', { sessionId, metadata: { clientSurface: 'web', action: accountGate.action } }); window.location.href = `/register?next=${encodeURIComponent(`/create/${sessionId}`)}`; }}>{t('createFreeAccount')}</button>
            <button type="button" className={styles.secondaryButton} onClick={() => { window.location.href = `/login?next=${encodeURIComponent(`/create/${sessionId}`)}`; }}>{t('signIn')}</button>
          </div>
          <button type="button" className={styles.accountGateLater} onClick={() => setAccountGate(null)}>{t('notNowKeepLocal')}</button>
        </section>
      </div>}

      <div
        ref={flowWrapRef}
        className={styles.flowWrap}
        style={{
          // The dock owns one edge of the board; every other floating panel is
          // pushed in by exactly its width so nothing can ever sit underneath it.
          '--brain-dock-left': `${brainDock.side === 'left' ? brainDockReserved : 0}px`,
          '--brain-dock-right': `${brainDock.side === 'right' ? brainDockReserved : 0}px`,
        } as CSSProperties}
        data-brain-side={brainDockReserved > 0 ? brainDock.side : 'none'}
        // A phone renders the DOCKED placement as one bottom sheet, so what the board
        // loses there is the bottom edge — not a side. The phone layout moves the
        // board controls off that edge from this, not from the side. An inline Brain
        // is an Object on the board and takes no edge, so it must not set this.
        data-brain-open={brainSurfaceOpen && brainDock.mode === 'docked' ? 'true' : 'false'}
        data-view={threeD ? '3d' : 'flat'}
        data-cursor-mode={drawingMode ? 'draw' : 'pan'} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={() => { cursorRef.current = null; drawingPoints.current = []; }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        {!presentMode && effectiveSelectedIds.length > 0 && <div className={styles.selectionToolbar} aria-label={t('selectionActions')}>
          <span>{t('selectedCount', { count: effectiveSelectedIds.length })}</span>
          <button onClick={focusSelection}>{t('focus')}</button>
          <button onClick={duplicateSelection} disabled={!canEdit}>{t('duplicate')}</button>
          {effectiveSelectedIds.length > 1 && <button onClick={alignSelection} disabled={!canEdit}>{t('align')}</button>}
          {effectiveSelectedIds.length > 1 && <button onClick={frameSelection} disabled={!canEdit}>{t('frame')}</button>}
          <button onClick={togglePlacementLock} disabled={!canEdit}>{effectiveSelectedIds.some((id) => nodes.find((node) => node.id === id)?.data.placementLocked !== true) ? t('lock') : t('unlock')}</button>
          <button onClick={toggleHidden} disabled={!canEdit}>{t('hide')}</button>
        </div>}
        {loadingSession && <div className={styles.canvasSkeleton} role="status" aria-live="polite"><span /><span /><span /><b>{t('loadingSession')}</b></div>}
        {nodes.length > 100 && <div className={styles.performanceNotice} role="status"><strong>{t('largeSession', { count: nodes.length })}</strong><span>{t('largeSessionHint')}</span><button type="button" onClick={openPalette}>{t('frame')}</button></div>}
        {tourStep > 0 && <div style={{ position: 'absolute', zIndex: 30, top: 18, left: '50%', transform: 'translateX(-50%)', width: 'min(430px, calc(100% - 32px))', padding: 16, borderRadius: 14, background: 'var(--bg-elevated, white)', boxShadow: '0 14px 44px rgba(25,40,70,.22)', border: '1px solid var(--border-subtle)' }}>
          <strong>{t(`tourTitle${tourStep}` as 'tourTitle1')}</strong>
          <p style={{ margin: '7px 0 12px', color: 'var(--text-secondary)', fontSize: 13 }}>{t(`tourBody${tourStep}` as 'tourBody1')}</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><small>{t('tourStep', { step: tourStep })}</small><span style={{ display: 'flex', gap: 7 }}><button className={styles.secondaryButton} onClick={() => { localStorage.setItem(tourStorageKey, '1'); setTourStep(0); }}>{t('dismiss')}</button><button className={styles.primaryButton} onClick={() => { trackActivity('creation_tutorial_step_completed', { sessionId, metadata: { clientSurface: 'web', step: tourStep } }); if (tourStep < 6) setTourStep((step) => step + 1); else { localStorage.setItem(tourStorageKey, '1'); setTourStep(0); } }}>{tourStep < 6 ? t('next') : t('startCreating')}</button></span></div>
        </div>}
        <BrainSurfaceProvider value={brainSurface}>
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
          <CanvasCommands
            minimapOpen={minimapOpen}
            setMinimapOpen={setMinimapOpen}
            onCleanLayout={cleanLayout}
            showInteractive={false}
            minimapNodeColor={minimapColor as (node: Node) => string}
            minimapMaskColor="var(--creation-minimap-mask, rgba(244,248,253,.72))"
            threeDActive={threeD}
            onToggleThreeD={() => setThreeD((value) => !value)}
            extraControls={<>
              <CanvasRailToggle
                pressed={filesOpen}
                onClick={() => setFilesOpen((value) => !value)}
                label={tFiles('title')}
              ><CanvasFilesIcon /></CanvasRailToggle>
              <CanvasRailToggle
                pressed={outlineOpen}
                onClick={() => setOutlineOpen((value) => !value)}
                label={t('canvasOutline')}
              ><AccessibleOutlineIcon /></CanvasRailToggle>
            </>}
          />
        </ReactFlow>
        </BrainSurfaceProvider>

        <div className={styles.mobileCanvasActions} role="group" aria-label={t('canvasViewControls')}>
          <button type="button" onClick={zoomInAction} aria-label={t('zoomIn')}>＋</button>
          <button type="button" onClick={zoomOutAction} aria-label={t('zoomOut')}>−</button>
          <button type="button" onClick={fitViewAction} aria-label={threeDControls ? tCommands('threeD.reset') : t('fitCanvas')}>⌗</button>
          <button type="button" onClick={cleanLayout} aria-label={t('arrangeObjects')}>⌘</button>
          <button type="button" onClick={() => setThreeD((value) => !value)} aria-pressed={threeD} aria-label={tCommands('threeD.toggle')}>◱</button>
          {threeDControls && <button type="button" onClick={threeDControls.toggleDepth} aria-pressed={threeDControls.depthMode !== 'flow'} aria-label={tCommands('threeD.depthGroup')}>⧉</button>}
          {threeDControls && <button type="button" onClick={threeDControls.toggleLayers} aria-pressed={threeDControls.layersVisible} aria-label={tCommands('threeD.layerGuides')}>▤</button>}
          {threeDControls?.dropToLayers && <button type="button" onClick={threeDControls.dropToLayers} aria-label={tCommands('threeD.dropToLayers')}>⤓</button>}
          <button type="button" onClick={() => setFilesOpen((value) => !value)} aria-pressed={filesOpen} aria-label={tFiles('title')}><CanvasFilesIcon /></button>
          <button type="button" onClick={() => setOutlineOpen((value) => !value)} aria-pressed={outlineOpen} aria-label={t('canvasOutline')}><AccessibleOutlineIcon /></button>
        </div>

        {threeD && <Canvas3DView
          nodes={threeDNodes}
          edges={edges}
          describe={describeThreeD}
          measure={canvasNodeDimensions}
          selectedIds={effectiveSelectedIds}
          onSelect={selectThreeDObject}
          onMove={canEdit ? moveThreeDObjects : undefined}
          onExit={() => setThreeD(false)}
        />}

        <RemoteCursors members={members} currentUserId={currentUserId} instance={flowRef.current} container={flowWrapRef.current} />
        {filesOpen && <CanvasFilesPanel
          files={sessionFiles}
          onOpen={(nodeId) => { setInspectorFocus(null); setSelectedId(nodeId); setSelectedIds([nodeId]); void flowRef.current?.fitView({ nodes: [{ id: nodeId }], padding: .35, maxZoom: 1.1, duration: 320 }); }}
          onDownload={downloadCanvasFile}
          onClose={() => setFilesOpen(false)}
        />}
        {outlineOpen && <CanvasOutlinePanel
          nodes={nodes}
          edges={edges}
          onFocus={(nodeId) => { setSelectedId(nodeId); setSelectedIds([nodeId]); }}
          onClose={() => setOutlineOpen(false)}
        />}

        {!presentMode && <button className={styles.paletteToggle} onClick={() => setPaletteOpen((value) => !value)} aria-label={t('toggleObjectPalette')}>{paletteOpen ? '‹' : '+'}</button>}
        {!presentMode && paletteOpen && <aside id="canvas-object-palette" className={styles.palette}>
          <div className={styles.paletteHeader}><strong>{t('addToCanvas')}</strong><button onClick={() => setPaletteOpen(false)} aria-label={t('closePalette')}>×</button></div>
          <div className={styles.paletteSearchWrap}><span aria-hidden>⌕</span><input ref={paletteSearchRef} className={styles.search} aria-label={t('searchEverything')} value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder={t('searchEverything')} />{paletteSearch && <button type="button" aria-label={t('clearSearch')} onClick={() => setPaletteSearch('')}>×</button>}</div>
          <div className={styles.paletteSections}>{CREATION_PALETTE_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => `${t(`object.${item.kind}`)} ${t(`group.${item.group}`)} ${item.group} ${item.kind}`.toLowerCase().includes(paletteSearch.trim().toLowerCase())) })).filter((group) => group.items.length).map((group) => {
            const collapsed = !paletteSearch.trim() && collapsedPaletteGroups.has(group.group);
            const regionId = `canvas-palette-${group.group.toLowerCase()}`;
            return <section key={group.group} className={styles.paletteSection}>
              <button type="button" className={styles.paletteSectionToggle} aria-expanded={!collapsed} aria-controls={regionId} onClick={() => setCollapsedPaletteGroups((current) => { const next = new Set(current); if (next.has(group.group)) next.delete(group.group); else next.add(group.group); return next; })}>
                <span className={styles.paletteGroupIcon} aria-hidden>{PALETTE_GROUP_ICONS[group.group]}</span><strong>{t(`group.${group.group}`)}</strong><small>{group.items.length}</small><span className={styles.paletteChevron} aria-hidden>{collapsed ? '›' : '⌄'}</span>
              </button>
              {!collapsed && <div id={regionId} className={styles.paletteGrid}>{group.items.map((item) => <button key={item.kind} aria-label={t(`object.${item.kind}`)} disabled={!canEdit} draggable={canEdit} onDragStart={(event) => { event.dataTransfer.setData(DND_MIME, item.kind); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addAtCenter(item.kind)}><span>{item.icon}</span>{t(`object.${item.kind}`)}</button>)}</div>}
            </section>;
          })}</div>
        </aside>}

        {!presentMode && selectedNode && selectedNode.data.kind !== 'chat' && <Inspector node={selectedNode} nodes={nodes} edges={edges} focus={inspectorFocus} timeline={timeline} brainTrace={brainTrace} sessionId={sessionId} persistence={persistence} role={sessionRole} editable={canEdit && !lockBlocked} members={members} onChange={updateSelected} onWebsiteViewportChange={updateWebsiteViewport} onClose={() => { setSelectedId(null); setInspectorFocus(null); }} onRun={runWorkflow} onPublishWebsite={() => publishWebsite(selectedNode.id)} onGenerateVideo={() => generateVideo(selectedNode.id)} onRunCreativeAction={(action) => runCreativeAction(selectedNode.id, action)} onEditWorkflow={() => setWorkflowFocus({ nodeId: selectedNode.id, definitionId: selectedNode.data.resourceId?.startsWith('workflow:') ? selectedNode.data.resourceId.slice('workflow:'.length) : null })} onSaveAgent={saveAgent} onAddAgentKnowledge={(content) => addAgentKnowledge(selectedNode.id, content)} onRunAgentTest={(testPrompt, expected) => runAgentTest(selectedNode.id, testPrompt, expected)} onSaveFramePreset={saveFramePreset} onExpandProject={expandProject} onLoadProjectQuality={loadProjectQuality} onCompareProjects={compareProjects} onDeliverMockup={deliverMockup} onExpandMockupSet={expandMockupSet} onImportDataset={importDataset} onVisualizeDataset={visualizeDataset} onProfileDataset={profileDataset} onAttachEvermindProject={attachEvermindProject} onExpandEvermindPipeline={expandEvermindPipeline} onTrainEvermind={openEvermindTraining} onStartStandup={startStandup} onExportArtifact={(action) => exportArtifact(selectedNode.id, action)} />}

        {workflowFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label={t('workflowFocusEditor')}>
          <header><div><strong>{t('editWorkflowOnCanvas')}</strong><small>{t('editWorkflowHint')}</small></div><button type="button" onClick={() => setWorkflowFocus(null)} aria-label={t('closeWorkflowEditor')}>×</button></header>
          <div className={styles.workflowFocusBody}><ReactFlowProvider><WorkflowBuilder definitionId={workflowFocus.definitionId} embedded onSaved={(definitionId, name) => { setWorkflowFocus((current) => current ? { ...current, definitionId } : current); setNodes((current) => current.map((node) => node.id === workflowFocus.nodeId ? { ...node, data: { ...node.data, title: name, resourceId: `workflow:${definitionId}`, workflowExecutable: true, resourceSubtype: 'definition', status: 'Saved' } } : node)); setNotice(t('workflowSaved')); }} onRunStarted={(workflowId) => { setNodes((current) => current.map((node) => node.id === workflowFocus.nodeId ? { ...node, data: { ...node.data, status: 'Running', workflowRunId: workflowId } } : node)); setNotice(`Workflow run ${workflowId} started`); }} /></ReactFlowProvider></div>
        </section>}

        {trainingFocus && <section className={styles.workflowFocus} role="dialog" aria-modal="true" aria-label={t('evermindAdapterStudio')}>
          <header><div><strong>{t('trainEvermindOnCanvas')}</strong><small>{t('trainEvermindHint')}</small></div><button type="button" onClick={() => setTrainingFocus(null)} aria-label={t('closeAdapterStudio')}>×</button></header>
          <div className={styles.workflowFocusBody} style={{ overflow: 'auto', background: '#111827', justifyContent: 'center', padding: 20 }}>
            <AITrainingPanel
              projectId={trainingFocus.projectId}
              initialDataMode={trainingFocus.localOnly ? 'local-only' : 'workspace'}
              workspaceEnabled={!trainingFocus.localOnly}
              onJobCompleted={(job) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Adapter trained', trainingJobId: job.id, adapterArtifact: job.r2_artifact_key, model: job.base_model, loraRank: job.lora_rank } } : node));
                setNotice(t('adapterTrained'));
              }}
              onLocalArtifactCompleted={(artifact) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Local adapter trained', adapterArtifact: `local://${artifact.filename}`, trainableParams: artifact.trainableParams } } : node));
                setNotice(t('localAdapterTrained'));
              }}
              onModelPublished={(model) => {
                setNodes((current) => current.map((node) => node.id === trainingFocus.nodeId ? { ...node, data: { ...node.data, status: 'Published', model: model.ref, modelSlug: model.slug, evermindRef: model.evermindRef, publishedAt: new Date().toISOString() } } : node));
                setNotice(`Evermind published and callable as ${model.ref}`);
              }}
            />
          </div>
        </section>}

        {historyOpen && <aside className={styles.historyPanel}><header><div><strong>{t('versionHistory')}</strong><small>{t('versionHistoryHint')}</small></div><button onClick={() => setHistoryOpen(false)} aria-label={t('closeHistory')}>×</button></header>{persistence === 'local' ? <p>{t('historyLocalOnly')}</p> : <><button className={styles.primaryButton} onClick={createCheckpoint} disabled={!canEdit}>{t('nameCheckpoint')}</button><div>{history.length ? history.map((snapshot) => <button key={snapshot.revision} onClick={() => restoreRevision(snapshot.revision)} disabled={!canEdit}><b>{snapshot.label || t('revisionLabel', { revision: snapshot.revision })}</b><span>{t('revisionMeta', { revision: snapshot.revision, at: new Date(snapshot.createdAt).toLocaleString() })}</span></button>) : <p>{t('noRevisions')}</p>}</div></>}</aside>}
        {outcomeMetricsOpen && <aside className={`${styles.historyPanel} ${styles.outcomeMetricsPanel}`} aria-label={t('sessionOutcomeMetrics')}>
          <header><div><strong>{t('ideaToDelivery')}</strong><small>{outcomeMetrics ? t('sessionVsTenant', { count: outcomeMetrics.sampleSize }) : t('valueGenerated')}</small></div><button onClick={() => setOutcomeMetricsOpen(false)} aria-label={t('closeOutcomeMetrics')}>×</button></header>
          {persistence === 'local' ? <div className={styles.outcomeEmpty}><span aria-hidden>↗</span><strong>{t('saveForBaseline')}</strong><p>{t('saveForBaselineHint')}</p><button className={styles.primaryButton} onClick={() => requireAccount('metrics', t('gateMetricsTitle'), t('gateMetricsBody'))}>{t('saveAndMeasure')}</button></div> : outcomeMetricsLoading ? <p role="status">{t('calculatingValue')}</p> : outcomeMetricsError ? <div className={styles.outcomeEmpty}><strong>{t('metricsUnavailable')}</strong><p>{outcomeMetricsError}</p><button className={styles.secondaryButton} onClick={openOutcomeMetrics}>{t('retry')}</button></div> : outcomeMetrics ? <div className={styles.outcomeMetricList}>{outcomeMetrics.metrics.map((metric) => {
            const comparable = metric.current != null && metric.baseline != null;
            const delta = comparable ? metric.current! - metric.baseline! : null;
            const improving = delta == null ? null : metric.direction === 'higher' ? delta >= 0 : false;
            const favorable = improving == null ? null : improving || (metric.direction !== 'higher' && delta! <= 0);
            return <article key={metric.key} className={styles.outcomeMetric}>
              <div><strong>{metric.label}</strong><span>{formatOutcomeValue(metric.current, metric.unit)}</span></div>
              <small>{metric.baseline == null ? t('baselineGathering') : t('typicalValue', { value: formatOutcomeValue(metric.baseline, metric.unit) })}{delta != null && Math.abs(delta) > .0001 ? <em data-positive={favorable}>{favorable ? ' ↗' : ' ↘'}</em> : null}</small>
            </article>;
          })}</div> : null}
          <footer><span>{t('correlationCoverage')}</span><small>{t('aggregatesScoped')}</small></footer>
        </aside>}
        {conversationOpen && <aside className={styles.historyPanel} aria-label={t('sessionConversation')}><header><div><strong>{t('sessionConversation')}</strong><small>{t('sessionConversationHint')}</small></div><span className={styles.panelHeaderActions}><CopyButton compact label={t('copyDiagnostics')} ariaLabel={t('copyChatDiagnostics')} getText={buildDiagnostics} /><button onClick={() => setConversationOpen(false)} aria-label={t('closeConversation')}>×</button></span></header><div>{timeline.length ? timeline.map((message) => <article key={message.clientMessageId} style={{ padding: '9px 10px', borderBottom: '1px solid var(--border-subtle)' }}><strong style={{ textTransform: 'capitalize' }}>{message.metadata?.authoredBy?.name || (message.messageRole === 'assistant' ? 'Brain' : message.messageRole)}</strong><p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{message.body}</p><small>{new Date(message.createdAt).toLocaleString()}</small></article>) : <p>{t('brainEmpty')}</p>}</div></aside>}
        {diagnosticsOpen && <aside className={`${styles.historyPanel} ${styles.diagnosticsPanel}`} aria-label={t('canvasDiagnostics')}><header><div><strong>{t('diagnostics')}</strong><small>{t('diagnosticsHint')}</small></div><button onClick={() => setDiagnosticsOpen(false)} aria-label={t('closeDiagnostics')}>×</button></header><div className={styles.diagnosticsSummary}><dl><div><dt>{t('diagSession')}</dt><dd>{t('diagSessionValue', { persistence, revision: revision.current })}</dd></div><div><dt>{t('diagRealtime')}</dt><dd>{realtimeState}</dd></div><div><dt>{t('diagCanvas')}</dt><dd>{t('diagCanvasValue', { objects: nodes.length, connections: edges.length })}</dd></div><div><dt>{t('brain')}</dt><dd>{t('diagBrainValue', { state: thinking ? t('diagResponding') : t('diagReady'), actions: canvasActions.length })}</dd></div><div><dt>{t('diagScope')}</dt><dd>{resolvedScopeMode}</dd></div><div><dt>{t('diagAccess')}</dt><dd>{sessionRole}</dd></div></dl><CopyButton label={t('copyDiagnostics')} ariaLabel={t('copyCanvasDiagnostics')} getText={buildDiagnostics} /></div></aside>}

        {!!proposedChanges.length && <aside className={styles.changeSetPanel}><header><div><strong>{t('reviewBrainChanges')}</strong><small>{t('reviewBrainChangesHint')}</small></div><button onClick={rejectProposedChanges} aria-label={t('closeChangeSet')}>×</button></header><div>{proposedChanges.map((change) => <label key={change.id}><input type="checkbox" checked={acceptedProposalIds.has(change.id)} onChange={() => setAcceptedProposalIds((current) => { const next = new Set(current); if (next.has(change.id)) next.delete(change.id); else next.add(change.id); return next; })} /><span><b>{change.label}</b><small>{change.type.replace('.', ' ')}</small></span></label>)}</div><footer><button className={styles.secondaryButton} onClick={rejectProposedChanges}>{t('rejectAll')}</button><button className={styles.secondaryButton} disabled={!acceptedProposalIds.size} onClick={applyAndEnableAutoApply} title={t('applyAutoApplyHint')}>{t('applyAutoApply')}</button><button className={styles.primaryButton} disabled={!acceptedProposalIds.size} onClick={applyProposedChanges}>{t('applySelected', { count: acceptedProposalIds.size })}</button></footer></aside>}
        {mergeReview && <aside className={styles.mergePanel}><header><div><strong>{t('mergeBranch')}</strong><p>{t('mergeBranchHint')}</p></div><button onClick={() => setMergeReview(null)} aria-label={t('closeMergeReview')}>×</button></header>{mergeReview.items.map((item) => <label key={item.key}><b>{item.source.data.title}</b><small>{item.target ? t('mergeBothContain', { kind: item.source.data.kind }) : t('mergeNewFromBranch', { kind: item.source.data.kind })}</small>{item.target && <span><select aria-label={t('mergeChoiceFor', { title: item.source.data.title })} value={item.choice} onChange={(event) => setMergeReview((current) => current ? { ...current, items: current.items.map((candidate) => candidate.key === item.key ? { ...candidate, choice: event.target.value as 'branch' | 'parent' } : candidate) } : current)}><option value="branch">{t('useBranchVersion')}</option><option value="parent">{t('keepParentVersion')}</option></select></span>}</label>)}<button className={styles.primaryButton} onClick={applyMerge}>{t('applyReviewedMerge')}</button></aside>}

        {/* Docked ONLY. An inline Brain renders inside its Object on the graph, so
            rendering the edge panel here too would put the same live conversation on
            screen twice — the duplicate this placement model exists to prevent. */}
        {brainSurfaceOpen && brainDock.mode === 'docked' && <BrainDock
          mode={brainDock.mode}
          side={brainDock.side}
          size={brainDock.size}
          width={brainDockWidth(brainDock)}
          showExecutionDetail={brainDock.showExecutionDetail}
          onModeChange={(mode) => updateBrainDock({ mode })}
          onSideChange={(side) => updateBrainDock({ side })}
          // Switching preset clears a stale drag width, so "expand" always expands.
          onSizeChange={(size) => updateBrainDock({ size, width: null })}
          onWidthChange={(width, commit) => updateBrainDock({ width }, commit)}
          onExecutionDetailChange={(showExecutionDetail) => updateBrainDock({ showExecutionDetail })}
          onClose={() => updateBrainDock({ open: false })}
          messages={brainMessages}
          trace={brainTrace}
          running={thinking}
          runStartedAt={brainRunStartedAt}
          node={brainNode}
          nodes={nodes}
          edges={edges}
          collaborators={members.filter((member) => member.userId !== currentUserId)}
          joinedCollaborator={joinedCollaborator}
        />}
        {composer}
        {/* The way back to a closed Brain. An inline Brain that still has its Object on
            the board already offers one ("Open Brain chat"), so the pill would be a
            second control for the same thing — it appears only when there is no Object
            to click, which is exactly when the board has no other route back. */}
        {!presentMode && !brainDock.open && (brainDock.mode === 'docked' || !brainNode) && <button
          type="button"
          className={styles.brainDockLauncher}
          data-side={brainDock.side}
          aria-label={t('openBrainDock')}
          title={t('openBrainDock')}
          onClick={() => updateBrainDock({ open: true })}
        ><span aria-hidden>✦</span>{t('brain')}</button>}
      </div>
    </div>
  );
}

function RemoteCursors({ members, currentUserId, instance, container }: { members: CreationSessionDetail['members']; currentUserId: string | null; instance: ReactFlowInstance<CreationFlowNode, Edge> | null; container: HTMLDivElement | null }) {
  if (!instance || !container) return null;
  const rect = container.getBoundingClientRect();
  return <div className={styles.remoteCursors} aria-live="polite">{members.filter((member) => member.userId !== currentUserId && typeof member.cursor?.x === 'number' && typeof member.cursor?.y === 'number').map((member, index) => {
    const screen = instance.flowToScreenPosition({ x: member.cursor!.x!, y: member.cursor!.y! });
    return <span key={member.userId} style={{ left: screen.x - rect.left, top: screen.y - rect.top, color: ['#d946ef', '#f97316', '#059669', '#2563eb'][index % 4] }}><i>◢</i><b>{member.displayName || 'Collaborator'}{member.typing ? ' · …' : ''}</b></span>;
  })}</div>;
}

function Inspector({ node, nodes, edges, focus, timeline, brainTrace, sessionId, persistence, role, editable, members, onChange, onWebsiteViewportChange, onClose, onRun, onPublishWebsite, onGenerateVideo, onRunCreativeAction, onEditWorkflow, onSaveAgent, onAddAgentKnowledge, onRunAgentTest, onSaveFramePreset, onExpandProject, onLoadProjectQuality, onCompareProjects, onDeliverMockup, onExpandMockupSet, onImportDataset, onVisualizeDataset, onProfileDataset, onAttachEvermindProject, onExpandEvermindPipeline, onTrainEvermind, onStartStandup, onExportArtifact }: { node: CreationFlowNode; nodes: CreationFlowNode[]; edges: Edge[]; focus: 'knowledge' | 'test' | 'evaluation' | 'delivery' | null; timeline: CanvasTimelineMessage[]; brainTrace: BrainTraceEvent[]; sessionId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; editable: boolean; members: CreationSessionDetail['members']; onChange: (patch: Partial<CreationNodeData>) => void; onWebsiteViewportChange: (viewport: 'desktop' | 'tablet' | 'mobile') => void; onClose: () => void; onRun: () => void; onPublishWebsite: () => void; onGenerateVideo: () => void; onRunCreativeAction: (action: string) => void; onEditWorkflow: () => void; onSaveAgent: () => void; onAddAgentKnowledge: (content: string) => void; onRunAgentTest: (testPrompt: string, expected: string) => void | Promise<void>; onSaveFramePreset: () => void; onExpandProject: () => void; onLoadProjectQuality: () => void; onCompareProjects: () => void; onDeliverMockup: () => void; onExpandMockupSet: () => void; onImportDataset: (file: File) => void | Promise<void>; onVisualizeDataset: () => void; onProfileDataset: (nodeId: string) => void; onAttachEvermindProject: () => void; onExpandEvermindPipeline: () => void; onTrainEvermind: () => void; onStartStandup: () => void; onExportArtifact: (action: CanvasExportAction) => Promise<string> }) {
  const t = useTranslations('creationCanvas');
  const kind = node.data.kind;
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  const [accessStatus, setAccessStatus] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState('');
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
  useEffect(() => {
    if (!focus) return;
    const frame = window.requestAnimationFrame(() => inspectorRef.current?.querySelector<HTMLElement>(`[data-inspector-section="${focus}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focus, node.id]);
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
  const markdown = canvasObjectMarkdown(node.data);
  const csv = artifactCsv(node.data);
  const deliverables = creationDeliverables(node.data);
  const taskId = kind === 'task' && /^task:\d+$/.test(node.data.resourceId || '') ? Number(node.data.resourceId!.slice(5)) : null;
  const taskAgents = nodes.filter((candidate) => candidate.data.kind === 'agent');
  const agentTools = Array.isArray(node.data.tools) ? node.data.tools.map(String) : ['Audience Analyzer', 'Copy Optimizer'];
  const isExistingAgent = kind === 'agent' && typeof node.data.resourceId === 'string' && node.data.resourceId.startsWith('agent:');
  const connectedAgentKnowledge = kind === 'agent' ? nodes.filter((candidate) => ['knowledge', 'document', 'dataset', 'file', 'url'].includes(candidate.data.kind) && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : [];
  const connectedAgentEvaluation = kind === 'agent' ? nodes.find((candidate) => candidate.data.kind === 'evaluation' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const connectedAgentRelease = kind === 'agent' ? nodes.find((candidate) => candidate.data.kind === 'release' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) : undefined;
  const deliveryAgent = kind === 'release' ? (nodes.find((candidate) => candidate.data.kind === 'agent' && edges.some((edge) => (edge.source === node.id && edge.target === candidate.id) || (edge.target === node.id && edge.source === candidate.id))) || (nodes.filter((candidate) => candidate.data.kind === 'agent').length === 1 ? nodes.find((candidate) => candidate.data.kind === 'agent') : undefined)) : undefined;
  const deliveryKnowledgeCount = deliveryAgent ? nodes.filter((candidate) => ['knowledge', 'document', 'dataset', 'file', 'url'].includes(candidate.data.kind) && edges.some((edge) => (edge.source === deliveryAgent.id && edge.target === candidate.id) || (edge.target === deliveryAgent.id && edge.source === candidate.id))).length : 0;
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
    setActionStatus(t('savingTask'));
    try {
      if (taskId != null && persistence === 'server') await tasksApi.update(taskId, apiPatch);
      onChange(canvasPatch);
      setActionStatus(taskId != null && persistence === 'server' ? t('taskUpdated') : t('taskUpdatedLocal'));
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : t('taskUpdateFailed'));
    }
  };
  const runArtifactAction = async (action: CanvasExportAction) => {
    setActionStatus(t('preparing'));
    setActionStatus(await onExportArtifact(action));
  };
  return <aside ref={inspectorRef} className={styles.inspector} aria-label="Details panel" style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}>
    <div
      className={styles.inspectorResizeHandle}
      role="separator"
      aria-label={t('resizeDetailsPanel')}
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
    <header><div className={styles.inspectorTitle}><span>{kind === 'agent' ? '✦' : kind === 'website' ? '◎' : kind === 'workflow' ? '⌘' : '◇'}</span><strong>{node.data.title}</strong><small>{t('liveKind', { kind })}</small></div><div className={styles.inspectorHeaderActions}><button type="button" onClick={toggleInspectorWidth} aria-label={expandedInspector ? t('restoreDetailsWidth') : t('expandDetailsPanel')} title={expandedInspector ? t('restorePanelWidth') : t('expandPanel')}>{expandedInspector ? '⇥' : '↔'}</button><button type="button" onClick={onClose} aria-label={t('closeInspector')}>×</button></div></header>
    <div className={styles.inspectorTabs}><button className={tab === 'details' ? styles.activeTab : ''} onClick={() => setTab('details')}>{t('details')}</button><button className={tab === 'activity' ? styles.activeTab : ''} onClick={() => setTab('activity')}>{t('activity')}</button></div>
    <div className={styles.inspectorBody}>
      {tab === 'details' ? <fieldset className={styles.inspectorFields} disabled={!editable}>
      {node.data.redacted === true && <><p className={styles.inspectorHint}>{t('redactedObject')}</p><button type="button" className={styles.fullButton} disabled={persistence !== 'server' || !!accessStatus} onClick={() => { setAccessStatus(t('requesting')); void creationSessionsApi.requestObjectAccess(sessionId, node.id).then(() => setAccessStatus(t('accessRequested'))).catch((error) => setAccessStatus(error instanceof Error ? error.message : t('requestFailed'))); }}>{accessStatus || t('requestAccess')}</button></>}
      <label>{t('name')}<input value={node.data.title} onChange={(event) => onChange({ title: event.target.value })} /></label>
      {typeof node.data.pipelineStep === 'number' && <section className={styles.pipelineInspectorGuide} aria-label={t('evermindSetupStep', { step: node.data.pipelineStep })}><span>{t('evermindSetupOf5', { step: node.data.pipelineStep })}</span><strong>{node.data.pipelineStart === true ? t('startHere') : node.data.title}</strong><p>{String(node.data.pipelineInstruction || t('pipelineStageHint'))}</p>{node.data.pipelineStep === 1 && node.data.status !== 'Imported' && <small>{t('useFilePicker')}</small>}{node.data.pipelineStep === 1 && node.data.status === 'Imported' && <small>{t('dataReadyNext')}</small>}</section>}
      {kind === 'agent' && <>
        <section className={styles.agentSetupGuide} data-existing={isExistingAgent} aria-label={t('agentSetupProgress')}>
          <strong>{isExistingAgent ? t('agentExisting') : t('agentPrepareNew')}</strong>
          <p>{isExistingAgent ? t('agentExistingHint') : t('agentPrepareHint')}</p>
          {!isExistingAgent && <div className={styles.agentSetupSteps}><span data-done={!!String(node.data.personality || '').trim()}>{t('agentStepPersonality')}</span><span data-done={connectedAgentKnowledge.length > 0}>{connectedAgentKnowledge.length ? t('agentStepTrainingAdded') : t('agentStepTrainingNeeded')}</span><span data-done={!!String(node.data.instructions || '').trim()}>{t('agentStepDirection')}</span><span data-done={!!node.data.testResponse}>{node.data.testResponse ? t('agentStepTestRun') : t('agentStepTestNeeded')}</span></div>}
        </section>
        {!isExistingAgent && <label>{t('personality')}<textarea aria-label={t('personality')} value={typeof node.data.personality === 'string' ? node.data.personality : ''} onChange={(event) => onChange({ personality: event.target.value })} rows={3} placeholder={t('personalityPlaceholder')} /></label>}
        <label>{t('model')}<select value={node.data.model || 'auto'} onChange={(event) => onChange({ model: event.target.value })}><option value="auto">{t('modelAuto')}</option><option value="gpt-4o">gpt-4o</option><option value="claude-3.5-sonnet">claude-3.5-sonnet</option><option value="Evermind">Evermind</option></select></label>
        <label>{isExistingAgent ? t('instructions') : t('agentDirection')}<textarea aria-label={t('instructions')} value={typeof node.data.instructions === 'string' ? node.data.instructions : node.data.subtitle || ''} onChange={(event) => onChange({ instructions: event.target.value, subtitle: event.target.value })} rows={5} placeholder={isExistingAgent ? undefined : t('agentDirectionPlaceholder')} /></label>
        <label>{t('tools')}<div className={styles.inspectorPills}>{agentTools.map((tool) => <button type="button" key={tool} aria-label={t('removeTool', { tool })} onClick={() => onChange({ tools: agentTools.filter((candidate) => candidate !== tool) })}>{tool} ×</button>)}<button type="button" disabled={availableAgentTools.every((tool) => agentTools.includes(tool))} onClick={() => { const next = availableAgentTools.find((tool) => !agentTools.includes(tool)); if (next) onChange({ tools: [...agentTools, next] }); }}>{t('addTool')}</button></div></label>
        <label>{t('autonomy')}<select value={typeof node.data.autonomy === 'string' ? node.data.autonomy : 'medium'} onChange={(event) => onChange({ autonomy: event.target.value })}><option value="medium">{t('autonomyMedium')}</option><option value="low">{t('autonomyLow')}</option><option value="high">{t('autonomyHigh')}</option></select></label>
        <section className={styles.agentWorkbench} aria-label={t('agentKnowledge')} data-inspector-section="knowledge">
          <div className={styles.workbenchHeading}><strong>{t('knowledge')}</strong><span>{t('connectedCount', { count: connectedAgentKnowledge.length })}</span></div>
          {connectedAgentKnowledge.length > 0 && <div className={styles.knowledgeList}>{connectedAgentKnowledge.map((item) => <span key={item.id}>{item.data.kind} · {item.data.title}</span>)}</div>}
          <label>{t('addKnowledge')}<textarea rows={4} value={knowledgeDraft} onChange={(event) => setKnowledgeDraft(event.target.value)} placeholder={t('addKnowledgePlaceholder')} /></label>
          <button type="button" className={styles.fullButton} disabled={!knowledgeDraft.trim()} onClick={() => { onAddAgentKnowledge(knowledgeDraft); setKnowledgeDraft(''); }}>{t('addAndConnectKnowledge')}</button>
        </section>
        <section className={styles.agentWorkbench} aria-label={t('agentTestBench')} data-inspector-section="test">
          <div className={styles.workbenchHeading}><strong>{t('testBench')}</strong><span>{String(node.data.testStatus || t('notRun'))}</span></div>
          <label>{t('customerMessage')}<textarea rows={3} value={typeof node.data.testPrompt === 'string' ? node.data.testPrompt : ''} onChange={(event) => onChange({ testPrompt: event.target.value })} placeholder={t('customerMessagePlaceholder')} /></label>
          <label>{t('expectedSignals')}<textarea rows={2} value={typeof node.data.testExpected === 'string' ? node.data.testExpected : ''} onChange={(event) => onChange({ testExpected: event.target.value })} placeholder={t('expectedSignalsPlaceholder')} /></label>
          <button type="button" className={styles.fullButton} disabled={!String(node.data.testPrompt || '').trim() || node.data.testStatus === 'Running'} onClick={() => void onRunAgentTest(String(node.data.testPrompt || ''), String(node.data.testExpected || ''))}>{node.data.testStatus === 'Running' ? t('runningTest') : t('runAgentTest')}</button>
          {typeof node.data.testResponse === 'string' && node.data.testResponse && <div className={styles.testResponse}><strong>{t('agentResponse')}</strong><p>{node.data.testResponse}</p></div>}
        </section>
        <button type="button" className={styles.fullButton} onClick={onSaveAgent}>{isExistingAgent ? t('saveAgentEverywhere') : t('createInviteAgent')}</button>
      </>}
      {kind === 'evaluation' && <section data-inspector-section="evaluation">
        <div className={styles.evaluationSummary}><strong>{String(node.data.verdict || t('notRun'))}</strong><span>{typeof node.data.passRate === 'number' ? t('passRate', { rate: node.data.passRate }) : t('runTestForResult')}</span></div>
        <label>{t('evaluationCriteria')}<textarea rows={5} value={typeof node.data.criteria === 'string' ? node.data.criteria : typeof node.data.content === 'string' ? node.data.content : ''} onChange={(event) => onChange({ criteria: event.target.value })} placeholder={t('evaluationCriteriaPlaceholder')} /></label>
        <p className={styles.inspectorHint}>{t('evaluationHint')}</p>
        {Array.isArray(node.data.testResults) && node.data.testResults.length > 0 && <div className={styles.testResults}>{node.data.testResults.slice(0, 10).map((value, index) => { const result = value as Record<string, unknown>; return <div key={String(result.id || index)}><b>{String(result.status || t('completed'))}</b><span>{String(result.prompt || t('testCase'))}</span><small>{String(result.runAt || '')}</small></div>; })}</div>}
      </section>}
      {kind === 'release' && <section className={styles.deliveryChecklist} data-inspector-section="delivery" aria-label={t('agentDeliveryChecklist')}>
        <strong>{t('deliveryChecklist')}</strong>
        <span>{`${deliveryAgent ? '✓' : '○'} ${t('agentSelected')} ${deliveryAgent ? `· ${deliveryAgent.data.title}` : `· ${t('connectAgentCard')}`}`}</span>
        <span>{`${deliveryKnowledgeCount > 0 ? '✓' : '○'} ${t('knowledgeConnected')} ${deliveryKnowledgeCount ? `· ${t('sourceCount', { count: deliveryKnowledgeCount })}` : ''}`}</span>
        <span>{`${deliveryAgent?.data.testResponse ? '✓' : '○'} ${t('testResponseRecorded')}`}</span>
        <span>{`${deliveryAgent?.data.resourceId ? '✓' : '○'} ${t('workforceAgentSaved')}`}</span>
        <p className={styles.inspectorHint}>{deliveryAgent?.data.resourceId ? t('deliveryConnectedHint') : t('deliveryPendingHint')}</p>
      </section>}
      {kind === 'staff' && <><label>{t('role')}<input value={node.data.role || ''} onChange={(event) => onChange({ role: event.target.value })} /></label><label>{t('currentFocus')}<textarea value={node.data.focus || ''} onChange={(event) => onChange({ focus: event.target.value })} rows={4} /></label></>}
      {(kind === 'website' || kind === 'prototype') && <><label>{t('headline')}<input value={typeof node.data.websiteHeadline === 'string' ? node.data.websiteHeadline : 'Fall in love with every look'} onChange={(event) => onChange({ websiteHeadline: event.target.value })} /></label><label>{t('supportingCopy')}<textarea rows={3} value={typeof node.data.websiteBody === 'string' ? node.data.websiteBody : 'New arrivals for the season ahead.'} onChange={(event) => onChange({ websiteBody: event.target.value })} /></label><label>{t('callToAction')}<input value={typeof node.data.websiteCta === 'string' ? node.data.websiteCta : 'Shop the collection'} onChange={(event) => onChange({ websiteCta: event.target.value })} /></label><label>{t('accentColor')}<input type="color" value={typeof node.data.websiteAccent === 'string' ? node.data.websiteAccent : '#3978f6'} onChange={(event) => onChange({ websiteAccent: event.target.value })} /></label><label>{t('viewport')}<select value={typeof node.data.viewport === 'string' ? node.data.viewport : 'desktop'} onChange={(event) => onWebsiteViewportChange(event.target.value as 'desktop' | 'tablet' | 'mobile')}><option value="desktop">{t('viewportDesktop')}</option><option value="tablet">{t('viewportTablet')}</option><option value="mobile">{t('viewportMobile')}</option></select></label>{kind === 'website' && <><label>{t('subdomain')}<input value={typeof node.data.subdomain === 'string' ? node.data.subdomain : ''} placeholder={t('subdomainPlaceholder')} onChange={(event) => onChange({ subdomain: event.target.value })} /></label><button type="button" className={styles.fullButton} onClick={onPublishWebsite}>{t('publishWebsite')}</button>{typeof node.data.siteUrl === 'string' && <a href={node.data.siteUrl} target="_blank" rel="noreferrer">{t('openPublishedSite')}</a>}</>}<p className={styles.inspectorHint}>{t('websiteLiveHint')}</p></>}
      {kind === 'video' && <><label>{t('prompt')}<textarea rows={5} value={typeof node.data.prompt === 'string' ? node.data.prompt : ''} onChange={(event) => onChange({ prompt: event.target.value })} placeholder={t('videoPromptPlaceholder')} /></label><label>{t('publishedEvermindModel')}<input value={typeof node.data.modelSlug === 'string' ? node.data.modelSlug : ''} onChange={(event) => onChange({ modelSlug: event.target.value })} placeholder={t('mediaModelPlaceholder')} /></label><label>{t('frames')}<input type="number" min="1" max="64" value={typeof node.data.maxFrames === 'number' ? node.data.maxFrames : 16} onChange={(event) => onChange({ maxFrames: Math.max(1, Math.min(64, Number(event.target.value) || 16)) })} /></label><button type="button" className={styles.fullButton} onClick={onGenerateVideo}>{t('generateVideo')}</button>{typeof node.data.videoUrl === 'string' && <img src={node.data.videoUrl} alt={t('videoFirstFrame')} style={{ width: '100%', borderRadius: 10 }} />}</>}
      {kind === 'workflow' && <><label>{t('executionTarget')}<select value={typeof node.data.runTarget === 'string' ? node.data.runTarget : 'builderforce'} onChange={(event) => onChange({ runTarget: event.target.value })}><option value="builderforce">BuilderForce.AI</option><option value="campaign-strategist">Campaign Strategist</option></select></label><label>{t('approvalMode')}<select value={typeof node.data.approvalMode === 'string' ? node.data.approvalMode : 'required'} onChange={(event) => onChange({ approvalMode: event.target.value })}><option value="required">{t('approvalRequiredBeforePublish')}</option><option value="autonomous">{t('fullyAutonomous')}</option></select></label><button type="button" className={styles.fullButton} onClick={onEditWorkflow}>{t('editWorkflowOnCanvas')}</button><button className={styles.fullButton} onClick={onRun}>{`▶ ${t('runWorkflow')}`}</button></>}
      {kind === 'dashboard' && <><label>{t('dateRange')}<select value={typeof node.data.dateRange === 'string' ? node.data.dateRange : '30d'} onChange={(event) => onChange({ dateRange: event.target.value })}><option value="30d">{t('last30Days')}</option><option value="7d">{t('last7Days')}</option><option value="qtd">{t('quarterToDate')}</option></select></label><button type="button" className={styles.fullButton} onClick={() => onChange({ fetchedAt: new Date().toISOString(), status: 'Live' })}>{t('refreshLiveData')}</button></>}
      {kind === 'dataset' && <>
        <label>{t('datasetImportLabel')}<input type="file" accept=".csv,.tsv,.tab,.json,.jsonl,text/csv,text/tab-separated-values,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportDataset(file); }} /></label>
        <p className={styles.inspectorHint}>{t('datasetImportHint')}</p>
        <DatasetProfileSummary data={node.data} />
        <button type="button" className={styles.fullButton} onClick={() => onProfileDataset(node.id)}>{t('datasetProfileAction')}</button>
        <button type="button" className={styles.fullButton} onClick={onVisualizeDataset}>{t('datasetVisualizeAction')}</button>
      </>}
      {kind === 'file' && <>
        <label>{t('fileNameLabel')}<input value={typeof node.data.fileName === 'string' ? node.data.fileName : node.data.title} onChange={(event) => onChange({ fileName: event.target.value })} /></label>
        <p className={styles.inspectorHint}>{t('fileInspectorHint')}</p>
      </>}
      {kind === 'voice' && <CanvasVoiceInspector node={node} persistence={persistence} onChange={onChange} />}
      {kind === 'project' && <><label>{t('projectView')}<select value={typeof node.data.projectLens === 'string' ? node.data.projectLens : 'everything'} onChange={(event) => onChange({ projectLens: event.target.value })}><option value="everything">{t('lensEverything')}</option><option value="delivery">{t('lensDelivery')}</option><option value="metrics">{t('lensMetrics')}</option><option value="customer-feedback">{t('lensFeedback')}</option></select></label><p className={styles.inspectorHint}>{t('projectContextHint')}</p><button className={styles.fullButton} onClick={onLoadProjectQuality}>{t('visualizeQuality')}</button><button className={styles.fullButton} onClick={onExpandProject}>{t('addRelatedItems')}</button><button className={styles.fullButton} onClick={onCompareProjects}>{t('compareProjects')}</button></>}
      {kind === 'task' && <>
        <div className={styles.taskInspectorGrid}>
          <label>{t('status')}<select value={String(node.data.status || 'ready')} onChange={(event) => void persistTaskPatch({ status: event.target.value }, { status: event.target.value })}>
            {!['backlog','todo','ready','assigned','in_progress','in_review','blocked','done'].includes(String(node.data.status || 'ready')) && <option value={String(node.data.status)}>{String(node.data.status)}</option>}
            <option value="backlog">{t('statusBacklog')}</option><option value="todo">{t('statusTodo')}</option><option value="ready">{t('statusReady')}</option><option value="assigned">{t('statusAssigned')}</option><option value="in_progress">{t('statusInProgress')}</option><option value="in_review">{t('statusInReview')}</option><option value="blocked">{t('statusBlocked')}</option><option value="done">{t('statusDone')}</option>
          </select></label>
          <label>{t('priority')}<select value={typeof node.data.priority === 'string' ? node.data.priority : 'medium'} onChange={(event) => void persistTaskPatch({ priority: event.target.value as 'low' | 'medium' | 'high' | 'urgent' }, { priority: event.target.value })}><option value="low">{t('priorityLow')}</option><option value="medium">{t('priorityMedium')}</option><option value="high">{t('priorityHigh')}</option><option value="urgent">{t('priorityUrgent')}</option></select></label>
        </div>
        <div className={styles.statusGuidance}><b>{t('howToMoveForward')}</b><p>{statusGuidance[normalizedTaskStatus] || t('taskGuidanceFallback')}</p></div>
        <label>{t('assignedAgent')}<select value={taskAgentValue} onChange={(event) => {
          const selected = taskAgents.find((agent) => (agent.data.resourceId?.replace(/^agent:/, '') || agent.id) === event.target.value);
          const agentRef = selected?.data.resourceId?.startsWith('agent:') ? selected.data.resourceId.slice(6) : null;
          if (taskId != null && persistence === 'server' && selected && !agentRef) { setActionStatus(t('saveAgentBeforeAssign')); return; }
          void persistTaskPatch({ assignedAgentRef: agentRef, assignedAgentHostId: null, assignedUserId: null }, { agentRef: event.target.value || undefined, assignee: selected?.data.title || undefined, role: selected?.data.title || undefined });
        }}><option value="">{t('unassigned')}</option>{taskAgents.map((agent) => { const value = agent.data.resourceId?.replace(/^agent:/, '') || agent.id; return <option key={agent.id} value={value}>{agent.data.title}{agent.data.model ? ` · ${String(agent.data.model)}` : ''}</option>; })}</select></label>
        <label>{t('description')}<textarea rows={5} value={typeof node.data.content === 'string' ? node.data.content : typeof node.data.subtitle === 'string' ? node.data.subtitle : ''} onChange={(event) => onChange({ content: event.target.value })} onBlur={(event) => { if (taskId != null && persistence === 'server') void persistTaskPatch({ description: event.target.value || null }, { content: event.target.value }); }} /></label>
        <label>{t('acceptanceCriteria')}<textarea rows={4} value={typeof node.data.acceptanceCriteria === 'string' ? node.data.acceptanceCriteria : ''} placeholder={t('acceptanceCriteriaPlaceholder')} onChange={(event) => onChange({ acceptanceCriteria: event.target.value })} /></label>
        <section className={styles.taskPrdSummary} aria-label={t('taskPrd')}>
          <div><span>{t('prd')}</span>{prdStatus && <small>{prdStatus}</small>}</div>
          {prdTitle ? <><strong>{prdTitle}</strong>{prdSummary && <p>{prdSummary.replace(/[#*_`>\[\]]/g, '').trim().slice(0, 360)}</p>}</> : <><strong>{t('noPrdLinked')}</strong><p>{t('noPrdLinkedHint')}</p></>}
        </section>
        {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
      </>}
      {kind === 'projectComparison' && <><p className={styles.inspectorHint}>{t('portfolioViewHint')}</p><button className={styles.fullButton} onClick={onCompareProjects}>{t('refreshQualityComparison')}</button><SourceList sources={node.data.sources} /></>}
      {kind === 'mockup' && <><label>{t('deliveryProject')}<select value={mockupProjectValue} onChange={(event) => { const project = mockupProjects.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ deliveryProjectRef: event.target.value, deliveryProjectName: project?.data.title || (event.target.value === 'draft:builderforce-launch' ? 'BuilderForce launch' : t('noProject')) }); }}><option value="draft:builderforce-launch">BuilderForce launch</option>{mockupProjects.filter((project) => (project.data.resourceId || project.id) !== 'draft:builderforce-launch').map((project) => <option key={project.id} value={project.data.resourceId || project.id}>{project.data.title}</option>)}<option value="">{t('noProject')}</option></select></label><label>{t('assignAgent')}<select value={mockupAgentValue} onChange={(event) => { const agent = mockupAgents.find((candidate) => (candidate.data.resourceId || candidate.id) === event.target.value); onChange({ mockupAgentRef: event.target.value, mockupAgentName: agent?.data.title || (event.target.value === 'web-analyst' ? 'Web Analyst' : t('unassigned')) }); }}><option value="campaign-strategist">Campaign Strategist</option>{mockupAgents.filter((agent) => (agent.data.resourceId || agent.id) !== 'campaign-strategist').map((agent) => <option key={agent.id} value={agent.data.resourceId || agent.id}>{agent.data.title}</option>)}<option value="web-analyst">Web Analyst</option><option value="">{t('unassigned')}</option></select></label><button className={styles.fullButton} onClick={onDeliverMockup}>{t('addToProjectAssign')}</button></>}
      {kind === 'mockupSet' && <><p className={styles.inspectorHint}>{t('mockupSetHint')}</p><button className={styles.fullButton} onClick={onExpandMockupSet}>{t('expandAllMockups')}</button><button className={styles.fullButton} onClick={onDeliverMockup}>{t('addToProjectAssign')}</button><SourceList sources={node.data.sources} /></>}
      {kind === 'evermind' && <EvermindInspector node={node} persistence={persistence} onAttach={onAttachEvermindProject} onExpand={onExpandEvermindPipeline} onTrain={onTrainEvermind} />}
      {kind === 'standup' && <><p className={styles.inspectorHint}>{t('standupHint')}</p><button className={styles.fullButton} onClick={onStartStandup}>{t('gatherStandup')}</button></>}
      {CREATIVE_GENERATOR_KINDS.has(kind) && <>
        <label>{t('creativeBrief')}<textarea rows={5} value={typeof node.data.prompt === 'string' ? node.data.prompt : typeof node.data.content === 'string' ? node.data.content : ''} onChange={(event) => onChange({ prompt: event.target.value, content: event.target.value })} placeholder={t('creativeBriefPlaceholder', { label: creationObjectDefinition(kind).label.toLowerCase() })} /></label>
        <label>{t('templateId')}<input value={typeof node.data.templateId === 'string' ? node.data.templateId : ''} onChange={(event) => onChange({ templateId: event.target.value })} placeholder={kind === 'template' ? t('browseWithBrain') : t('optionalTemplate')} /></label>
        <label>{t('outputFormat')}<select value={typeof node.data.outputFormat === 'string' ? node.data.outputFormat : ''} onChange={(event) => onChange({ outputFormat: event.target.value })}><option value="">{t('chooseOnExport')}</option>{(CREATIVE_OUTPUTS[kind] || []).map((format) => <option key={format} value={format}>{format}</option>)}</select></label>
        <section className={styles.taskPrdSummary} aria-label={t('nativeCreativeCapability')}><div><span>{t('creativeCapability')}</span><small>{typeof node.data.provider === 'string' ? node.data.provider : 'native'}</small></div><strong>{typeof node.data.capabilityId === 'string' ? node.data.capabilityId : `creative.${kind}`}</strong><p>{t('creativeCapabilityHint')}</p></section>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type="button" className={styles.fullButton} onClick={() => onRunCreativeAction(kind === 'template' ? 'apply' : 'generate')}>{kind === 'template' ? t('applyTemplate') : t('generateLabel', { label: creationObjectDefinition(kind).label })}</button>{typeof node.data.outputUrl === 'string' && <><button type="button" onClick={() => onRunCreativeAction('preview')}>{t('preview')}</button><button type="button" onClick={() => onRunCreativeAction('export')}>{t('download')}</button></>}</div>
      </>}
      {kind === 'frame' && <><label>{t('purpose')}<input value={typeof node.data.framePurpose === 'string' ? node.data.framePurpose : t('arrangeObjectsHere')} onChange={(event) => onChange({ framePurpose: event.target.value })} /></label><label>{t('fillColor')}<input type="color" value={typeof node.data.frameColor === 'string' ? node.data.frameColor : '#f8f6ff'} onChange={(event) => onChange({ frameColor: event.target.value })} /></label><label>{t('borderColor')}<input type="color" value={typeof node.data.frameBorder === 'string' ? node.data.frameBorder : '#9d8bea'} onChange={(event) => onChange({ frameBorder: event.target.value })} /></label><button className={styles.fullButton} onClick={onSaveFramePreset}>{t('saveReusableFrame')}</button></>}
      {kind === 'drawing' && <><label>{t('strokeColor')}<input type="color" value={typeof node.data.stroke === 'string' ? node.data.stroke : '#5b5ce2'} onChange={(event) => onChange({ stroke: event.target.value })} /></label><label>{t('strokeWidth')}<input type="range" min="1" max="12" value={typeof node.data.strokeWidth === 'number' ? node.data.strokeWidth : 3} onChange={(event) => onChange({ strokeWidth: Number(event.target.value) })} /></label><p className={styles.inspectorHint}>{t('drawingHint')}</p></>}
      {DOCUMENT_EDITOR_KINDS.has(kind) && <label>{kind === 'slides' ? t('deckOutline') : t('documentBody')}<textarea
        rows={12}
        aria-label={kind === 'slides' ? t('deckOutline') : t('documentBody')}
        value={typeof node.data.markdown === 'string' ? node.data.markdown : typeof node.data.content === 'string' ? node.data.content : ''}
        placeholder={kind === 'slides' ? t('deckOutlinePlaceholder') : t('documentBodyPlaceholder')}
        onChange={(event) => onChange({ markdown: event.target.value, content: event.target.value })}
      /></label>}
      {kind === 'diagram' && <>
        <label>{t('diagramFormat')}<select value={typeof node.data.diagramFormat === 'string' ? node.data.diagramFormat : 'drawio'} onChange={(event) => onChange({ diagramFormat: event.target.value })}>
          <option value="drawio">{t('diagramFormatDrawio')}</option>
          <option value="mermaid">{t('diagramFormatMermaid')}</option>
        </select></label>
        <label>{t('diagramSource')}<textarea
          rows={12}
          aria-label={t('diagramSource')}
          value={typeof node.data.diagram === 'string' ? node.data.diagram : typeof node.data.content === 'string' ? node.data.content : ''}
          placeholder={t('diagramSourcePlaceholder')}
          onChange={(event) => onChange({ diagram: event.target.value, content: event.target.value })}
        /></label>
      </>}
      {!['chat', 'agent', 'evaluation', 'staff', 'website', 'prototype', 'workflow', 'dashboard', 'dataset', 'voice', 'project', 'task', 'mockup', 'evermind', 'standup', 'frame', 'drawing', 'diagram'].includes(kind) && !DOCUMENT_EDITOR_KINDS.has(kind) && !CREATIVE_GENERATOR_KINDS.has(kind) && <p className={styles.inspectorHint}>{t('objectLiveHint')}</p>}
      </fieldset> : <ActivityInspector sessionId={sessionId} objectId={node.id} persistence={persistence} role={role} members={members} />}
      {tab === 'details' && <section aria-label={t('copyAndDownload')} style={{ display: 'grid', gap: 7, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <strong style={{ fontSize: 12 }}>{t('copyAndDownload')}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(kind === 'chat' || kind === 'code' || kind === 'note' || kind === 'report' || kind === 'document' || kind === 'slides' || kind === 'knowledge' || kind === 'diagram' || kind === 'prd') && <button type="button" onClick={() => void runArtifactAction('copy')}>{t('copy')}</button>}
          {(kind === 'chat' || kind === 'code' || kind === 'note' || kind === 'report' || kind === 'document' || kind === 'slides' || kind === 'knowledge' || kind === 'prd') && <button type="button" onClick={() => void runArtifactAction('markdown')}>{t('downloadMarkdown')}</button>}
          {(kind === 'dataset' || kind === 'spreadsheet' || kind === 'table') && <button type="button" onClick={() => void runArtifactAction('csv')}>{t('downloadCsv')}</button>}
          {(kind === 'document' || kind === 'knowledge' || kind === 'prd' || kind === 'report') && <button type="button" onClick={() => void runArtifactAction('docx')}>{t('downloadWord')}</button>}
          {kind === 'slides' && <button type="button" onClick={() => void runArtifactAction('pptx')}>{t('downloadPowerPoint')}</button>}
          {kind === 'diagram' && <button type="button" onClick={() => void runArtifactAction('diagram')}>{t('downloadDiagram')}</button>}
          {(kind === 'dashboard' || kind === 'chart' || kind === 'evaluation' || kind === 'featureSummary' || kind === 'projectComparison') && <button type="button" onClick={() => void runArtifactAction('json')}>{t('downloadData')}</button>}
        </div>
        {actionStatus && <small role="status" className={styles.inspectorHint}>{actionStatus}</small>}
      </section>}
      {tab === 'details' && deliverables.length > 0 && <section aria-label={t('deliverables')} style={{ display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}><strong style={{ fontSize: 12 }}>{t('deliveredOutputs')}</strong>{deliverables.slice(0, 6).map((deliverable) => <div key={deliverable.id} style={{ display: 'grid', gap: 2, fontSize: 12 }}><span><b>{deliverable.artifactKind}</b> · {deliverable.status}</span><small>{deliverable.provider || 'Builderforce'} · {new Date(deliverable.completedAt || deliverable.createdAt).toLocaleString()}</small>{deliverable.url && !deliverable.url.startsWith('data:') && <a href={deliverable.url} target="_blank" rel="noreferrer">{t('openDeliverable')}</a>}{deliverable.error && <small style={{ color: 'var(--text-error, #c0392b)' }}>{deliverable.error}</small>}</div>)}</section>}
    </div>
    <footer><span>{t('resourceRole', { role })}</span><code>{node.data.resourceId || `session:${node.id}`}</code><button className={styles.fullButton} disabled={!editable} onClick={() => kind === 'task' ? setActionStatus(t('taskDetailsSaved')) : onChange({ status: 'Saved' })}>{kind === 'task' ? t('saveTaskDetails') : t('saveChanges')}</button></footer>
  </aside>;
}

/**
 * Column-level shape of an imported dataset. This is what tells a user whether
 * the column they want to analyze actually survived the import, and it is the
 * same profile Brain reads before it queries.
 */
function DatasetProfileSummary({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas');
  const profile = Array.isArray(data.profile) ? data.profile as Array<Record<string, unknown>> : [];
  const rowCount = Number(data.rowCount) || (Array.isArray(data.rows) ? data.rows.length : 0);
  if (!profile.length) return <p className={styles.inspectorHint}>{rowCount ? t('datasetProfilePending') : t('datasetProfileEmpty')}</p>;
  return <section className={styles.datasetProfile} aria-label={t('datasetProfileLabel')}>
    <div className={styles.datasetProfileHead}><strong>{t('datasetProfileLabel')}</strong><span>{t('dataGridShape', { rows: rowCount.toLocaleString(), columns: profile.length })}</span></div>
    <div className={styles.datasetProfileList}>
      {profile.slice(0, 40).map((column, index) => {
        const filled = Number(column.filled) || 0;
        const coverage = rowCount ? Math.round(filled / rowCount * 100) : 0;
        const top = Array.isArray(column.topValues) ? column.topValues as Array<Record<string, unknown>> : [];
        return <article key={`${String(column.name)}-${index}`}>
          <div><b>{String(column.name)}</b><small>{t(`datasetColumnType_${String(column.type)}` as 'datasetColumnType_text')}</small></div>
          <p>{t('datasetColumnCoverage', { coverage, distinct: Number(column.distinct) || 0 })}</p>
          {column.type === 'number' && column.min != null
            ? <small>{t('datasetColumnRange', { min: String(column.min), max: String(column.max), sum: String(column.sum ?? 0) })}</small>
            : top.length ? <small>{top.slice(0, 3).map((value) => `${String(value.value)} (${Number(value.count) || 0})`).join(' · ')}</small> : null}
        </article>;
      })}
    </div>
  </section>;
}

function SourceList({ sources }: { sources: unknown }) {
  const t = useTranslations('creationCanvas');
  if (!Array.isArray(sources) || !sources.length) return null;
  return <div className={styles.sourceList}><strong>{t('evidenceSources')}</strong>{sources.map((source, index) => { const item = source as { label?: string; resource?: string }; return <div key={`${item.resource}-${index}`}><span>{index + 1}</span><p><b>{item.label || t('source')}</b><code>{item.resource || t('canonicalApi')}</code></p></div>; })}</div>;
}

function CanvasVoiceInspector({ node, persistence, onChange }: { node: CreationFlowNode; persistence: 'local' | 'server'; onChange: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas');
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
    recognition.onerror = () => onChange({ status: t('voiceTranscriptionFailed') });
    recognition.onend = null;
    recognition.start();
  };

  if (persistence === 'local') return <p className={styles.inspectorHint}>{t('voiceLocalHint')}</p>;
  return <div className={styles.canvasVoiceStudio}>
    <button type="button" className={styles.fullButton} onClick={dictate}>{t('dictateScript')}</button>
    <VoiceConfigPanel voice={voice} />
    <button type="button" className={styles.fullButton} disabled={voice.busy || !voice.selectedCloneId || !voice.text.trim()} onClick={() => { onChange({ voiceScript: voice.text, voiceTranscript: voice.text, status: t('generatingVoiceStatus') }); void voice.synth(); }}>{voice.busy ? t('generating') : t('generateVoice')}</button>
    <div className={styles.canvasVoiceOutput}><VoiceOutput result={voice.result} audioUrl={voice.audioUrl} busy={voice.busy} unavailable={voice.unavailable} /></div>
  </div>;
}

function EvermindInspector({ node, persistence, onAttach, onExpand, onTrain }: { node: CreationFlowNode; persistence: 'local' | 'server'; onAttach: () => void; onExpand: () => void; onTrain: () => void }) {
  const t = useTranslations('creationCanvas');
  const rawProjectId = node.data.resourceId?.startsWith('evermind:') ? node.data.resourceId.slice('evermind:'.length) : '';
  const projectId = /^\d+$/.test(rawProjectId) ? Number(rawProjectId) : null;
  return <>
    <div className={styles.evermindStartGuide}><span>{node.data.pipelineExpanded === true ? t('guidedSetupAdded') : t('newModel')}</span><strong>{node.data.pipelineExpanded === true ? t('continueFromStep1') : t('startWithExamples')}</strong><p>{node.data.pipelineExpanded === true ? t('guidedSetupAddedHint') : t('guidedSetupHint')}</p></div>
    <button className={styles.fullButton} onClick={onExpand}>{node.data.pipelineExpanded === true ? t('goToStep1') : t('startGuidedSetup')}</button>
    <button className={styles.fullButton} onClick={onTrain}>{t('trainLoraAdapter')}</button>
    {persistence === 'local' && <p className={styles.inspectorHint}>{t('blueprintNoAccountHint')}</p>}
    {persistence === 'server' && projectId == null && <button className={styles.fullButton} onClick={onAttach}>{t('useProjectOnCanvas')}</button>}
    {persistence === 'server' && projectId != null && <div className={styles.evermindConsoleHost}><EvermindValidationProvider><ProjectEvermindPanel projectId={projectId} /></EvermindValidationProvider></div>}
  </>;
}

function ActivityInspector({ sessionId, objectId, persistence, role, members }: { sessionId: string; objectId: string; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; members: Array<{ userId: string; displayName: string | null; role: string }> }) {
  const t = useTranslations('creationCanvas');
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
      .catch((error) => setStatus(error instanceof Error ? error.message : t('commentUpdateFailed')));
  };

  if (persistence === 'local') return <div className={styles.activityEmpty}><strong>{t('collaborationStartsOnSave')}</strong><p>{t('collaborationStartsHint')}</p></div>;

  return <div className={styles.activityPanel}>
    <section className={styles.commentComposer}>
      <label>{t('commentOnObject')}<textarea rows={3} value={draft} disabled={!canComment} onChange={(event) => setDraft(event.target.value)} placeholder={canComment ? t('commentPlaceholder') : t('viewOnlyAccess')} /></label>
      <button className={styles.fullButton} disabled={!canComment || !draft.trim()} onClick={submit}>{t('postComment')}</button>
    </section>
    {status && <p className={styles.inspectorHint}>{status}</p>}
    <section className={styles.commentList} aria-label={t('objectComments')}>
      {comments.map((comment) => <article key={comment.id} className={comment.resolvedAt ? styles.commentResolved : ''}>
        <header><b>{comment.authorName || t('collaborator')}</b><time>{new Date(comment.createdAt).toLocaleString()}</time></header>
        <p>{comment.body}</p>
        {canComment && <button onClick={() => resolve(comment)}>{comment.resolvedAt ? t('reopen') : t('resolve')}</button>}
      </article>)}
    </section>
    <section className={styles.activityList} aria-label={t('objectActivity')}>
      <h4>{t('recentActivity')}</h4>
      {activity.filter((item) => item.kind === 'event').map((item) => <div key={item.id}><span>•</span><p><b>{item.actorName || 'BuilderForce'}</b>{` ${item.type.replaceAll('.', ' ')}`}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
    </section>
  </div>;
}

export function CreationCanvas({ sessionId, persistence = 'server', initialFocusId, initialShareOpen, initialPresent }: { sessionId: string; persistence?: 'local' | 'server'; initialFocusId?: string | null; initialShareOpen?: boolean; initialPresent?: boolean }) {
  // The 3D scene publishes its view commands to the canvas rail rather than
  // carrying a toolbar of its own, so both live under one provider.
  return <ReactFlowProvider><Canvas3DControlsProvider><CanvasInner sessionId={sessionId} persistence={persistence} initialFocusId={initialFocusId} initialShareOpen={initialShareOpen} initialPresent={initialPresent} /></Canvas3DControlsProvider></ReactFlowProvider>;
}
