/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo } from 'react';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { defaultRoomStationSpot, placeStationInRoom, roomStationItemId } from '@/lib/canvas/roomStations';
import { roomSpotKey } from '@/lib/canvas/roomSpots';
import { useRoomSpot } from '@/lib/canvas/useRoomSpot';
import { RoomItemCaption, type RoomItemOpen } from './RoomItemCaption';
import { SurfacePanel } from './SurfacePanel';
import { useRoomItemDrag } from './useRoomItemDrag';

/**
 * ONE STATION, STANDING IN THE ROOM — a kiosk a person walks up to.
 *
 * A post with a slanted face in the station's colour, and the caption over it that
 * names it and carries its Open. It is dragged exactly the way a creation is and
 * remembers where THIS viewer left it, so it owns its place and needs nothing from
 * the room but the palette. Against the back wall the face hangs flat; everywhere
 * else it stands on its post and turns to face the table (`placeStationInRoom`).
 *
 * The face is deliberately a colour, not a miniature of the panel: the panel is a
 * table of numbers that no texture could render legibly, and the caption's Open is
 * one press away from the real thing.
 */

const POST_HEIGHT = { floor: 1.02, table: 0.08 } as const;
const POST_WIDTH = 0.12;
const FACE_WIDTH = 0.92;
const FACE_HEIGHT = 0.62;
const FACE_TILT = -0.32;
const FRAME_PAD = 0.06;
const CAPTION_GAP = 0.34;

export interface RoomStationStandProps {
  sessionId: string;
  stationId: string;
  /** Its place in the stations' own order — where it stands until somebody moves it. */
  index: number;
  palette: RoomPalette;
  /** The face colour for the viewer's theme. */
  color: string;
  /** Translated by the host. */
  title: string;
  hint: string;
  open: RoomItemOpen;
  onDragChange: (dragging: boolean) => void;
}

export function RoomStationStand({ sessionId, stationId, index, palette, color, title, hint, open, onDragChange }: RoomStationStandProps) {
  const [spot, place] = useRoomSpot(roomSpotKey(sessionId, roomStationItemId(stationId)), defaultRoomStationSpot(index));
  const placement = useMemo(() => placeStationInRoom(spot), [spot]);
  const drag = useRoomItemDrag(place, onDragChange);
  const [x, y, z] = placement.position;

  const face = (
    <>
      <mesh position={[0, 0, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[FACE_WIDTH + FRAME_PAD, FACE_HEIGHT + FRAME_PAD, 0.03]} />
        <meshStandardMaterial color={palette.panel} />
      </mesh>
      <SurfacePanel width={FACE_WIDTH} height={FACE_HEIGHT} color={color} />
    </>
  );

  if (placement.anchor === 'wall') {
    return (
      <>
        <group position={placement.position} rotation={placement.rotation} {...drag}>{face}</group>
        <RoomItemCaption position={[x, y + FACE_HEIGHT / 2 + CAPTION_GAP, z]} title={title} hint={hint} testId="room-station-caption" open={open} />
      </>
    );
  }

  const post = POST_HEIGHT[placement.anchor];
  return (
    <>
      <group position={placement.position} rotation={placement.rotation} {...drag}>
        <mesh position={[0, post / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[POST_WIDTH, post, POST_WIDTH]} />
          <meshStandardMaterial color={palette.table} />
        </mesh>
        <group position={[0, post + FACE_HEIGHT / 2, 0]} rotation={[FACE_TILT, 0, 0]}>{face}</group>
      </group>
      <RoomItemCaption position={[x, y + post + FACE_HEIGHT + CAPTION_GAP, z]} title={title} hint={hint} testId="room-station-caption" open={open} />
    </>
  );
}
