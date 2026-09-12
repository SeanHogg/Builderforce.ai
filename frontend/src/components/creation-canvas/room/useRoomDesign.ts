import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  defaultCanvasRoomDesign, isRoomLayoutId, roomLayoutDesign,
  type CanvasRoomDesign, type RoomLayoutId,
} from '@builderforce/creation-canvas-contract';
import { activeRoomDesign, roomDesignObjectsOf, type RoomDesignObject } from '@/lib/canvas/roomDesigns';
import { useCanvasBoardBridge } from '../canvasBoardBridge';

/** The standup room, built once: every session with no `room` object meets in it. */
const STANDUP_DESIGN = defaultCanvasRoomDesign();

export interface RoomDesignState {
  /** What the room draws — the active room object's design, or the standup room. */
  design: CanvasRoomDesign;
  rooms: readonly RoomDesignObject[];
  active: RoomDesignObject | null;
  /** Whether this viewer may change the room. Null edits on the board ⇒ false. */
  editable: boolean;
  /** Write a design to the active room, creating the room object if there is none. */
  change: (next: CanvasRoomDesign) => void;
  /** Start the active room over from a preset (or create one from it). */
  applyPreset: (layout: RoomLayoutId) => void;
  /** Meet in this room from now on. */
  choose: (roomId: string) => void;
}

/**
 * THE ROOM'S DESIGN, as the room surface reads and writes it.
 *
 * Read off the board through the bridge (`canvasBoardBridge.tsx`) — the same way the
 * stations read it — so the room needs no new prop from the canvas to know what room
 * it is, and every write goes through the board's own edit path: autosave, undo,
 * locks and Brain's view of the object all come for free. A viewer who cannot edit
 * the board gets `editable: false` and no-op writers, so the designer can hide itself
 * without anyone passing it a `canEdit`.
 */
export function useRoomDesign(): RoomDesignState {
  const t = useTranslations('creationCanvas.surface.room.design');
  const board = useCanvasBoardBridge();
  const objects = board?.objects;
  const edits = board?.edits ?? null;
  const rooms = useMemo(() => (objects ? roomDesignObjectsOf(objects) : []), [objects]);
  const active = useMemo(() => activeRoomDesign(rooms), [rooms]);

  const write = useCallback((next: CanvasRoomDesign, layout: string) => {
    if (!edits) return;
    if (active) {
      edits.patch(active.id, { roomDesign: next, roomLayout: layout });
      return;
    }
    edits.add('room', {
      // Named after what it is — "Boardroom", "Office kitchen" — until somebody renames it.
      title: t(`layout.${isRoomLayoutId(layout) ? layout : 'custom'}`),
      roomDesign: next,
      roomLayout: layout,
      activatedAt: new Date().toISOString(),
    });
  }, [active, edits, t]);

  const change = useCallback((next: CanvasRoomDesign) => write(next, next.layout), [write]);
  const applyPreset = useCallback((layout: RoomLayoutId) => write(roomLayoutDesign(layout), layout), [write]);
  const choose = useCallback((roomId: string) => {
    edits?.patch(roomId, { activatedAt: new Date().toISOString() });
  }, [edits]);

  return {
    design: active?.design ?? STANDUP_DESIGN,
    rooms,
    active,
    editable: !!edits,
    change,
    applyPreset,
    choose,
  };
}
