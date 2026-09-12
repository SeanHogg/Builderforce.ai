/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import type { CanvasRoomDesign, RoomFurniture } from '@builderforce/creation-canvas-contract';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import type { RoomSpot } from '@/lib/canvas/roomSpots';
import { RoomFurnitureMesh } from './RoomFurnitureMesh';
import { useRoomItemDrag } from './useRoomItemDrag';

/**
 * EVERY PIECE OF FURNITURE IN THE ROOM — and, while designing, the grip on each one.
 *
 * Outside the designer a piece is scenery. Inside it, every pointer on a piece picks
 * it up (and selects it), exactly the gesture that moves the session and a creation
 * (`useRoomItemDrag`): one way to move a thing in the room, whatever the thing is.
 * Where it lands is the contract's rule (`moveRoomFurniture`), applied by the
 * designer hook the handlers report to — this layer only reports.
 */

export interface RoomFurnitureDesigning {
  selectedId: string | null;
  /** A drag travelled to this floor point. */
  onMove: (id: string, spot: RoomSpot) => void;
  /** Picked up (`true`, which also selects it) or put down (`false`). */
  onGrip: (id: string, gripped: boolean) => void;
}

export interface RoomFurnitureLayerProps {
  design: CanvasRoomDesign;
  palette: RoomPalette;
  /** Absent: the furniture is scenery. */
  designing?: RoomFurnitureDesigning | undefined;
}

function DesignablePiece({ item, palette, designing }: { item: RoomFurniture; palette: RoomPalette; designing: RoomFurnitureDesigning }) {
  const drag = useRoomItemDrag(
    (spot) => designing.onMove(item.id, spot),
    (gripped) => designing.onGrip(item.id, gripped),
  );
  return (
    <group {...drag}>
      <RoomFurnitureMesh item={item} palette={palette} selected={designing.selectedId === item.id} />
    </group>
  );
}

export function RoomFurnitureLayer({ design, palette, designing }: RoomFurnitureLayerProps) {
  return (
    <>
      {design.furniture.map((item) => (designing
        ? <DesignablePiece key={item.id} item={item} palette={palette} designing={designing} />
        : <RoomFurnitureMesh key={item.id} item={item} palette={palette} />))}
    </>
  );
}
