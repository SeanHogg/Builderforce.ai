/** The board as ONE loop of a Brain turn sees it — the canvas snapshot the model reads. */
import type { Edge } from '@xyflow/react';
import { aiContextGate, boardInventory, scopeNote } from '@/lib/canvasContextSnapshot';
import { specBoardOf } from '../canvasNodeHelpers';
import { creationObjectDefinition } from '../creationObjectRegistry';
import { canvasNodeDimensions } from '../creationCanvasLayout';
import type { CreationFlowNode } from '../CreationNode';
import type { UseCanvasBrainTurnDeps } from '../hooks/useCanvasBrainTurn';

/** The scope facts a turn fixed when it began. */
export interface CanvasTurnScope {
  sessionId: string;
  scope: UseCanvasBrainTurnDeps['resolvedScopeMode'];
  selectedObjectIds: string[];
  scopedNodeIds: ReadonlySet<string>;
  /** The ids on the board when the turn began — anything else is this turn's own work. */
  startIds: ReadonlySet<string>;
}

/**
 * Serialize `board` (with its `connections`) as the model sees it for one loop of
 * the turn. Anything added since the turn began is in scope whatever the selection
 * was — it is this turn's own work.
 */
export function canvasTurnSnapshot(board: readonly CreationFlowNode[], connections: readonly Edge[], turn: CanvasTurnScope): string {
  const scoped = board.filter((node) => turn.scopedNodeIds.has(node.id) || !turn.startIds.has(node.id));
  const scopedIds = new Set(scoped.map((node) => node.id));
  // Restricted objects are stripped of DETAIL here and keep their inventory row —
  // see `aiContextGate` for why withholding is not the same as hiding.
  const aiGate = aiContextGate(scoped);
  return JSON.stringify({
    sessionId: turn.sessionId, scope: turn.scope, selectedObjectIds: turn.selectedObjectIds,
    // A scoped turn used to send ONLY the scoped objects, with nothing saying
    // the view was partial — so the model answered "that file is not anywhere
    // on the canvas" about a file that was on the canvas, and asked the user
    // to upload it again. The inventory is identity-only (cheap) and always
    // complete, so an absence claim is never available to be made.
    scopeNote: scopeNote(turn.scope, board.length, scoped.length),
    boardInventory: boardInventory(board, scopedIds),
    ...(aiGate.note ? { confidentialityNote: aiGate.note } : {}),
    objects: ((spec) => aiGate.visible.map((node) => { const definition = creationObjectDefinition(node.data.kind); const dimensions = canvasNodeDimensions(node); return { id: node.id, ...definition.contextAdapter(node.data, spec), mutableFields: definition.mutableFields, actions: definition.actions, position: node.position, ...dimensions, hidden: node.hidden === true, locked: node.data.placementLocked === true }; }))(specBoardOf(board)),
    connections: connections.filter((edge) => scopedIds.has(edge.source) && scopedIds.has(edge.target)).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.connectionKind, label: edge.label })),
  });
}
