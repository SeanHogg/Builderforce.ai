import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ROOM_FURNITURE_SPECS, addRoomFurniture, moveRoomFurniture, removeRoomFurniture, updateRoomFurniture,
  type CanvasRoomDesign, type RoomFurniture, type RoomFurnitureKind, type RoomFurnitureModel,
} from '@builderforce/creation-canvas-contract';
import { isTypingTarget } from '@/lib/keyboardTarget';
import type { RoomSpot } from '@/lib/canvas/roomSpots';
import type { RoomFurnitureDesigning } from '../world3d/RoomFurnitureLayer';

/** One press of the rotate key or button. */
export const ROTATE_STEP = Math.PI / 12;

export interface FurnitureDesigner {
  /** What to draw: the design, or the drag in flight over it. */
  shown: CanvasRoomDesign;
  selected: RoomFurniture | null;
  select: (id: string | null) => void;
  /** Handed to `RoomFurnitureLayer`. */
  designing: RoomFurnitureDesigning;
  add: (kind: RoomFurnitureKind, extra?: { imageUrl?: string; model?: RoomFurnitureModel }) => void;
  patchSelected: (patch: Partial<Omit<RoomFurniture, 'id' | 'kind'>>) => void;
  rotateSelected: (delta: number) => void;
  removeSelected: () => void;
}

/**
 * THE DESIGNER'S HANDS — selecting, dragging, adding, turning and removing furniture.
 *
 * ── WHY A DRAG IS A PREVIEW UNTIL IT IS PUT DOWN ─────────────────────────────
 * A drag reports sixty points a second. Written straight to the board, each one
 * would be an autosave, an undo step and a relay ping to every collaborator — a
 * sofa dragged across the room becoming three hundred edits. So a drag moves a
 * PREVIEW here, and only putting the piece down writes the design, once.
 *
 * Every rule about where a piece may be is the contract's (`moveRoomFurniture`,
 * `addRoomFurniture`), so the designer, Brain and the tests cannot disagree about
 * whether a screen belongs on the floor.
 */
export function useFurnitureDesigner(design: CanvasRoomDesign, commit: (next: CanvasRoomDesign) => void, enabled: boolean): FurnitureDesigner {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CanvasRoomDesign | null>(null);
  // Read by the put-down, which must commit what was DRAWN, not a stale closure.
  const previewRef = useRef<CanvasRoomDesign | null>(null);
  const designRef = useRef(design);
  useEffect(() => { designRef.current = design; }, [design]);

  // Outside the designer nothing is selected and nothing is in flight. Derived from
  // `enabled` rather than cleared by an effect, so no render draws a stale pick.
  const activeId = enabled ? selectedId : null;
  const shown = (enabled ? preview : null) ?? design;
  const selected = useMemo(() => shown.furniture.find((item) => item.id === activeId) ?? null, [shown, activeId]);

  const designing = useMemo<RoomFurnitureDesigning>(() => ({
    selectedId: activeId,
    onMove: (id: string, spot: RoomSpot) => {
      const next = moveRoomFurniture(previewRef.current ?? designRef.current, id, spot.x, spot.z);
      previewRef.current = next;
      setPreview(next);
    },
    onGrip: (id: string, gripped: boolean) => {
      // A new grip starts from the design, never from a drag the designer was left mid-way through.
      if (gripped) { previewRef.current = null; setPreview(null); setSelectedId(id); return; }
      const moved = previewRef.current;
      previewRef.current = null;
      setPreview(null);
      if (moved) commit(moved);
    },
  }), [activeId, commit]);

  const add = useCallback((kind: RoomFurnitureKind, extra: { imageUrl?: string; model?: RoomFurnitureModel } = {}) => {
    const current = designRef.current;
    const { design: withPiece, furniture } = addRoomFurniture(current, { kind, ...extra });
    // Put it down through the placement rule: a wall piece goes onto the back wall,
    // a floor piece in front of the table where the reader can see it arrive.
    const spec = ROOM_FURNITURE_SPECS[kind];
    const z = spec.wallMounted ? -current.floor.depth / 2 : Math.min(2, current.floor.depth / 2 - 1);
    commit(moveRoomFurniture(withPiece, furniture.id, 0, z));
    setSelectedId(furniture.id);
  }, [commit]);

  const patchSelected = useCallback((patch: Partial<Omit<RoomFurniture, 'id' | 'kind'>>) => {
    if (activeId) commit(updateRoomFurniture(designRef.current, activeId, patch));
  }, [activeId, commit]);

  const rotateSelected = useCallback((delta: number) => {
    const item = designRef.current.furniture.find((candidate) => candidate.id === activeId);
    if (item && !ROOM_FURNITURE_SPECS[item.kind].wallMounted) commit(updateRoomFurniture(designRef.current, item.id, { yaw: item.yaw + delta }));
  }, [activeId, commit]);

  const removeSelected = useCallback(() => {
    if (!activeId) return;
    commit(removeRoomFurniture(designRef.current, activeId));
    setSelectedId(null);
  }, [activeId, commit]);

  // Delete removes and R turns the selected piece — the board's own Delete, and the
  // rotate key every layout tool has. Never while somebody is typing into a field.
  useEffect(() => {
    if (!activeId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === 'Delete' || event.code === 'Backspace') { event.preventDefault(); removeSelected(); }
      else if (event.code === 'KeyR') rotateSelected(event.shiftKey ? -ROTATE_STEP : ROTATE_STEP);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, removeSelected, rotateSelected]);

  return { shown, selected, select: setSelectedId, designing, add, patchSelected, rotateSelected, removeSelected };
}
