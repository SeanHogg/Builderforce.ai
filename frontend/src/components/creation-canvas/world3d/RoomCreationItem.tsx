/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo, type ReactNode } from 'react';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import {
  ROOM_MODEL_SIZE, defaultRoomCreationSpot, placeCreationInRoom, type RoomCreation,
} from '@/lib/canvas/roomCreations';
import { roomSpotKey } from '@/lib/canvas/roomSpots';
import { useRoomSpot } from '@/lib/canvas/useRoomSpot';
import { RoomItemCaption, type RoomItemOpen } from './RoomItemCaption';
import { RoomMeshModel } from './RoomMeshModel';
import { SurfacePanel } from './SurfacePanel';
import { useRoomItemDrag } from './useRoomItemDrag';

/**
 * ONE 3D CREATION, STANDING IN THE ROOM — a game, a world, an AI scene or a model.
 *
 * It is a thing on a stand, not a card: a model is drawn as its own geometry, so
 * orbiting the room turns it; everything else shows the picture of what it produced,
 * standing up to face the table. It is dragged exactly the way the session is
 * (`useRoomItemDrag`) and remembers where THIS viewer left it (`useRoomSpot`), so it
 * owns its own place and needs nothing from the room but the palette.
 *
 * On the floor it stands on a plinth tall enough to meet a seated person's eye; on
 * the table it needs only a base; against the back wall it hangs in a frame.
 */

const PLINTH_RADIUS = 0.42;
/** A floor stand brings the work up to where a seated person looks; a table needs only a base. */
const PLINTH_HEIGHT = { floor: 0.62, table: 0.05 } as const;
const PANEL_WIDTH = 1.0;
const PANEL_HEIGHT = 0.72;
const FRAME_PAD = 0.08;
const CAPTION_GAP = 0.3;

export interface RoomCreationItemProps {
  sessionId: string;
  creation: RoomCreation;
  /** Its place in the room's own order — where it stands until somebody moves it. */
  index: number;
  palette: RoomPalette;
  /** Translated by the host. */
  title: string;
  hint: string;
  /** Absent when the room itself is this creation's view (a model). */
  open?: RoomItemOpen | undefined;
  /** Reported so the room can hold the camera still while the creation travels. */
  onDragChange: (dragging: boolean) => void;
}

export function RoomCreationItem({ sessionId, creation, index, palette, title, hint, open, onDragChange }: RoomCreationItemProps) {
  const [spot, place] = useRoomSpot(roomSpotKey(sessionId, creation.id), defaultRoomCreationSpot(index));
  const placement = useMemo(() => placeCreationInRoom(spot), [spot]);
  const drag = useRoomItemDrag(place, onDragChange);
  const face = creation.accent ?? palette.card;

  // Base at y = 0 either way, so the stand below and the frame on the wall place it
  // with one number.
  const picture = (
    <group position={[0, PANEL_HEIGHT / 2, 0]}>
      <SurfacePanel width={PANEL_WIDTH} height={PANEL_HEIGHT} color={face} imageUrl={creation.preview} fit="contain" />
    </group>
  );
  const shown: { height: number; body: ReactNode } = creation.geometry
    ? {
      height: ROOM_MODEL_SIZE,
      body: <RoomMeshModel url={creation.geometry.url} format={creation.geometry.format} color={face} fallback={picture} />,
    }
    : { height: PANEL_HEIGHT, body: picture };

  const [x, y, z] = placement.position;
  const caption = (lift: number) => (
    <RoomItemCaption position={[x, y + lift, z]} title={title} hint={hint} testId="room-creation-caption" open={open} />
  );

  if (placement.anchor === 'wall') {
    return (
      <>
        <group position={placement.position} rotation={placement.rotation} {...drag}>
          <mesh position={[0, 0, -0.02]} castShadow receiveShadow>
            <boxGeometry args={[PANEL_WIDTH + FRAME_PAD, Math.max(PANEL_HEIGHT, shown.height) + FRAME_PAD, 0.03]} />
            <meshStandardMaterial color={palette.panel} />
          </mesh>
          <group position={[0, -shown.height / 2, 0.06]}>{shown.body}</group>
        </group>
        {caption(shown.height / 2 + CAPTION_GAP)}
      </>
    );
  }

  const plinth = PLINTH_HEIGHT[placement.anchor];
  return (
    <>
      <group position={placement.position} rotation={placement.rotation} {...drag}>
        <mesh position={[0, plinth / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[PLINTH_RADIUS, PLINTH_RADIUS * 1.08, plinth, 28]} />
          <meshStandardMaterial color={palette.table} />
        </mesh>
        <group position={[0, plinth + 0.01, 0]}>{shown.body}</group>
      </group>
      {caption(plinth + shown.height + CAPTION_GAP)}
    </>
  );
}
