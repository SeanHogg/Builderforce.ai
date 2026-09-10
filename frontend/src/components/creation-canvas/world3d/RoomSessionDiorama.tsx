/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { DoubleSide, Plane, Vector3 } from 'three';
import type { Canvas3DScene } from '@/components/canvas/canvas3d';
import type { RoomPalette } from '@/lib/canvas/roomSeating';
import { roomSessionDiorama, type RoomSessionPlacement, type RoomSessionSpot } from '@/lib/canvas/roomSession';
import { SurfacePanel } from './SurfacePanel';

/**
 * THE SESSION, IN THE ROOM — the board's depth projection, small enough to sit on
 * a table, that you drag to where you want it and press to open.
 *
 * ── WHAT IT IS, AND WHAT IT IS NOT ───────────────────────────────────────────
 * It is the same {@link Canvas3DScene} the full-size 3D view draws, at a distance:
 * the same layers, the same floating offsets, each card in its own colour with its
 * own picture. It is NOT a second layout of the board — `roomSessionDiorama` scales
 * the projection and this file turns metres into meshes, nothing more.
 *
 * ── WHY A DRAG AND A PRESS ARE ONE GESTURE ───────────────────────────────────
 * Pointer down starts a drag; the diorama follows the pointer across the floor
 * plane and {@link placeSessionInRoom} decides, per frame, whether it is on the
 * table, the floor or the wall. Pointer up without travel is a press, which opens
 * the session. One handler, one slop threshold, and no separate "open" hotspot
 * that a person has to find on a thing the size of a tray.
 */

/** Pointer travel, in pixels, past which a gesture is a drag and not a press. */
const PRESS_SLOP = 4;
/** Extra plate around the sheet so the base reads as a base and not as a card. */
const PLATE_PAD = 0.08;
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);

export interface RoomSessionDioramaProps {
  scene: Canvas3DScene;
  placement: RoomSessionPlacement;
  palette: RoomPalette;
  /** The caption over it — the session's own name, and what pressing does. Translated by the host. */
  title: string;
  hint: string;
  onPlace: (spot: RoomSessionSpot) => void;
  onOpen: () => void;
  /** Reported so the room can hold the camera still while the session travels. */
  onDragChange: (dragging: boolean) => void;
}

type Drag = { pointerId: number; startX: number; startY: number; moved: boolean };

export function RoomSessionDiorama({ scene, placement, palette, title, hint, onPlace, onOpen, onDragChange }: RoomSessionDioramaProps) {
  const diorama = useMemo(() => roomSessionDiorama(scene), [scene]);
  const [hovered, setHovered] = useState(false);
  // The hand cursor says "this can be picked up" before anything is pressed. Set on the
  // body because the pointer is over a WebGL canvas, which has no element of its own
  // per object to carry a cursor style.
  useEffect(() => {
    if (!hovered) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'grab';
    return () => { document.body.style.cursor = previous; };
  }, [hovered]);
  const drag = useRef<Drag | null>(null);
  const hit = useRef(new Vector3());

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    onDragChange(true);
  };
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < PRESS_SLOP) return;
    current.moved = true;
    if (event.ray.intersectPlane(FLOOR, hit.current)) onPlace({ x: hit.current.x, z: hit.current.z });
  };
  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture(event.pointerId);
    drag.current = null;
    onDragChange(false);
    if (!current.moved) onOpen();
  };

  // The caption is DOM over the canvas, placed in WORLD space above whatever the
  // diorama rests on — outside the rotated group, so "above" means up in the room
  // whether the sheet is lying on the table or hanging on the wall.
  const captionLift = placement.anchor === 'wall' ? diorama.height / 2 + 0.24 : diorama.depth + 0.34;

  return (
    <>
      <group
        position={placement.position}
        rotation={placement.rotation}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
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
      <Html
        position={[placement.position[0], placement.position[1] + captionLift, placement.position[2]]}
        center
        distanceFactor={9}
        pointerEvents="none"
        zIndexRange={[10, 0]}
      >
        <span
          data-testid="room-session-caption"
          style={{
            display: 'block',
            maxWidth: 220,
            textAlign: 'center',
            padding: '3px 9px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-small)',
            lineHeight: 1.4,
            background: 'var(--surface, #1a1a1a)',
            color: 'var(--text-primary, #f5f5f5)',
            border: '1px solid var(--border, #333)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <strong style={{ fontWeight: 600 }}>{title}</strong>
          <span style={{ display: 'block', color: 'var(--text-secondary, #a0a0a0)', fontSize: 'var(--font-size-eyebrow)' }}>{hint}</span>
        </span>
      </Html>
    </>
  );
}
