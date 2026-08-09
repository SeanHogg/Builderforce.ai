import type { Edge } from '@xyflow/react';
import type { CreationFlowNode } from '@/components/creation-canvas/CreationNode';
import type { CreationGraphInput } from '@/lib/builderforceApi';
import { NEW_CHAT_MODE, normalizeChatMode, type ChatMode } from '@/lib/brain';

export const LOCAL_CREATION_PREFIX = 'local-';
const LOCAL_TOOL_CREATION_PREFIX = `${LOCAL_CREATION_PREFIX}tool-`;
const STORAGE_PREFIX = 'builderforce:create:';
/**
 * Index of every account-less canvas this browser holds.
 *
 * Without it a draft was reachable ONLY by already knowing its uuid: the board
 * was written to `builderforce:create:local-<uuid>` and registered nowhere, so
 * any hop that dropped `?next=` (an OAuth round trip, the workspace picker,
 * verifying email in a second tab) left real work in localStorage with no path
 * back to it. The index is what makes "what was I working on" answerable.
 */
const INDEX_KEY = `${STORAGE_PREFIX}index`;

export interface LocalCreationSnapshot {
  version: 1;
  title: string;
  initialPrompt?: string;
  /**
   * Conversation mode (0409) for a canvas that has nowhere on the server to keep it.
   * A guest picks this in the composer BEFORE the canvas exists — on the homepage —
   * so without it the choice was made and then silently dropped at the hand-off.
   */
  mode?: ChatMode;
  timeline?: Array<{ clientMessageId: string; role: 'user' | 'assistant' | 'system'; body: string; metadata?: { scope?: string; objectIds?: string[]; model?: string; error?: boolean; authoredBy?: { kind: 'agent' | 'brain' | 'human'; ref: string; name: string } }; createdAt: string }>;
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

/** One row of the local-draft index: enough to list and open a draft without
 *  parsing every stored board. */
export interface LocalCreationEntry {
  sessionId: string;
  title: string;
  updatedAt: string;
}

function readIndex(): LocalCreationEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is LocalCreationEntry =>
      !!entry && typeof entry === 'object'
      && typeof (entry as LocalCreationEntry).sessionId === 'string'
      && typeof (entry as LocalCreationEntry).title === 'string'
      && typeof (entry as LocalCreationEntry).updatedAt === 'string');
  } catch {
    return [];
  }
}

function writeIndex(entries: LocalCreationEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Private mode / quota. The board itself is the durable copy; the index is a
    // convenience that {@link listLocalCreationSessions} can rebuild by scanning.
  }
}

/** Upsert one draft into the index, newest first. */
function indexLocalCreationSession(sessionId: string, title: string, updatedAt: string): void {
  const rest = readIndex().filter((entry) => entry.sessionId !== sessionId);
  // Catalog-tool canvases are URL-owned surfaces, not user-created drafts. If
  // they entered the draft index, ResumeWorkBridge would claim one into the
  // tenant on every signed-in visit and the canvas switcher would fill with
  // implementation-detail boards the user never created.
  if (sessionId.startsWith(LOCAL_TOOL_CREATION_PREFIX)) {
    writeIndex(rest);
    return;
  }
  writeIndex([{ sessionId, title, updatedAt }, ...rest]);
}

/**
 * Every account-less canvas this browser holds, newest first.
 *
 * Self-healing on BOTH sides, because it has to work for drafts that already
 * exist in a real user's browser from before the index did:
 *   - any `builderforce:create:local-*` board with no index row is adopted;
 *   - any index row whose board is gone is dropped.
 */
export function listLocalCreationSessions(): LocalCreationEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const indexed = new Map(readIndex().map((entry) => [entry.sessionId, entry]));

  try {
    for (let position = 0; position < localStorage.length; position += 1) {
      const key = localStorage.key(position);
      if (!key?.startsWith(`${STORAGE_PREFIX}${LOCAL_CREATION_PREFIX}`)) continue;
      const sessionId = key.slice(STORAGE_PREFIX.length);
      if (sessionId.startsWith(LOCAL_TOOL_CREATION_PREFIX)) continue;
      if (indexed.has(sessionId)) continue;
      const snapshot = readLocalCreationSession(sessionId);
      if (snapshot) indexed.set(sessionId, { sessionId, title: snapshot.title, updatedAt: snapshot.updatedAt });
    }
  } catch {
    // Enumeration blocked (rare privacy modes) — the stored index still stands.
  }

  const live = [...indexed.values()]
    .filter((entry) => !entry.sessionId.startsWith(LOCAL_TOOL_CREATION_PREFIX))
    .filter((entry) => localStorage.getItem(creationStorageKey(entry.sessionId)) != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  writeIndex(live);
  return live;
}

export function createLocalCreationSession(prompt: string, mode: ChatMode = NEW_CHAT_MODE): string {
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
  // Do not pre-seed Website/Prototype requests with an empty visual shell. The
  // old shell rendered the same ecommerce fallback for every prompt, then sat
  // beside the genuinely authored object Brain produced. Website creation now
  // enters through the AI tool contract, which rejects anything without real
  // WYSIWYG pages and sections.
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
    mode,
    timeline: prompt.trim() ? [{ clientMessageId: `initial:${crypto.randomUUID()}`, role: 'user', body: prompt.trim(), createdAt: now }] : [],
    updatedAt: now,
    nodes,
    edges,
  };
  writeLocalCreationSession(sessionId, snapshot);
  return sessionId;
}

/**
 * Open a catalog tool as a real canvas object while keeping the public tool URL.
 *
 * Tool canvases are stable per browser + tool. Reopening `/tools/<id>` therefore
 * returns to the answers and result already on the board instead of manufacturing
 * another disposable page (or another draft in the canvas switcher) per click.
 */
export function ensureLocalToolCreationSession(tool: { id: string; name: string; about: string; icon: string }): { sessionId: string; focusId: string } {
  const sessionId = `${LOCAL_TOOL_CREATION_PREFIX}${encodeURIComponent(tool.id)}`;
  const saved = readLocalCreationSession(sessionId);
  const existingTool = saved?.nodes.find((node) => node.data.toolId === tool.id);
  if (saved && existingTool) {
    // Rewriting through the canonical writer also removes an index row created
    // by an older build before tool canvases were excluded from the draft list.
    writeLocalCreationSession(sessionId, saved);
    return { sessionId, focusId: existingTool.id };
  }

  const now = new Date().toISOString();
  const focusId = `tool:${tool.id}`;
  writeLocalCreationSession(sessionId, {
    version: 1,
    title: tool.name,
    updatedAt: now,
    nodes: [{
      id: focusId,
      type: 'creation',
      position: { x: 120, y: 80 },
      style: { width: 760 },
      data: {
        kind: 'diagnostics',
        title: tool.name,
        subtitle: tool.about,
        toolId: tool.id,
        toolIcon: tool.icon,
        toolInput: {},
      },
    }],
    edges: [],
    viewport: { x: 36, y: 32, zoom: 0.9 },
  });
  return { sessionId, focusId };
}

/**
 * Persist a local (account-less) canvas. The ONE write — the canvas had this
 * `localStorage.setItem(storageKey, JSON.stringify(snapshot))` inlined at three
 * call sites, which is three chances for the stored shape to drift from what
 * {@link readLocalCreationSession} validates on the way back in.
 */
export function writeLocalCreationSession(sessionId: string, snapshot: LocalCreationSnapshot): void {
  try {
    localStorage.setItem(creationStorageKey(sessionId), JSON.stringify(snapshot));
  } catch {
    // Private mode / quota — the board stays live in memory for this page, and a
    // shared session still has the room as its durable copy.
    return;
  }
  // The index rides the ONE write, so a board can never exist unlisted.
  indexLocalCreationSession(sessionId, snapshot.title, snapshot.updatedAt);
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
      mode: normalizeChatMode(parsed.mode),
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

/**
 * Build the snapshot to write for a local canvas.
 *
 * The board (title, timeline, objects, connections, viewport) is what the canvas
 * holds; the prompt the session was created from and the mode a guest armed are
 * NOT — they live only in the stored snapshot. Three call sites hand-built this
 * object from the board alone and read `initialPrompt` back off the previous
 * snapshot by hand, which is three chances to forget the next carry-over field.
 * `mode` was exactly that field. One builder, so a new one cannot be dropped.
 */
export function localCreationSnapshot(
  sessionId: string,
  board: Pick<LocalCreationSnapshot, 'title' | 'timeline' | 'nodes' | 'edges' | 'viewport'>,
): LocalCreationSnapshot {
  const prior = readLocalCreationSession(sessionId);
  return {
    version: 1,
    initialPrompt: prior?.initialPrompt,
    mode: prior?.mode,
    ...board,
    updatedAt: new Date().toISOString(),
  };
}

export function removeLocalCreationSession(sessionId: string): void {
  localStorage.removeItem(creationStorageKey(sessionId));
  writeIndex(readIndex().filter((entry) => entry.sessionId !== sessionId));
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
