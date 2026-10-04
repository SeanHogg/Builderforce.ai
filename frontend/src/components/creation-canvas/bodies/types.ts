import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CreationNodeData } from '../types';

/**
 * THE ONE BODY CONTRACT.
 *
 * Every card body on the board — a sticky, a map, a pipeline, a game — receives
 * exactly this: which object it is drawing, and that object's data. Nothing else
 * arrives as a prop. What a body can DO to the board (edit itself, move a deal,
 * open its details, fly to another object) is read from {@link CreationNodeActions}
 * through `useCreationNodeActions()`, so a body takes only the actions it uses and
 * a new action is one field here rather than a new optional prop threaded through
 * every branch of `CreationNode`.
 */
export interface CreationBodyProps {
  id: string;
  data: CreationNodeData;
}

/**
 * What a card body can do to the board, already bound to the object it sits in.
 *
 * Every field is ABSENT — not a no-op — when the board does not allow it (read-only,
 * lock-blocked, no workspace behind it). That absence is the signal a body renders
 * from: an editing control is never drawn where it would do nothing.
 */
export interface CreationNodeActions {
  /** Direct edits made on the card itself — a spreadsheet cell, a renamed column, a
   *  rewritten paragraph — written back through the same path the inspector uses. */
  edit?: (patch: Partial<CreationNodeData>) => void;
  /** Patch ANY object by id — a calendar card editing an event it projects from
   *  another object on the board. Present exactly when `edit` is. */
  editObject?: (nodeId: string, patch: Partial<CreationNodeData>) => void;
  /** A deal dragged into another stage on a pipeline card. Moves the DEAL, not the
   *  card — see `onMoveDeal` on `CreationNode`. */
  moveDeal?: (dealId: number, stage: string) => void;
  /** Open the wide inspector, optionally at one of its sections. */
  openDetails?: (focus?: 'knowledge' | 'test' | 'evaluation' | 'delivery') => void;
  openBuiltinAgent?: (intent: 'execute' | 'diagnostics') => void;
  /** Open this object at full size, in one of the board's surfaces. */
  openSurface?: (surface: CanvasSurfaceId) => void;
  /** Put the reader in front of ANOTHER object — a drill-through to the object this
   *  one was derived from (a map marker → its source dataset). */
  revealObject?: (nodeId: string) => void;
  /** Show this frame's section on its own — a canvas within a canvas. */
  openFrame?: () => void;
}
