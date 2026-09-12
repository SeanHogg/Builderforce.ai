/*
 * No `'use client'` — mounted only inside the room, which is reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo, type ReactNode } from 'react';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { defaultRoomStationSpot, placeStationInRoom } from '@/lib/canvas/roomStations';
import { roomSpotKey } from '@/lib/canvas/roomSpots';
import { useRoomSpot } from '@/lib/canvas/useRoomSpot';
import { RoomItemCaption, type RoomItemOpen } from '../world3d/RoomItemCaption';
import { SurfacePanel } from '../world3d/SurfacePanel';
import { useRoomItemDrag } from '../world3d/useRoomItemDrag';

/**
 * ONE STATION, STANDING IN THE ROOM — a board on a post, turned to face the table.
 *
 * Presentational: it is handed what its face shows and how its caption opens, and owns
 * only its place — dragged like a creation (`useRoomItemDrag`), remembered per viewer
 * (`useRoomSpot`) under its own key, so moving the desk to the wall survives a reload.
 * The face is `SurfacePanel`, the one thing that puts content on a face in 3D; a
 * station's content is live DOM rather than a picture, which is `SurfacePanel`'s
 * `content`.
 */

const BOARD_WIDTH = 1.5;
const BOARD_HEIGHT = 1.0;
const FRAME_PAD = 0.08;
/** A floor stand lifts the board's lower edge to a seated person's eye line. */
const POST_HEIGHT = { floor: 0.82, table: 0.05 } as const;
/** The face is laid out at this many CSS pixels across — see `SurfacePanel`. */
export const ROOM_STATION_FACE_PIXELS = 420;
const CAPTION_GAP = 0.3;

export interface RoomStationStandProps {
  sessionId: string;
  stationKey: string;
  /** Its place in the room's own order — where it stands until somebody moves it. */
  index: number;
  palette: RoomPalette;
  title: string;
  hint: string;
  face: ReactNode;
  open: RoomItemOpen;
  onDragChange: (dragging: boolean) => void;
}

export function RoomStationStand({ sessionId, stationKey, index, palette, title, hint, face, open, onDragChange }: RoomStationStandProps) {
  const [spot, place] = useRoomSpot(roomSpotKey(sessionId, `station:${stationKey}`), defaultRoomStationSpot(index));
  const placement = useMemo(() => placeStationInRoom(spot), [spot]);
  const drag = useRoomItemDrag(place, onDragChange);
  const [x, y, z] = placement.position;
  const onWall = placement.anchor === 'wall';
  const lift = placement.anchor === 'wall' ? 0 : POST_HEIGHT[placement.anchor];
  const centre = onWall ? 0 : lift + BOARD_HEIGHT / 2;

  return (
    <>
      <group position={placement.position} rotation={placement.rotation} {...drag}>
        {!onWall && (
          <>
            <mesh position={[0, 0.02, 0]} receiveShadow>
              <cylinderGeometry args={[0.3, 0.34, 0.04, 24]} />
              <meshStandardMaterial color={palette.table} />
            </mesh>
            <mesh position={[0, lift / 2, -0.04]} castShadow>
              <boxGeometry args={[0.08, lift, 0.08]} />
              <meshStandardMaterial color={palette.table} />
            </mesh>
          </>
        )}
        <group position={[0, centre, 0]}>
          <mesh position={[0, 0, -0.03]} castShadow receiveShadow>
            <boxGeometry args={[BOARD_WIDTH + FRAME_PAD, BOARD_HEIGHT + FRAME_PAD, 0.04]} />
            <meshStandardMaterial color={palette.panel} />
          </mesh>
          <SurfacePanel
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            color={palette.card}
            content={{ node: face, pixelWidth: ROOM_STATION_FACE_PIXELS }}
          />
        </group>
      </group>
      <RoomItemCaption
        position={[x, y + (onWall ? BOARD_HEIGHT / 2 : lift + BOARD_HEIGHT) + CAPTION_GAP, z]}
        title={title}
        hint={hint}
        testId="room-station-caption"
        open={open}
      />
    </>
  );
}
