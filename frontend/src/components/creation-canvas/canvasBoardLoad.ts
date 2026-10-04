import type { CreationFlowNode } from './CreationNode';
import type { Edge } from '@xyflow/react';
import { boardFromPersistedGraph, type RejectedCanvasObject } from '@/domains/canvas/domain/canvasBoard';
import type { CreationSessionDetail } from '@/lib/builderforceApi';

/**
 * What the board refused to load, gathered so the surface can SAY it.
 *
 * The old readers cast `object.kind as CreationObjectKind` unchecked, so a kind
 * this build's contract does not declare — a session written by a newer
 * deployment, a hand-edited row — became an object rendered as a blank card with
 * no error anywhere. That is precisely what the `declaredKind` invariant forbids
 * ("rejected at the boundary, never rendered as a blank card"), and it could not
 * be enforced while the reader was a private function in this file.
 *
 * The rejection is a NOTICE rather than a thrown error because one unreadable
 * object in a session of two hundred must not cost the user the other 199. It
 * rides on the RETURN VALUE rather than a module-level "last rejection", which
 * would be a second board's answer to the first board's question the moment two
 * of these mount — and this component mounts twice on a comparison surface.
 */
export type LoadedBoard = { nodes: CreationFlowNode[]; edges: Edge[]; rejected: RejectedCanvasObject[] };

export function flowFromSession(detail: CreationSessionDetail): LoadedBoard {
  const { board, rejected } = boardFromPersistedGraph(detail);
  return { ...board, rejected };
}

export function flowFromSnapshotGraph(graph: { objects: Array<{ id: string; kind: string; resourceType?: string | null; resourceId?: string | null; canvasData: Record<string, unknown>; content: Record<string, unknown> }>; connections: Array<{ id: string; sourceObjectId: string; targetObjectId: string; kind?: string; label?: string | null; metadata?: Record<string, unknown> }> }): LoadedBoard {
  const { board, rejected } = boardFromPersistedGraph(graph);
  return { ...board, rejected };
}

/** The distinct kinds a read refused, for the one sentence the user sees. */
export function rejectedObjectKinds(rejected: readonly RejectedCanvasObject[]): string {
  return [...new Set(rejected.map((object) => object.kind))].join(', ');
}
