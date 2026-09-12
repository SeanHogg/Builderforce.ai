import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CanvasObject, CanvasObjectData, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import type { RoomOccupant } from '@/lib/canvas/roomSeating';
import type { CardActBoardBinding } from './cardActRunner';

/**
 * THE BOARD, AS A SURFACE THAT IS NOT THE BOARD READS AND EDITS IT.
 *
 * ── WHY THIS IS PUBLISHED AND NOT PASSED ─────────────────────────────────────
 * The room's stations (the approval desk, the metrics board, a widget on a stand)
 * and a third-party widget framed on a flat card all need the same three things: the
 * board's objects as they are now, who is looking, and a way to change an object that
 * is the SAME way a person's edit changes it. Threaded as props, each would be one
 * more entry on the room's list and one more on every card — the growth
 * `cardActRunner.tsx` describes, moved sideways. So the board publishes this ONCE,
 * beside the card-act runner, and a station or a widget host reads it.
 *
 * ── THE BOARD IS STILL EDITED THROUGH ITS OWN PATHS ──────────────────────────
 * `edits.patch` IS the canvas's `updateNodeData`, `edits.remove` IS `deleteObjects`
 * (locks and all), and `edits.add` is the card-act binding's factory — nothing here
 * reaches `setNodes` by a route the board did not already have. `edits` is null for a
 * viewer who cannot edit, so a consumer asks one question to know whether it may.
 */

export interface CanvasBoardViewer {
  userId: string;
  displayName: string;
}

export interface CanvasBoardEdits {
  patch: (objectId: string, patch: Partial<CanvasObjectData>) => void;
  /** Adds one object of `kind`, near `near` when given, and returns its id. */
  add: (kind: CreationObjectKind, fields: Partial<CanvasObjectData>, near?: { x: number; y: number }) => string;
  remove: (objectIds: readonly string[]) => void;
}

export interface CanvasBoardBridge {
  sessionId: string;
  title: string;
  /** `'local'` is a draft on this device — nothing a server resolves (a widget) can mount. */
  persistence: 'local' | 'server';
  objects: readonly CanvasObject[];
  /** The PERSON looking, or null when the board cannot say who that is. Never an agent. */
  viewer: CanvasBoardViewer | null;
  /** Null when this viewer may not edit the board. */
  edits: CanvasBoardEdits | null;
  /** The canvas's one notice line. */
  notice: (message: string) => void;
}

export interface CanvasBoardBridgeInput {
  sessionId: string;
  title: string;
  persistence: 'local' | 'server';
  objects: readonly CanvasObject[];
  /** The card-act binding — its factory and its node writer are the add path. */
  act: CardActBoardBinding;
  /** The board's own edit and delete paths, or null when this viewer cannot edit. */
  patch: ((objectId: string, patch: Partial<CanvasObjectData>) => void) | null;
  remove: ((objectIds: readonly string[]) => void) | null;
  /** Which roster row is the viewer, and the roster it is a row of. */
  selfId: string | null;
  occupants: readonly RoomOccupant[];
}

/** Build the bridge for one board. The board mounts it once and publishes it. */
export function useCanvasBoardBridgeFor(input: CanvasBoardBridgeInput): CanvasBoardBridge {
  const { sessionId, title, persistence, objects, act, patch, remove, selfId, occupants } = input;
  const viewer = useMemo<CanvasBoardViewer | null>(() => {
    const row = selfId ? occupants.find((occupant) => occupant.userId === selfId) : undefined;
    // An occupant with no kind is a person (`RoomOccupant`); an agent is never the viewer.
    if (!selfId || !row || row.kind === 'agent') return null;
    return { userId: selfId, displayName: row.displayName?.trim() || selfId };
  }, [occupants, selfId]);
  const edits = useMemo<CanvasBoardEdits | null>(() => (patch && remove ? {
    patch,
    remove,
    add: (kind, fields, near) => {
      const node = act.create(kind, near ?? { x: 0, y: 0 });
      const created: CanvasObject = { ...node, data: { ...node.data, ...fields } };
      act.setNodes((current) => [...current, created]);
      return created.id;
    },
  } : null), [act, patch, remove]);
  return useMemo(() => ({
    sessionId, title, persistence, objects, viewer, edits, notice: act.setNotice,
  }), [act.setNotice, edits, objects, persistence, sessionId, title, viewer]);
}

const CanvasBoardBridgeContext = createContext<CanvasBoardBridge | null>(null);

export function CanvasBoardBridgeProvider({ value, children }: { value: CanvasBoardBridge; children: ReactNode }) {
  return <CanvasBoardBridgeContext.Provider value={value}>{children}</CanvasBoardBridgeContext.Provider>;
}

/** The board, or null outside one (a preview, an embed, a test) — a consumer renders nothing then. */
export function useCanvasBoardBridge(): CanvasBoardBridge | null {
  return useContext(CanvasBoardBridgeContext);
}
