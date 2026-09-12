/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Canvas3DScene } from '@/lib/canvas/canvas3d';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { roomSessionDiorama, type RoomSessionPlacement, type RoomSessionSpot } from '@/lib/canvas/roomSession';
import { RoomItemCaption } from './RoomItemCaption';
import { SurfacePanel } from './SurfacePanel';
import { useRoomItemDrag } from './useRoomItemDrag';

/**
 * THE SESSION, IN THE ROOM — the board's depth projection, small enough to sit on
 * a table, that you drag to wherever you want it and open from its own button.
 *
 * ── WHAT IT IS, AND WHAT IT IS NOT ───────────────────────────────────────────
 * It is the same {@link Canvas3DScene} the full-size 3D view draws, at a distance:
 * the same layers, the same floating offsets, each card in its own colour with its
 * own picture. It is NOT a second layout of the board — `roomSessionDiorama` scales
 * the projection and this file turns metres into meshes, nothing more.
 *
 * ── WHY DRAG AND OPEN ARE TWO CONTROLS ───────────────────────────────────────
 * They were one gesture — press to open, travel to drag — and a press that had
 * wobbled a few pixels silently became a move. The item now carries its own OPEN
 * button, on the caption above it, and every pointer on the body is a drag. Two
 * things you can do, two things you can see. The drag and the caption are shared
 * with every creation standing in the room (`useRoomItemDrag`, `RoomItemCaption`).
 */

/** Extra plate around the sheet so the base reads as a base and not as a card. */
const PLATE_PAD = 0.08;

export interface RoomSessionDioramaProps {
  scene: Canvas3DScene;
  placement: RoomSessionPlacement;
  palette: RoomPalette;
  /** The caption over it. Translated by the host. */
  title: string;
  hint: string;
  /** The Open button's own label. Translated by the host. */
  openLabel: string;
  onPlace: (spot: RoomSessionSpot) => void;
  onOpen: () => void;
  /** Reported so the room can hold the camera still while the session travels. */
  onDragChange: (dragging: boolean) => void;
}

export function RoomSessionDiorama({ scene, placement, palette, title, hint, openLabel, onPlace, onOpen, onDragChange }: RoomSessionDioramaProps) {
  const diorama = useMemo(() => roomSessionDiorama(scene), [scene]);
  const drag = useRoomItemDrag(onPlace, onDragChange);

  // The caption is placed in WORLD space above whatever the diorama rests on —
  // outside the rotated group, so "above" means up in the room whether the sheet is
  // lying on the table or hanging on the wall.
  const captionLift = placement.anchor === 'wall' ? diorama.height / 2 + 0.24 : diorama.depth + 0.34;

  return (
    <>
      <group position={placement.position} rotation={placement.rotation} {...drag}>
        {/* The base plate: what the session stands on, and the thing you grab. */}
        <mesh position={[0, 0, -0.012]} castShadow receiveShadow>
          <boxGeometry args={[diorama.width + PLATE_PAD, diorama.height + PLATE_PAD, 0.02]} />
          <meshStandardMaterial color={palette.panel} />
        </mesh>
        {/* Each further depth plane, faintly, so a stacked board reads as a stack. */}
        {diorama.plates.filter((plate) => plate.index > 0).map((plate) => (
          <mesh key={plate.index} position={[0, 0, plate.z - 0.006]}>
            <planeGeometry args={[diorama.width, diorama.height]} />
            <meshBasicMaterial color={palette.chair} transparent opacity={0.22} toneMapped={false} side={DoubleSide} depthWrite={false} />
          </mesh>
        ))}
        {diorama.cards.map((card) => (
          <group key={card.id} position={card.position}>
            <SurfacePanel width={card.width} height={card.height} color={card.color ?? palette.card} imageUrl={card.preview} fit="cover" offset={0.004} />
          </group>
        ))}
      </group>
      <RoomItemCaption
        position={[placement.position[0], placement.position[1] + captionLift, placement.position[2]]}
        title={title}
        hint={hint}
        testId="room-session-caption"
        open={{ label: openLabel, testId: 'room-session-open', onOpen }}
      />
    </>
  );
}
