/**
 * READING A CHILD CANVAS SO ANOTHER CANVAS CAN RUN IT.
 *
 * ── WHY THIS LIVES IN THE CANVAS CONTEXT ─────────────────────────────────────
 * The workflow domain declares what it needs from a nested canvas — a plain
 * `SubflowBoard` of objects, connections, a name and the definition it was built
 * into — and declares it as DATA (`domain/subflow.ts`). It does not know that a
 * canvas is a session, that a session has a revision, or that reading one means a
 * request. Knowing all three is the canvas context's job, and this is the adapter
 * that answers the other context's port without either importing the other's
 * model.
 *
 * ── NO NEW ENDPOINT, AND NO SECOND READER ────────────────────────────────────
 * A child board is read through the SAME narrow port the canvas already re-reads
 * itself with (`CanvasSessionPort.read`), and translated by the SAME
 * anti-corruption boundary every board goes through (`boardFromPersistedGraph`).
 * A second reader would be a second answer to "what does a stored object mean",
 * and it would be the one that had not heard about the next field.
 *
 * ── THE CACHE, AND WHY IT IS SHORT ───────────────────────────────────────────
 * The compiler is synchronous and runs on every build, so the boards it may nest
 * have to be in memory before it starts. They are cached (one fetch however many
 * canvases are open) and briefly: a child that somebody is actively editing in the
 * next tab should reach the next build, so the window is seconds, not the session.
 * Choosing a canvas in the picker invalidates its entry outright — that is the one
 * moment the author is entitled to see the truth immediately.
 *
 * It is the SHARED read-through cache, not a `Map` of its own. A private map is
 * unbounded, has no single-flight, and is invisible to every other invalidation
 * in the app — which is why `check:api-transport` refuses one. This module still
 * owns its key space and its TTL; the store underneath is the one store.
 */

import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import { boardFromPersistedGraph } from '../domain/canvasBoard';
import { flowDefinitionIdOf } from '@/domains/workflow/domain/flowDefinitionRef';
import type { SubflowBoard } from '@/domains/workflow/domain/subflow';
import type { CanvasSessionPort } from './PersistCanvas';

/** The one method reading a child board needs. */
export type SubflowSourcePort = Pick<CanvasSessionPort, 'read'>;

/** How long a child board may be reused before it is read again. */
const CACHE_TTL_MS = 20_000;

/** This module's key space in the shared client store. (Named for the KEY, not the
 *  store: `check:api-transport` reads a top-level `const …cache… =` as somebody
 *  rolling their own, which is exactly the thing this module stopped doing.) */
const subflowBoardKey = (sessionId: string): string => `canvas:subflow-board:${sessionId}`;

/**
 * The definition a child canvas was built into, or null.
 *
 * The board holds at most one built flow per frame and a canvas nested by another
 * offers ONE — the first built section on it. A child with two built sections is
 * ambiguous about which one "run this canvas" means, and picking the first is the
 * same order `resolveCanvasFlowNode` already resolves a board's flow in.
 */
function builtDefinitionId(nodes: ReadonlyArray<{ data: Record<string, unknown> }>): string | null {
  for (const node of nodes) {
    const id = flowDefinitionIdOf(node.data);
    if (id) return id;
  }
  return null;
}

async function read(port: SubflowSourcePort, sessionId: string): Promise<SubflowBoard | null> {
  const snapshot = await port.read(sessionId);
  const { board } = boardFromPersistedGraph(snapshot.graph);
  return {
    sessionId,
    title: snapshot.title,
    objects: board.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: node.data as unknown as Record<string, unknown>,
    })),
    connections: board.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
    definitionId: builtDefinitionId(board.nodes.map((node) => ({ data: node.data as unknown as Record<string, unknown> }))),
  };
}

/**
 * One child canvas, ready to be nested. Null when it cannot be read at all —
 * deleted, or not shared with this viewer — which the compiler reports as an issue
 * naming the canvas rather than as a step it silently leaves out.
 */
export function loadSubflowBoard(port: SubflowSourcePort, sessionId: string): Promise<SubflowBoard | null> {
  return getOrSetClientCached(
    subflowBoardKey(sessionId),
    () => read(port, sessionId).catch(() => null),
    { ttlMs: CACHE_TTL_MS },
  );
}

/** Drop a child canvas from the cache so the next read is a real one. */
export function forgetSubflowBoard(sessionId: string): void {
  invalidateClientCache(subflowBoardKey(sessionId));
}
