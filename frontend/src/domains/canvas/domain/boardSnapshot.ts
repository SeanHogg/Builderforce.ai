/**
 * THE BOARD SNAPSHOT — the pure shaping, parsing and merging of a canvas board's
 * persisted shape, with no storage in it.
 *
 * Moved out of `infrastructure/localCanvasStore.ts` (studio-local-first design §6.5).
 * That module is `localStorage` with a schema on top; this one is the schema. The
 * four functions that used to read or write storage in the middle of their logic
 * (`createLocalCreationBoard`, `createLocalCreationSession`, `localCreationSnapshot`,
 * `mergeLocalCreationSessions`) are split here into their pure core, and the store
 * keeps a thin wrapper that does the I/O. The cores carry the old bodies verbatim.
 *
 * `localCanvasStore.ts` is deleted; its localStorage reader lives only in `legacyBoardImport.ts`.
 */

import type { Edge } from '@xyflow/react';
import { formatResourceRef } from '@builderforce/creation-canvas-contract';
import { NEW_CHAT_MODE, normalizeChatMode, type ChatMode } from '@/lib/brain';
import { STICKY_COLORS } from './authoredColors';
import type { CanvasObject } from './canvasObject';

export const LOCAL_CREATION_PREFIX = 'local-';

/** The key prefix of a board's device-side SIDECARS (checkpoints) in `localStorage`. */
const STORAGE_PREFIX = 'builderforce:create:';

/** The `localStorage` key a board's sidecar stores (`creationCheckpoints`) are filed under. */
export function creationStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

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
  nodes: CanvasObject[];
  edges: Edge[];
  viewport?: { x: number; y: number; zoom: number };
  updatedAt: string;
}

export function isLocalCreationSession(sessionId: string): boolean {
  return sessionId.startsWith(LOCAL_CREATION_PREFIX);
}

/**
 * The ONE reader for a stored board, independent of where the bytes came from.
 *
 * `localStorage` is one source; the shared room is the other, and the canvas used
 * to parse the room's copy with a bare `JSON.parse` plus an `Array.isArray` check
 * inlined in a callback. So a board arriving from a peer skipped every default,
 * every clamp and the timeline filter that the disk path applies — two readers
 * for one written shape, and the weaker one on the path where the writer is a
 * DIFFERENT BROWSER, possibly a different build.
 */
export function parseLocalCreationSnapshot(raw: string): LocalCreationSnapshot | null {
  try {
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
 * A local board seeded with NOTES — the Brain's `show_canvas` landing — as a
 * session id and snapshot. The caller writes it.
 *
 * The reasoning in `newLocalCreationSessionSnapshot` about NOT guessing objects from
 * a prompt does not apply here: these notes are not a guess, they are the content the
 * model was asked to produce and is handing over.
 */
export function newLocalCreationBoardSnapshot(input: { title?: string; text?: string; stickies: readonly string[] }): { sessionId: string; snapshot: LocalCreationSnapshot } {
  const sessionId = `${LOCAL_CREATION_PREFIX}${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const title = (input.title ?? '').trim().slice(0, 80) || 'Untitled board';
  const nodes: CanvasObject[] = [];
  let top = 140;
  const intro = (input.text ?? '').trim();
  if (intro) {
    nodes.push({
      id: crypto.randomUUID(), type: 'creation', position: { x: 120, y: top },
      data: { kind: 'note', title, subtitle: intro },
    });
    top += 200;
  }
  // Three to a row, which is what a wall of notes looks like before anybody moves them.
  input.stickies
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 60)
    .forEach((text, index) => {
      nodes.push({
        id: crypto.randomUUID(),
        type: 'creation',
        position: { x: 120 + (index % 3) * 220, y: top + Math.floor(index / 3) * 200 },
        // `title` IS a sticky's text — see `TITLE_IS_CONTENT_KINDS`.
        data: { kind: 'sticky', title: text, stickyColor: STICKY_COLORS[index % STICKY_COLORS.length] },
      });
    });
  return { sessionId, snapshot: { version: 1, title, updatedAt: now, nodes, edges: [] } };
}

/** The project a board is born tied to. */
export interface ProjectTie { id: number; name: string }

/**
 * The card that ties a board to a project: the same object the server makes when it creates a board
 * with `projectIds` (`kind: 'project'`, `project:<id>`), so a board made offline syncs as an ordinary
 * card and the server's tenant and access check (`validateResourceAccess`) is the one gate.
 */
export function projectCardObject(project: ProjectTie, index = 0): CanvasObject {
  return {
    id: crypto.randomUUID(),
    type: 'creation',
    position: { x: 120 + index * 360, y: 100 },
    style: { width: 300, height: 220 },
    data: { kind: 'project', title: project.name, resourceId: formatResourceRef('project', project.id) ?? undefined },
  };
}

/** A new local session from a prompt, as a session id and snapshot. The caller writes it. */
export function newLocalCreationSessionSnapshot(prompt: string, mode: ChatMode = NEW_CHAT_MODE, project?: ProjectTie): { sessionId: string; snapshot: LocalCreationSnapshot } {
  const sessionId = `${LOCAL_CREATION_PREFIX}${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const nodeId = crypto.randomUUID();
  const title = prompt.trim().slice(0, 80) || 'Untitled session';
  const nodes: CanvasObject[] = [{
    id: nodeId,
    type: 'creation',
    position: { x: 120, y: project ? 380 : 140 },
    data: { kind: 'chat', title: 'Brain', subtitle: prompt.trim() },
  }];
  if (project) nodes.unshift(projectCardObject(project));
  // NOTHING is pre-seeded from the WORDING of the prompt — not a website, not a
  // workflow, and not a dataset/dashboard pair. A guess made by a regex over the
  // prompt is not authored by Brain through the AI tool contract, the palette or a
  // template, and it cannot carry data because at this moment there is none to carry.
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
  return { sessionId, snapshot };
}

/**
 * The snapshot to write for a board, given the one it replaces.
 *
 * The board (title, timeline, objects, connections, viewport) is what the canvas
 * holds; the prompt the session was created from and the mode a guest armed are
 * NOT — they live only in the stored snapshot. One builder, so a new carry-over
 * field cannot be dropped by a hand-built call site.
 */
export function localCreationSnapshotFrom(
  prior: LocalCreationSnapshot | null,
  board: Pick<LocalCreationSnapshot, 'title' | 'timeline' | 'nodes' | 'edges' | 'viewport'>,
): LocalCreationSnapshot {
  return {
    version: 1,
    initialPrompt: prior?.initialPrompt,
    mode: prior?.mode,
    folder: prior?.folder,
    ...board,
    updatedAt: new Date().toISOString(),
  };
}

/** Fold source drafts into the target: the merged snapshot (ids re-minted so nothing collides). */
export function mergedLocalCreationSnapshot(target: LocalCreationSnapshot, sources: readonly LocalCreationSnapshot[]): LocalCreationSnapshot {
  const nodes = [...target.nodes];
  const edges = [...target.edges];
  const timeline = [...(target.timeline ?? [])];
  for (const snapshot of sources) {
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
  return { ...target, nodes, edges, timeline, updatedAt: new Date().toISOString() };
}
