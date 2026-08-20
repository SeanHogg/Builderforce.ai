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
  folder?: string;
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
  folder?: string;
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
      && ((entry as LocalCreationEntry).folder === undefined || typeof (entry as LocalCreationEntry).folder === 'string')
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
function indexLocalCreationSession(sessionId: string, title: string, updatedAt: string, folder?: string): void {
  const rest = readIndex().filter((entry) => entry.sessionId !== sessionId);
  writeIndex([{ sessionId, title, ...(folder ? { folder } : {}), updatedAt }, ...rest]);
}

/**
 * Every account-less canvas this browser holds, newest first.
 *
 * Self-healing on BOTH sides, because it has to work for drafts that already
 * exist in a real user's browser from before the index did:
 *   - any `builderforce:create:local-*` board with no index row is adopted;
 *   - any index row whose board is gone is dropped;
 *   - any `local-tool-*` board LEFT BEHIND by the build in which `/tools/<id>`
 *     mounted a whole canvas per diagnostic is deleted (see below).
 */
export function listLocalCreationSessions(): LocalCreationEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const indexed = new Map(readIndex().map((entry) => [entry.sessionId, entry]));
  const legacyToolBoards: string[] = [];

  try {
    for (let position = 0; position < localStorage.length; position += 1) {
      const key = localStorage.key(position);
      if (!key?.startsWith(`${STORAGE_PREFIX}${LOCAL_CREATION_PREFIX}`)) continue;
      const sessionId = key.slice(STORAGE_PREFIX.length);
      if (sessionId.startsWith(LOCAL_TOOL_CREATION_PREFIX)) { legacyToolBoards.push(key); continue; }
      if (indexed.has(sessionId)) continue;
      const snapshot = readLocalCreationSession(sessionId);
      if (snapshot) indexed.set(sessionId, { sessionId, title: snapshot.title, ...(snapshot.folder ? { folder: snapshot.folder } : {}), updatedAt: snapshot.updatedAt });
    }
  } catch {
    // Enumeration blocked (rare privacy modes) — the stored index still stands.
  }

  // A one-time cleanup, not a permanent guard. `/tools/<id>` is a reference page
  // now (PRD 21 §11.4.5) and nothing writes these any more — but a browser that
  // visited a tool URL under the old build still holds one board per diagnostic,
  // and left in place they would surface in the canvas switcher as boards the
  // person never created and be claimed into the tenant on the next sign-in.
  for (const key of legacyToolBoards) {
    try { localStorage.removeItem(key); } catch { /* private mode — nothing to purge */ }
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
  // NOTHING is pre-seeded from the WORDING of the prompt — not a website, not a
  // workflow, and not a dataset/dashboard pair.
  //
  // The website shell went first: it drew the same ecommerce fallback for every prompt
  // and then sat beside the object Brain actually authored. The keyword-matched
  // workflow and dataset/dashboard shells were the same mistake left standing, and the
  // dataset one was worse than decorative. A prompt containing "chart" or "report"
  // placed a `dataset` titled "Imported data" holding no rows, plus a `dashboard`
  // holding no widgets. Brain then read the board, found a dataset announcing itself as
  // imported data, called `canvas_query_dataset` on it, and got back "No dataset with
  // imported rows is on this canvas" — so the seed did not merely fail to help, it
  // FAILED THE TURN that would otherwise have authored the real objects, and left two
  // empty shells that look like output sitting there afterwards.
  //
  // Every object on a board is authored: by Brain through the AI tool contract (whose
  // `emptyShellProblem` gate rejects a dashboard with no widgets and a dataset with no
  // rows), from the palette, or from a template. A guess made by a regex over the
  // prompt is none of those, and it cannot carry data because at this moment there is
  // none to carry.
  const edges: Edge[] = [];
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
  indexLocalCreationSession(sessionId, snapshot.title, snapshot.updatedAt, snapshot.folder);
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
      folder: typeof parsed.folder === 'string' && parsed.folder.trim() ? parsed.folder.trim().slice(0, 120) : undefined,
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
    folder: prior?.folder,
    ...board,
    updatedAt: new Date().toISOString(),
  };
}

export function removeLocalCreationSession(sessionId: string): void {
  const key = creationStorageKey(sessionId);
  localStorage.removeItem(key);
  /**
   * Every SIDECAR keyed off this board goes with it — the checkpoint stack today
   * (`creationCheckpoints.ts`), whatever is stored beside a board next.
   *
   * Swept by prefix rather than by an explicit list of stores, for two reasons. A
   * sidecar that outlives its board is a permanent leak against the same tiny quota the
   * checkpoint store already has to shed against, and it would resurface attached to a
   * board it is not about if an id were ever reused. The alternative — importing each
   * store here to call its own clear — is also a cycle, since a store keyed off a board
   * has to import `creationStorageKey` from this module.
   */
  const prefix = `${key}:`;
  for (const stored of Object.keys(localStorage)) {
    if (stored.startsWith(prefix)) localStorage.removeItem(stored);
  }
  writeIndex(readIndex().filter((entry) => entry.sessionId !== sessionId));
}

/** Rename or file a browser-local session without duplicating snapshot logic in UI. */
export function updateLocalCreationSession(
  sessionId: string,
  patch: { title?: string; folder?: string | null },
): LocalCreationSnapshot | null {
  const current = readLocalCreationSession(sessionId);
  if (!current) return null;
  const title = patch.title === undefined ? current.title : patch.title.trim().slice(0, 80) || current.title;
  const folder = patch.folder === undefined ? current.folder : patch.folder?.trim().slice(0, 120) || undefined;
  const next = { ...current, title, folder, updatedAt: new Date().toISOString() };
  writeLocalCreationSession(sessionId, next);
  return next;
}

/** Fold source drafts into the target and remove the now-redundant sources. */
export function mergeLocalCreationSessions(targetSessionId: string, sourceSessionIds: string[]): LocalCreationSnapshot | null {
  const target = readLocalCreationSession(targetSessionId);
  if (!target) return null;
  const sources = sourceSessionIds
    .filter((id) => id !== targetSessionId)
    .map((id) => ({ id, snapshot: readLocalCreationSession(id) }))
    .filter((item): item is { id: string; snapshot: LocalCreationSnapshot } => item.snapshot !== null);
  if (!sources.length) return target;

  const nodes = [...target.nodes];
  const edges = [...target.edges];
  const timeline = [...(target.timeline ?? [])];
  for (const { snapshot } of sources) {
    const idMap = new Map(snapshot.nodes.map((node) => [node.id, crypto.randomUUID()]));
    nodes.push(...snapshot.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      position: { x: node.position.x + 120, y: node.position.y + 120 },
    })));
    edges.push(...snapshot.edges.flatMap((edge) => {
      const source = idMap.get(edge.source);
      const targetId = idMap.get(edge.target);
      return source && targetId ? [{ ...edge, id: crypto.randomUUID(), source, target: targetId }] : [];
    }));
    timeline.push(...(snapshot.timeline ?? []).map((message) => ({ ...message, clientMessageId: `merge:${crypto.randomUUID()}` })));
  }
  const merged = { ...target, nodes, edges, timeline, updatedAt: new Date().toISOString() };
  writeLocalCreationSession(targetSessionId, merged);
  sources.forEach(({ id }) => removeLocalCreationSession(id));
  return merged;
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
