import type { Edge } from '@xyflow/react';
import type { CreationFlowNode } from '@/components/creation-canvas/CreationNode';
import type { CreationGraphInput } from '@/lib/builderforceApi';

export const LOCAL_CREATION_PREFIX = 'local-';
const STORAGE_PREFIX = 'builderforce:create:';

export interface LocalCreationSnapshot {
  version: 1;
  title: string;
  initialPrompt?: string;
  timeline?: Array<{ clientMessageId: string; role: 'user' | 'assistant' | 'system'; body: string; createdAt: string }>;
  nodes: CreationFlowNode[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
  updatedAt: string;
}

export function creationStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function isLocalCreationSession(sessionId: string): boolean {
  return sessionId.startsWith(LOCAL_CREATION_PREFIX);
}

export function createLocalCreationSession(prompt: string): string {
  const sessionId = `${LOCAL_CREATION_PREFIX}${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const nodeId = crypto.randomUUID();
  const title = prompt.trim().slice(0, 80) || 'Untitled session';
  const nodes: CreationFlowNode[] = [{
    id: nodeId,
    type: 'creation',
    position: { x: 120, y: 140 },
    data: { kind: 'chat', title: 'Brain', subtitle: prompt.trim() },
  }];
  const edges: Edge[] = [];
  const lower = prompt.toLowerCase();
  const addIntent = (kind: CreationFlowNode['data']['kind'], title: string, x: number, y: number) => {
    const id = crypto.randomUUID();
    nodes.push({ id, type: 'creation', position: { x, y }, data: { kind, title, status: 'AI draft', subtitle: `Created from: ${prompt.trim()}` } });
    edges.push({ id: crypto.randomUUID(), source: nodeId, target: id, type: 'smoothstep', label: 'creates' });
    return id;
  };
  if (/website|landing page|web app|prototype/.test(lower)) addIntent('website', title, 570, 80);
  if (/workflow|campaign|automation|process/.test(lower)) addIntent('workflow', `${title} workflow`, 570, 390);
  if (/data|dataset|csv|spreadsheet|report|dashboard|chart/.test(lower)) {
    const datasetId = addIntent('dataset', 'Imported data', 570, 120);
    const dashboardId = crypto.randomUUID();
    nodes.push({ id: dashboardId, type: 'creation', position: { x: 1050, y: 120 }, data: { kind: 'dashboard', title: `${title} dashboard`, status: 'AI draft' } });
    edges.push({ id: crypto.randomUUID(), source: datasetId, target: dashboardId, type: 'smoothstep', label: 'visualizes' });
  }
  const snapshot: LocalCreationSnapshot = {
    version: 1,
    title,
    initialPrompt: prompt.trim(),
    timeline: prompt.trim() ? [{ clientMessageId: `initial:${crypto.randomUUID()}`, role: 'user', body: prompt.trim(), createdAt: now }] : [],
    updatedAt: now,
    nodes,
    edges,
  };
  localStorage.setItem(creationStorageKey(sessionId), JSON.stringify(snapshot));
  return sessionId;
}

export function readLocalCreationSession(sessionId: string): LocalCreationSnapshot | null {
  try {
    const raw = localStorage.getItem(creationStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalCreationSnapshot>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return {
      version: 1,
      title: typeof parsed.title === 'string' ? parsed.title : 'Untitled session',
      initialPrompt: typeof parsed.initialPrompt === 'string' ? parsed.initialPrompt : undefined,
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline.filter((message): message is NonNullable<LocalCreationSnapshot['timeline']>[number] => !!message && typeof message.clientMessageId === 'string' && (message.role === 'user' || message.role === 'assistant' || message.role === 'system') && typeof message.body === 'string' && typeof message.createdAt === 'string') : [],
      nodes: parsed.nodes,
      edges: parsed.edges,
      viewport: parsed.viewport && typeof parsed.viewport.x === 'number' && typeof parsed.viewport.y === 'number' && typeof parsed.viewport.zoom === 'number' ? parsed.viewport : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function removeLocalCreationSession(sessionId: string): void {
  localStorage.removeItem(creationStorageKey(sessionId));
}

export function creationGraphFromSnapshot(snapshot: Pick<LocalCreationSnapshot, 'nodes' | 'edges' | 'viewport'>): CreationGraphInput {
  return {
    objects: snapshot.nodes.map((node) => {
      const [resourceType, ...resourceParts] = (node.data.resourceId ?? '').split(':');
      return {
        id: node.id,
        kind: node.data.kind,
        resourceType: resourceParts.length ? resourceType : null,
        resourceId: resourceParts.length ? resourceParts.join(':') : null,
        canvasData: {
          x: node.position.x,
          y: node.position.y,
          ...(typeof node.measured?.width === 'number' ? { w: node.measured.width } : typeof node.width === 'number' ? { w: node.width } : typeof node.style?.width === 'number' ? { w: node.style.width } : {}),
          ...(typeof node.measured?.height === 'number' ? { h: node.measured.height } : typeof node.height === 'number' ? { h: node.height } : typeof node.style?.height === 'number' ? { h: node.style.height } : {}),
        },
        content: { ...node.data },
      };
    }),
    connections: snapshot.edges.map((edge) => ({
      id: edge.id,
      sourceObjectId: edge.source,
      targetObjectId: edge.target,
      kind: typeof edge.data?.connectionKind === 'string' ? edge.data.connectionKind : 'reference',
      label: typeof edge.label === 'string' ? edge.label : null,
      metadata: { animated: !!edge.animated, rendererType: typeof edge.type === 'string' ? edge.type : 'smoothstep' },
    })),
    ...(snapshot.viewport ? { viewport: snapshot.viewport } : {}),
  };
}
