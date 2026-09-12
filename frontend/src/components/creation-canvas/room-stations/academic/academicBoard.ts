import { useMemo } from 'react';
import { makeSpecDeriveBoard } from '@/lib/specObjects';
import { useCanvasBoardBridge } from '../../canvasBoardBridge';

/** One board object as the academic engines read it. */
export interface AcademicNode {
  id: string;
  data: Record<string, unknown>;
}

/**
 * The board, as every academic station reads it — its objects unwrapped once and the
 * cross-object index (`makeSpecDeriveBoard`) built once, so four stations reading one
 * board do not each re-index it.
 *
 * `board` is null outside a canvas (a preview, a test without a board), and a station
 * renders nothing then. `staff` is whether this viewer may edit the board: the marks,
 * the integrity ledger and the accommodations behind an audit finding are what a
 * teacher sees, and a learner on a distributed board does not.
 */
export function useAcademicBoard() {
  const board = useCanvasBoardBridge();
  const objects = board?.objects;
  const nodes = useMemo<AcademicNode[]>(
    () => (objects ?? []).map((object) => ({ id: object.id, data: object.data as unknown as Record<string, unknown> })),
    [objects],
  );
  const specBoard = useMemo(() => makeSpecDeriveBoard(nodes.map((node) => node.data)), [nodes]);
  return { board, nodes, specBoard, staff: board?.edits != null };
}

export const nodesOfKind = (nodes: readonly AcademicNode[], kind: string): AcademicNode[] =>
  nodes.filter((node) => node.data.kind === kind);

export const titleOf = (data: Readonly<Record<string, unknown>>): string =>
  (typeof data.title === 'string' ? data.title.trim() : '');
